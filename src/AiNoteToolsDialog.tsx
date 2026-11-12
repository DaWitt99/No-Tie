import { useState } from 'react'
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { streamOllamaMessage } from './ollama'

export type AiNoteTool = 'summary' | 'tasks' | 'flashcards' | 'quiz'

const toolLabels: Record<AiNoteTool, string> = {
  summary: 'Podsumowanie i konspekt',
  tasks: 'Zadania do wykonania',
  flashcards: 'Fiszki',
  quiz: 'Quiz do notatki',
}

function parseFlashcards(value: string): { question: string; answer: string }[] {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? value.slice(value.indexOf('['), value.lastIndexOf(']') + 1)
  const parsed: unknown = JSON.parse(candidate)
  if (!Array.isArray(parsed)) throw new Error('Model nie zwrócił listy fiszek w formacie JSON.')
  const cards = parsed.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : typeof row.pytanie === 'string' ? row.pytanie.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : typeof row.odpowiedz === 'string' ? row.odpowiedz.trim() : ''
    return question && answer ? [{ question, answer }] : []
  })
  if (!cards.length) throw new Error('Nie udało się odczytać żadnej fiszki z odpowiedzi modelu.')
  return cards
}

export function AiNoteToolsDialog({ kind, note, attachments, baseUrl, model, onApply, onCreateFlashcard, onClose }: {
  kind: AiNoteTool
  note: Note
  attachments: NoteAttachment[]
  baseUrl: string
  model: string
  onApply: (generated: string) => void
  onCreateFlashcard: (question: string, answer: string) => void
  onClose: () => void
}) {
  const [generated, setGenerated] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)

  async function generate() {
    if (!model || busy) return
    setBusy(true)
    setError('')
    setGenerated('')
    setCreated(false)
    let result = ''
    const attachmentText = attachments.flatMap(item => {
      const text = item.transcript?.trim() || item.extractedText?.trim()
      return text ? [`\n\nZAŁĄCZNIK: ${item.fileName}\n${text}`] : []
    }).join('')
    const content = `Tytuł: ${note.title || 'Bez tytułu'}\nTagi: ${note.tags.join(', ') || 'brak'}\n\n${note.content}${attachmentText}`.slice(0, 48_000)
    const instructions: Record<AiNoteTool, string> = {
      summary: 'Przygotuj zwięzłe, wierne źródłu podsumowanie oraz hierarchiczny konspekt. Użyj Markdown. Nie dodawaj faktów, których nie ma w materiale.',
      tasks: 'Wypisz wyłącznie konkretne zadania wynikające z materiału jako listę Markdown `- [ ] ...`. Jeśli materiał nie zawiera zadań, napisz „Nie znaleziono konkretnych zadań”. Nie wymyślaj obowiązków.',
      flashcards: 'Utwórz do 12 użytecznych fiszek do nauki. Zwróć wyłącznie tablicę JSON obiektów z polami `question` i `answer`. Nie dodawaj Markdown ani tekstu przed lub po JSON.',
      quiz: 'Utwórz krótki quiz sprawdzający zrozumienie materiału: 5 pytań wielokrotnego wyboru, po 4 odpowiedzi A–D, dokładnie jedna poprawna. Najpierw pokaż wszystkie pytania bez ujawniania odpowiedzi, a na końcu dodaj osobny klucz odpowiedzi z krótkim uzasadnieniem. Użyj Markdown i nie dodawaj faktów spoza materiału.',
    }
    try {
      await streamOllamaMessage(baseUrl, model, [{ role: 'user', content: `${instructions[kind]}\n\nMATERIAŁ ŹRÓDŁOWY:\n${content}` }], chunk => { result += chunk; setGenerated(result) })
      if (!result.trim()) throw new Error('Model zwrócił pustą odpowiedź.')
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Nie udało się wygenerować treści.')
    } finally { setBusy(false) }
  }

  function accept() {
    if (!generated.trim() || created) return
    if (kind === 'flashcards') {
      try {
        for (const card of parseFlashcards(generated)) onCreateFlashcard(card.question, card.answer)
        setCreated(true)
      } catch (parseError) { setError(parseError instanceof Error ? parseError.message : 'Nie udało się zapisać fiszek.') }
      return
    }
      onApply(generated.trim())
    setCreated(true)
  }

  return <div className="modal-backdrop ai-note-tools-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="ai-note-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-note-tools-title">
      <header><span className="folder-dialog-mark"><Sparkles size={19} /></span><div><h2 id="ai-note-tools-title">{toolLabels[kind]}</h2><p>{note.title || 'Bez tytułu'} · materiał pozostaje na tym urządzeniu</p></div><button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose} disabled={busy}><X size={17} /></button></header>
      {!model && <p className="ai-note-tools-error">Najpierw wybierz model w ustawieniach Ollama.</p>}
      {error && <p className="ai-note-tools-error" role="alert">{error}</p>}
      {generated && <textarea className="ai-note-tools-result" aria-label="Wynik wygenerowany przez AI" value={generated} onChange={event => { setGenerated(event.target.value); setCreated(false) }} />}
      {!generated && <p className="ai-note-tools-help">Model przeanalizuje treść notatki oraz zapisane transkrypcje i teksty załączników.</p>}
      <footer>{generated && <button type="button" className="button primary" onClick={accept} disabled={created || busy}><Check size={14} />{created ? 'Dodano' : kind === 'flashcards' ? 'Zapisz fiszki' : kind === 'tasks' ? 'Dodaj do notatki' : 'Wstaw do notatki'}</button>}<button type="button" className="button secondary" onClick={() => void generate()} disabled={busy || !model}>{busy ? <><LoaderCircle className="spin" size={14} />Generuję…</> : generated ? 'Wygeneruj ponownie' : 'Generuj'}</button>{!busy && <button type="button" className="button secondary" onClick={onClose}>Zamknij</button>}</footer>
    </section>
  </div>
}
