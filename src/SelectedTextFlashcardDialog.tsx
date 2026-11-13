import { useState, type FormEvent } from 'react'
import { Brain, Plus, X } from 'lucide-react'

export function SelectedTextFlashcardDialog({ noteTitle, selectedText, onSave, onClose }: {
  noteTitle: string
  selectedText: string
  onSave: (question: string, answer: string) => void
  onClose: () => void
}) {
  const excerpt = selectedText.trim()
  const questionSeed = excerpt.length > 110 ? `${excerpt.slice(0, 107).trimEnd()}…` : excerpt
  const [question, setQuestion] = useState(questionSeed ? `Co warto zapamiętać o: ${questionSeed}?` : '')
  const [answer, setAnswer] = useState(excerpt)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || !answer.trim()) return
    onSave(question.trim(), answer.trim())
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form className="selected-text-flashcard-dialog" role="dialog" aria-modal="true" aria-labelledby="selected-text-flashcard-title" onSubmit={submit}>
      <header><span className="folder-dialog-mark"><Brain size={18} /></span><div><h2 id="selected-text-flashcard-title">Fiszka z zaznaczenia</h2><p>{noteTitle || 'Bez tytułu'}</p></div><button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={16} /></button></header>
      <p className="selected-text-flashcard-source">Zaznaczony fragment wstawiłem jako odpowiedź. Możesz zmienić obie strony karty.</p>
      <label>Pytanie<textarea autoFocus rows={3} value={question} onChange={event => setQuestion(event.target.value)} /></label>
      <label>Odpowiedź<textarea rows={6} value={answer} onChange={event => setAnswer(event.target.value)} /></label>
      <footer><button type="button" className="button secondary" onClick={onClose}>Anuluj</button><button type="submit" className="button primary" disabled={!question.trim() || !answer.trim()}><Plus size={14} />Dodaj fiszkę</button></footer>
    </form>
  </div>
}
