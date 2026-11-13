import { useRef, useState } from 'react'
import { Check, LoaderCircle, Maximize2, Minimize2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { streamOllamaMessage } from './ollama'

export type AiNoteTool = 'summary' | 'tasks' | 'flashcards' | 'quiz'

type FlashcardDraft = { id: number; question: string; answer: string }
type ParsedFlashcard = Omit<FlashcardDraft, 'id'>

const toolLabels: Record<AiNoteTool, string> = {
  summary: 'Podsumowanie i konspekt',
  tasks: 'Zadania do wykonania',
  flashcards: 'Fiszki',
  quiz: 'Quiz do notatki',
}

function parseFlashcards(value: string): ParsedFlashcard[] {
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
  if (!cards.length) throw new Error('Nie udało się odczytać żadnej fiszki z odpowiedzi modelu. Spróbuj ponownie.')
  return cards
}

export function AiNoteToolsDialog({ kind, note, attachments, baseUrl, model, onApply, onCreateFlashcard, onClose }: {
  kind: AiNoteTool
  note: Note
  attachments: NoteAttachment[]
  baseUrl: string
  model: string
  onApply: (generated: string) => void
  onCreateFlashcard: (noteId: string, question: string, answer: string) => void
  onClose: () => void
}) {
  const [sourceNote] = useState(note)
  const [sourceAttachments] = useState(attachments)
  const [toolKind] = useState(kind)
  const [generated, setGenerated] = useState('')
  const [flashcards, setFlashcards] = useState<FlashcardDraft[]>([])
  const [extraGuidance, setExtraGuidance] = useState('')
  const [busy, setBusy] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)
  const nextCardId = useRef(0)
  const isFlashcards = toolKind === 'flashcards'
  const hasIncompleteCard = flashcards.some(card => !card.question.trim() || !card.answer.trim())

  async function generate() {
    if (!model || busy) return
    setBusy(true)
    setError('')
    if (!isFlashcards) {
      setGenerated('')
      setCreated(false)
    }
    let result = ''
    const attachmentText = sourceAttachments.flatMap(item => {
      const text = item.transcript?.trim() || item.extractedText?.trim()
      return text ? [`\n\nZAŁĄCZNIK: ${item.fileName}\n${text}`] : []
    }).join('')
    const content = `Tytuł: ${sourceNote.title || 'Bez tytułu'}\nTagi: ${sourceNote.tags.join(', ') || 'brak'}\n\n${sourceNote.content}${attachmentText}`.slice(0, 48_000)
    const flashcardInstructions = [
      'Utwórz maksymalnie 12 wysokiej jakości fiszek do nauki na podstawie wyłącznie materiału źródłowego.',
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
      await streamOllamaMessage(baseUrl, model, [{ role: 'user', content: `${instructions[toolKind]}\n\nMATERIAŁ ŹRÓDŁOWY:\n${content}` }], chunk => {
        result += chunk
        if (!isFlashcards) setGenerated(result)
      })
      if (!result.trim()) throw new Error('Model zwrócił pustą odpowiedź.')
      if (isFlashcards) {
        const parsed = parseFlashcards(result)
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
      if (!flashcards.length || hasIncompleteCard) return
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
      <header><span className="folder-dialog-mark"><Sparkles size={19} /></span><div><h2 id="ai-note-tools-title">{toolLabels[toolKind]}</h2><p>{sourceNote.title || 'Bez tytułu'} · materiał pozostaje na tym urządzeniu</p></div>{isFlashcards && <button type="button" className="icon-button" aria-label="Zminimalizuj generator i czytaj notatkę" title="Zminimalizuj i czytaj notatkę" onClick={() => setMinimized(true)}><Minimize2 size={17} /></button>}<button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose} disabled={busy}><X size={17} /></button></header>
      <div className="ai-note-tools-body">
        {!model && <p className="ai-note-tools-error">Najpierw wybierz model w ustawieniach Ollama.</p>}
        {error && <p className="ai-note-tools-error" role="alert">{error}</p>}
        {isFlashcards ? <>
          <label className="ai-note-tools-guidance"><span>Jakie fiszki przygotować?</span><textarea aria-label="Dodatkowe wskazówki do fiszek" value={extraGuidance} onChange={event => setExtraGuidance(event.target.value)} placeholder="Np. skup się na pojęciach i różnicach, zadawaj pytania wymagające krótkiego wyjaśnienia…" disabled={busy} /><small>Twoje wskazówki uzupełnią kryteria jakości i treść notatki.</small></label>
          {busy && <p className="ai-note-tools-progress" role="status"><LoaderCircle className="spin" size={15} />Czytam notatkę i przygotowuję fiszki. Możesz zminimalizować to okno i wrócić później.</p>}
          {flashcards.length > 0 && <section className="ai-note-tools-flashcards" aria-label="Edytuj wygenerowane fiszki">
            <div className="ai-note-tools-cards-heading"><div><h3>Przejrzyj fiszki</h3><p>Popraw pytania i odpowiedzi przed dodaniem ich do puli.</p></div><span>{flashcards.length}</span></div>
            <div className="ai-note-tools-card-list">{flashcards.map((card, index) => <article className="ai-note-tools-card" key={card.id}>
              <header><strong>Fiszka {index + 1}</strong><button type="button" className="icon-button" aria-label={`Usuń fiszkę ${index + 1}`} title="Usuń fiszkę" disabled={busy || created} onClick={() => { setFlashcards(current => current.filter(item => item.id !== card.id)); setCreated(false) }}><Trash2 size={15} /></button></header>
              <label><span>Pytanie</span><textarea value={card.question} onChange={event => updateCard(card.id, 'question', event.target.value)} disabled={busy || created} /></label>
              <label><span>Odpowiedź</span><textarea value={card.answer} onChange={event => updateCard(card.id, 'answer', event.target.value)} disabled={busy || created} /></label>
            </article>)}</div>
            <button type="button" className="button secondary ai-note-tools-add-card" disabled={busy || created} onClick={() => { setFlashcards(current => [...current, { id: nextCardId.current++, question: '', answer: '' }]); setCreated(false) }}><Plus size={14} />Dodaj fiszkę</button>
            {hasIncompleteCard && <p className="ai-note-tools-validation" role="status">Uzupełnij pytanie i odpowiedź w każdej fiszce, aby ją zapisać.</p>}
          </section>}
          {!flashcards.length && !busy && <p className="ai-note-tools-help">Model przeanalizuje notatkę oraz zapisane transkrypcje i teksty załączników. Przed dodaniem możesz poprawić lub usunąć każdą fiszkę.</p>}
        </> : <>
          {generated && <textarea className="ai-note-tools-result" aria-label="Wynik wygenerowany przez AI" value={generated} onChange={event => { setGenerated(event.target.value); setCreated(false) }} />}
          {!generated && <p className="ai-note-tools-help">Model przeanalizuje treść notatki oraz zapisane transkrypcje i teksty załączników.</p>}
        </>}
      </div>
      <footer>{(isFlashcards ? flashcards.length > 0 : Boolean(generated)) && <button type="button" className="button primary" onClick={accept} disabled={created || busy || (isFlashcards && hasIncompleteCard)}><Check size={14} />{created ? 'Dodano' : isFlashcards ? 'Zapisz fiszki' : toolKind === 'tasks' ? 'Dodaj do notatki' : 'Wstaw do notatki'}</button>}<button type="button" className="button secondary" onClick={() => void generate()} disabled={busy || !model}>{busy ? <><LoaderCircle className="spin" size={14} />Generuję…</> : isFlashcards ? flashcards.length ? 'Wygeneruj ponownie' : 'Generuj fiszki' : generated ? 'Wygeneruj ponownie' : 'Generuj'}</button>{!busy && <button type="button" className="button secondary" onClick={onClose}>Zamknij</button>}</footer>
    </section>
  </div>
}
