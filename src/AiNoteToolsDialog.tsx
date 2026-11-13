import { useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, Maximize2, Minimize2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { imageAttachmentToPngBase64, streamOllamaMessage } from './ollama'

export type AiNoteTool = 'summary' | 'tasks' | 'flashcards' | 'quiz'

type FlashcardDraft = { id: number; question: string; answer: string }
type ParsedFlashcard = Omit<FlashcardDraft, 'id'>

const MAX_AI_CONTEXT_IMAGES = 20
const MAX_AI_NOTE_TEXT = 28_000
const MAX_AI_ATTACHMENT_TEXT = 14_000

const toolLabels: Record<AiNoteTool, string> = {
  summary: 'Podsumowanie i konspekt',
  tasks: 'Zadania do wykonania',
  flashcards: 'Fiszki',
  quiz: 'Quiz do notatki',
}

const flashcardPromptPresets = {
  balanced: '',
  definitions: 'Skup się na ważnych pojęciach, definicjach i różnicach między podobnymi terminami.',
  causes: 'Skup się na przyczynach, skutkach, warunkach i zależnościach opisanych w materiale.',
  comparisons: 'Priorytetem niech będą porównania, podobieństwa i różnice, które pomagają odróżnić bliskie sobie pojęcia.',
  exam: 'Przygotuj pytania w stylu egzaminacyjnym, wymagające przypomnienia i krótkiego wyjaśnienia wiedzy.',
} as const

function normalizeQuestion(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function parseFlashcards(value: string, existingQuestions: readonly string[] = []): ParsedFlashcard[] {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = value.indexOf('[')
  const end = value.lastIndexOf(']')
  const candidate = fenced?.trim() || (start >= 0 && end > start ? value.slice(start, end + 1) : '')
  if (!candidate) throw new Error('Model nie zwrócił listy fiszek. Spróbuj wygenerować je ponownie.')

  let parsed: unknown
  try { parsed = JSON.parse(candidate) } catch {
    throw new Error('Odpowiedź modelu nie zawiera poprawnej listy fiszek. Spróbuj wygenerować je ponownie.')
  }
  if (!Array.isArray(parsed)) throw new Error('Model nie zwrócił listy fiszek.')

  const cards = parsed.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : typeof row.pytanie === 'string' ? row.pytanie.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : typeof row.odpowiedz === 'string' ? row.odpowiedz.trim() : ''
    return question && answer ? [{ question, answer }] : []
  })
  const seen = new Set(existingQuestions.map(normalizeQuestion).filter(Boolean))
  const uniqueCards = cards.filter(card => {
    const key = normalizeQuestion(card.question)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!uniqueCards.length) throw new Error('Wszystkie wygenerowane pytania są już w puli albo nie udało się odczytać fiszek. Zmień wskazówki i spróbuj ponownie.')
  return uniqueCards
}

export function AiNoteToolsDialog({ kind, note, attachments, existingQuestions = [], sourceText, sourcePage, sourceLabel, baseUrl, model, onApply, onCreateFlashcard, onTranscribeAudio, onClose }: {
  kind: AiNoteTool
  note: Note
  attachments: NoteAttachment[]
  existingQuestions?: readonly string[]
  sourceText?: string
  sourcePage?: { attachmentId: string; page: number }
  sourceLabel?: string
  baseUrl: string
  model: string
  onApply: (generated: string) => void
  onCreateFlashcard: (noteId: string, question: string, answer: string) => void
  onTranscribeAudio?: (attachment: NoteAttachment) => Promise<string>
  onClose: () => void
}) {
  const [sourceNote] = useState(note)
  const sourceAttachments = useMemo(() => sourcePage ? attachments.filter(attachment => attachment.id === sourcePage.attachmentId) : sourceText?.trim() ? [] : attachments.filter(attachment => attachment.noteId === sourceNote.id), [attachments, sourceNote.id, sourcePage, sourceText])
  const [toolKind] = useState(kind)
  const [generated, setGenerated] = useState('')
  const [flashcards, setFlashcards] = useState<FlashcardDraft[]>([])
  const [extraGuidance, setExtraGuidance] = useState('')
  const [flashcardCount, setFlashcardCount] = useState(12)
  const [promptPreset, setPromptPreset] = useState<keyof typeof flashcardPromptPresets | 'custom'>('balanced')
  const [busy, setBusy] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)
  const nextCardId = useRef(0)
  const isFlashcards = toolKind === 'flashcards'
  const hasIncompleteCard = flashcards.some(card => !card.question.trim() || !card.answer.trim())
  const hasDuplicateCard = (() => {
    const seen = new Set(existingQuestions.map(normalizeQuestion).filter(Boolean))
    return flashcards.some(card => {
      const key = normalizeQuestion(card.question)
      if (!key || seen.has(key)) return true
      seen.add(key)
      return false
    })
  })()

  async function generate() {
    if (!model || busy) return
    setBusy(true)
    setError('')
    if (!isFlashcards) {
      setGenerated('')
      setCreated(false)
    }
    let result = ''
    const flashcardInstructions = [
      `Utwórz ${flashcardCount} wysokiej jakości fiszek do nauki na podstawie wyłącznie materiału źródłowego. Przygotuj tę liczbę, jeśli źródło zawiera wystarczająco dużo informacji; w przeciwnym razie utwórz mniej i nie powtarzaj kart.`,
      'Każda fiszka ma sprawdzać jedną konkretną, istotną rzecz. Pytanie powinno być jasne i zrozumiałe bez zgadywania kontekstu, a odpowiedź krótka, precyzyjna i wystarczająca do samodzielnej nauki.',
      'Wybieraj ważne pojęcia, zależności, przyczyny i skutki, warunki, różnice, etapy procesów oraz informacje, które łatwo pomylić. Unikaj pytań ogólnikowych, banalnych, wieloczęściowych i powtarzających tę samą wiedzę.',
      'Nie dopowiadaj faktów spoza materiału. Jeśli źródło nie zawiera dość treści na wiele dobrych fiszek, utwórz mniej zamiast wypełniać listę słabymi kartami.',
      'Zwróć wyłącznie poprawną tablicę JSON obiektów z polami string `question` i `answer`. Nie dodawaj Markdown ani tekstu przed lub po JSON.',
      extraGuidance.trim() ? `DODATKOWE WSKAZÓWKI UŻYTKOWNIKA:\n${extraGuidance.trim()}` : '',
    ].filter(Boolean).join('\n\n')
    const instructions: Record<AiNoteTool, string> = {
      summary: 'Przygotuj zwięzłe, wierne źródłu podsumowanie oraz hierarchiczny konspekt. Użyj Markdown. Nie dodawaj faktów, których nie ma w materiale.',
      tasks: 'Wypisz wyłącznie konkretne zadania wynikające z materiału jako listę Markdown `- [ ] ...`. Jeśli materiał nie zawiera zadań, napisz „Nie znaleziono konkretnych zadań”. Nie wymyślaj obowiązków.',
      flashcards: flashcardInstructions,
      quiz: 'Utwórz krótki quiz sprawdzający zrozumienie materiału: 5 pytań wielokrotnego wyboru, po 4 odpowiedzi A–D, dokładnie jedna poprawna. Najpierw pokaż wszystkie pytania bez ujawniania odpowiedzi, a na końcu dodaj osobny klucz odpowiedzi z krótkim uzasadnieniem. Użyj Markdown i nie dodawaj faktów spoza materiału.',
    }
    try {
      const attachmentTextSections: string[] = []
      const attachmentImages: string[] = []
      const imageLabels: string[] = []
      let omittedVisuals = 0
      let omittedPdfPages = 0

      for (const attachment of sourceAttachments) {
        let transcript = attachment.transcript?.trim() || attachment.transcriptSegments?.map(segment => segment.text.trim()).filter(Boolean).join('\n') || ''
        if (attachment.mimeType.startsWith('audio/') && !transcript) {
          if (!onTranscribeAudio) throw new Error(`Załącznik audio „${attachment.fileName}” nie ma transkrypcji.`)
          transcript = (await onTranscribeAudio(attachment)).trim()
          if (!transcript) throw new Error(`Nie udało się uzyskać transkrypcji załącznika „${attachment.fileName}”.`)
        }

        const selectedPage = sourcePage?.attachmentId === attachment.id ? sourcePage.page : undefined
        const annotations = selectedPage ? attachment.pdfAnnotations?.filter(annotation => annotation.page === selectedPage) : attachment.pdfAnnotations
        const extractedText = selectedPage ? '' : attachment.extractedText?.trim() ?? ''
        const textSections = [transcript, extractedText].filter(Boolean)
        if (annotations?.length) {
          textSections.push(annotations.map(annotation => `Strona ${annotation.page}${annotation.quote ? `, cytat: „${annotation.quote}”` : ''}: ${annotation.text}`).join('\n'))
        }

        if (attachment.mimeType === 'application/pdf' && (!attachment.extractedText?.trim() || selectedPage !== undefined)) {
          const { pdfAttachmentToText } = await import('./pdfVision')
          const pdfText = await pdfAttachmentToText(attachment.dataUrl, selectedPage === undefined ? 40 : 1, selectedPage === undefined ? MAX_AI_ATTACHMENT_TEXT : 14_000, selectedPage ?? 1)
          if (pdfText.text.trim()) {
            textSections.push(pdfText.text.trim())
            if (selectedPage === undefined) omittedPdfPages += Math.max(0, pdfText.totalPages - pdfText.pagesRead)
          } else if (attachmentImages.length < MAX_AI_CONTEXT_IMAGES) {
            const { pdfAttachmentToVisionPages } = await import('./pdfVision')
            const pages = await pdfAttachmentToVisionPages(attachment.dataUrl, selectedPage === undefined ? MAX_AI_CONTEXT_IMAGES - attachmentImages.length : 1, selectedPage ?? 1)
            for (const page of pages.pages) {
              attachmentImages.push(page.base64)
              imageLabels.push(`PDF „${attachment.fileName}”, strona ${page.pageNumber} z ${page.totalPages}`)
            }
            omittedVisuals += Math.max(0, pages.totalPages - pages.pages.length)
          } else {
            omittedVisuals += pdfText.totalPages
          }
        } else if (attachment.mimeType.startsWith('image/') && !attachment.extractedText?.trim()) {
          if (attachmentImages.length < MAX_AI_CONTEXT_IMAGES) {
            attachmentImages.push(await imageAttachmentToPngBase64(attachment.dataUrl))
            imageLabels.push(`Obraz „${attachment.fileName}”`)
          } else omittedVisuals += 1
        }

        if (textSections.length) attachmentTextSections.push(`ZAŁĄCZNIK „${attachment.fileName}”:\n${textSections.join('\n\n')}`)
      }

      const noteContent = sourceText?.trim() ?? (sourcePage ? '' : sourceNote.content)
      const noteSource = `Tytuł: ${sourceNote.title || 'Bez tytułu'}\nTagi: ${sourceNote.tags.join(', ') || 'brak'}\n${sourceLabel ? `Zakres: ${sourceLabel}\n` : ''}\n${noteContent}`
      const allAttachmentSource = attachmentTextSections.join('\n\n')
      const attachmentSource = allAttachmentSource.slice(0, MAX_AI_ATTACHMENT_TEXT)
      const contentParts = [
        noteSource.slice(0, MAX_AI_NOTE_TEXT),
        noteSource.length > MAX_AI_NOTE_TEXT ? '[Dalsza część notatki została pominięta z powodu limitu kontekstu.]' : '',
        attachmentSource ? `\n\nTREŚĆ ZAŁĄCZNIKÓW:\n${attachmentSource}` : '',
        allAttachmentSource.length > MAX_AI_ATTACHMENT_TEXT ? '[Tekst załączników został skrócony z powodu limitu kontekstu.]' : '',
        imageLabels.length ? `\n\nZAŁĄCZNIKI OBRAZOWE W TEJ SAMEJ KOLEJNOŚCI CO OBRAZY:\n${imageLabels.map((label, index) => `${index + 1}. ${label}`).join('\n')}` : '',
        omittedPdfPages ? `\nPominięto tekst z ${omittedPdfPages} dalszych stron PDF.` : '',
        omittedVisuals ? `\nPominięto ${omittedVisuals} obrazów lub stron PDF z powodu limitu ${MAX_AI_CONTEXT_IMAGES} obrazów.` : '',
      ].filter(Boolean)
      const content = contentParts.join('\n\n').slice(0, 48_000)
      if (sourcePage && !sourceText?.trim() && !attachmentTextSections.length && !attachmentImages.length) throw new Error(`Nie udało się odczytać strony ${sourcePage.page} z załącznika PDF.`)
      await streamOllamaMessage(baseUrl, model, [{ role: 'user', content: `${instructions[toolKind]}\n\nMATERIAŁ ŹRÓDŁOWY:\n${content}`, images: attachmentImages.length ? attachmentImages : undefined }], chunk => {
        result += chunk
        if (!isFlashcards) setGenerated(result)
      })
      if (!result.trim()) throw new Error('Model zwrócił pustą odpowiedź.')
      if (isFlashcards) {
        const parsed = parseFlashcards(result, existingQuestions).slice(0, flashcardCount)
        setFlashcards(parsed.map(card => ({ ...card, id: nextCardId.current++ })))
        setCreated(false)
      }
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Nie udało się wygenerować treści.')
    } finally { setBusy(false) }
  }

  function accept() {
    if (created || busy) return
    if (isFlashcards) {
      if (!flashcards.length || hasIncompleteCard || hasDuplicateCard) return
      for (const card of flashcards) onCreateFlashcard(sourceNote.id, card.question.trim(), card.answer.trim())
    } else {
      if (!generated.trim()) return
      onApply(generated.trim())
    }
    setCreated(true)
  }

  function updateCard(id: number, field: 'question' | 'answer', value: string) {
    setFlashcards(current => current.map(card => card.id === id ? { ...card, [field]: value } : card))
    setCreated(false)
  }

  if (minimized) return <aside className="ai-note-tools-minimized" aria-label="Zminimalizowany generator fiszek">
    <div className="ai-note-tools-minimized-status" role="status" aria-live="polite">
      <span className="ai-note-tools-minimized-mark">{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}</span>
      <span><strong>{busy ? 'Generuję fiszki…' : error ? 'Generator fiszek — błąd' : created ? `${flashcards.length} fiszek dodano do puli` : flashcards.length ? `${flashcards.length} fiszek gotowych do edycji` : 'Generator fiszek'}</strong><small>{sourceNote.title || 'Bez tytułu'}</small></span>
    </div>
    <div className="ai-note-tools-minimized-actions">
      <button type="button" className="button primary" onClick={() => setMinimized(false)}><Maximize2 size={14} />Wróć do generatora</button>
      {!busy && <button type="button" className="icon-button" aria-label="Zamknij generator fiszek" onClick={onClose}><X size={17} /></button>}
    </div>
  </aside>

  return <div className="modal-backdrop ai-note-tools-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="ai-note-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-note-tools-title">
      <header><span className="folder-dialog-mark"><Sparkles size={19} /></span><div><h2 id="ai-note-tools-title">{toolLabels[toolKind]}</h2><p>{sourceNote.title || 'Bez tytułu'}{sourceLabel ? ` · ${sourceLabel}` : ' · materiał pozostaje na tym urządzeniu'}</p></div>{isFlashcards && <button type="button" className="icon-button" aria-label="Zminimalizuj generator i czytaj notatkę" title="Zminimalizuj i czytaj notatkę" onClick={() => setMinimized(true)}><Minimize2 size={17} /></button>}<button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose} disabled={busy}><X size={17} /></button></header>
      <div className="ai-note-tools-body">
        {!model && <p className="ai-note-tools-error">Najpierw wybierz model w ustawieniach Ollama.</p>}
        {error && <p className="ai-note-tools-error" role="alert">{error}</p>}
        {isFlashcards ? <>
          <div className="ai-note-tools-guidance">
            <div className="ai-note-tools-prompt-controls"><label><span>Profil fiszek</span><select aria-label="Profil promptu fiszek" value={promptPreset} onChange={event => { const preset = event.target.value as keyof typeof flashcardPromptPresets | 'custom'; setPromptPreset(preset); if (preset !== 'custom') setExtraGuidance(flashcardPromptPresets[preset]) }} disabled={busy}><option value="balanced">Zrównoważone</option><option value="definitions">Definicje</option><option value="causes">Przyczyny i skutki</option><option value="comparisons">Porównania</option><option value="exam">Egzamin</option><option value="custom">Własne wskazówki</option></select></label><label><span>Liczba fiszek</span><input aria-label="Liczba generowanych fiszek" type="number" min={1} max={50} value={flashcardCount} onChange={event => setFlashcardCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} disabled={busy} /></label></div>
            <label><span>Doprecyzuj prompt</span><textarea aria-label="Dodatkowe wskazówki do fiszek" value={extraGuidance} onChange={event => { setExtraGuidance(event.target.value); setPromptPreset('custom') }} placeholder="Np. skup się na pojęciach i różnicach, zadawaj pytania wymagające krótkiego wyjaśnienia…" disabled={busy} /></label>
            <small>Model przygotuje najwyżej 50 kart, a duplikaty zostaną pominięte.</small>
          </div>
          {busy && <p className="ai-note-tools-progress" role="status"><LoaderCircle className="spin" size={15} />{sourceLabel ? `Czytam ${sourceLabel} i przygotowuję fiszki. ` : 'Czytam notatkę i jej załączniki, a potem przygotuję fiszki. '}Możesz zminimalizować to okno i wrócić później.</p>}
          {flashcards.length > 0 && <section className="ai-note-tools-flashcards" aria-label="Edytuj wygenerowane fiszki">
            <div className="ai-note-tools-cards-heading"><div><h3>Przejrzyj fiszki</h3><p>Popraw pytania i odpowiedzi przed dodaniem ich do puli.</p></div><span>{flashcards.length}</span></div>
            <div className="ai-note-tools-card-list">{flashcards.map((card, index) => <article className="ai-note-tools-card" key={card.id}>
              <header><strong>Fiszka {index + 1}</strong><button type="button" className="icon-button" aria-label={`Usuń fiszkę ${index + 1}`} title="Usuń fiszkę" disabled={busy || created} onClick={() => { setFlashcards(current => current.filter(item => item.id !== card.id)); setCreated(false) }}><Trash2 size={15} /></button></header>
              <label><span>Pytanie</span><textarea value={card.question} onChange={event => updateCard(card.id, 'question', event.target.value)} disabled={busy || created} /></label>
              <label><span>Odpowiedź</span><textarea value={card.answer} onChange={event => updateCard(card.id, 'answer', event.target.value)} disabled={busy || created} /></label>
            </article>)}</div>
            <button type="button" className="button secondary ai-note-tools-add-card" disabled={busy || created} onClick={() => { setFlashcards(current => [...current, { id: nextCardId.current++, question: '', answer: '' }]); setCreated(false) }}><Plus size={14} />Dodaj fiszkę</button>
            {hasIncompleteCard && <p className="ai-note-tools-validation" role="status">Uzupełnij pytanie i odpowiedź w każdej fiszce, aby ją zapisać.</p>}
            {hasDuplicateCard && <p className="ai-note-tools-validation" role="status">Usuń lub zmień powtarzające się pytania. W puli są już karty o takim samym pytaniu.</p>}
          </section>}
          {!flashcards.length && !busy && <p className="ai-note-tools-help">{sourceLabel ? `Fiszki powstaną na podstawie zakresu: ${sourceLabel}.` : 'Model przeanalizuje notatkę i jej załączniki. Obrazy oraz skanowane PDF-y wymagają modelu obsługującego obrazy; audio bez transkrypcji zostanie przetworzone przez skonfigurowaną usługę.'} Przed dodaniem możesz poprawić lub usunąć każdą fiszkę.</p>}
        </> : <>
          {generated && <textarea className="ai-note-tools-result" aria-label="Wynik wygenerowany przez AI" value={generated} onChange={event => { setGenerated(event.target.value); setCreated(false) }} />}
          {!generated && <p className="ai-note-tools-help">Model przeanalizuje treść notatki oraz zapisane transkrypcje i teksty załączników.</p>}
        </>}
      </div>
      <footer>{(isFlashcards ? flashcards.length > 0 : Boolean(generated)) && <button type="button" className="button primary" onClick={accept} disabled={created || busy || (isFlashcards && (hasIncompleteCard || hasDuplicateCard))}><Check size={14} />{created ? 'Dodano' : isFlashcards ? 'Zapisz fiszki' : toolKind === 'tasks' ? 'Dodaj do notatki' : 'Wstaw do notatki'}</button>}<button type="button" className="button secondary" onClick={() => void generate()} disabled={busy || !model}>{busy ? <><LoaderCircle className="spin" size={14} />Generuję…</> : isFlashcards ? flashcards.length ? 'Wygeneruj ponownie' : 'Generuj fiszki' : generated ? 'Wygeneruj ponownie' : 'Generuj'}</button>{!busy && <button type="button" className="button secondary" onClick={onClose}>Zamknij</button>}</footer>
    </section>
  </div>
}
