import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Brain, Check, ChevronRight, Plus, X } from 'lucide-react'
import type { Flashcard, Note } from './types'
import type { FlashcardGrade } from './flashcards'

export function FlashcardsDialog({ cards, notes, onCreate, onReview, onDelete, onOpenNote, onClose }: {
  cards: Flashcard[]
  notes: Note[]
  onCreate: (noteId: string, question: string, answer: string) => void
  onReview: (id: string, grade: FlashcardGrade) => void
  onDelete: (id: string) => void
  onOpenNote: (noteId: string) => void
  onClose: () => void
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [tab, setTab] = useState<'review' | 'cards'>('review')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const due = useMemo(() => cards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt), [cards, now])
  const current = due[0]
  function submit(event: FormEvent) { event.preventDefault(); if (!question.trim() || !answer.trim() || !noteId) return; onCreate(noteId, question.trim(), answer.trim()); setQuestion(''); setAnswer('') }
  function grade(value: FlashcardGrade) { if (!current) return; onReview(current.id, value); setShowAnswer(false) }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="flashcards-dialog" role="dialog" aria-modal="true" aria-labelledby="flashcards-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <header><span className="folder-dialog-mark"><Brain size={19} /></span><div><h2 id="flashcards-title">Powtórki z odstępami</h2><p>{due.length} kart do powtórzenia · {cards.length} zapisanych</p></div><button className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header>
    <div className="backup-trash-tabs"><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Powtarzaj <span>{due.length}</span></button><button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>Karty <span>{cards.length}</span></button></div>
    {tab === 'review' ? current ? <div className="flashcard-review"><small>{notes.find(note => note.id === current.noteId)?.title ?? 'Notatka'}</small><h3>{current.question}</h3>{showAnswer ? <><div className="flashcard-answer">{current.answer}</div><p>Jak łatwo przypomniałeś sobie odpowiedź?</p><div className="flashcard-grades"><button onClick={() => grade('again')}>Ponownie <small>10 min</small></button><button onClick={() => grade('hard')}>Trudne</button><button onClick={() => grade('good')}>Dobrze</button><button onClick={() => grade('easy')}>Łatwe</button></div></> : <button className="button primary" onClick={() => setShowAnswer(true)}>Pokaż odpowiedź <ChevronRight size={15} /></button>}</div> : <div className="backup-trash-empty"><Check size={20} />Nie ma kart do powtórzenia. Możesz dodać nowe karty poniżej.</div> : <>
      <form className="flashcard-create-form" onSubmit={submit}><select aria-label="Notatka dla karty" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}</select><textarea aria-label="Pytanie" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Pytanie lub pojęcie" rows={2} /><textarea aria-label="Odpowiedź" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Odpowiedź" rows={2} /><button className="button primary" disabled={!noteId || !question.trim() || !answer.trim()}><Plus size={15} />Dodaj fiszkę</button></form>
      <div className="flashcard-list">{cards.map(card => <article key={card.id}><div><strong>{card.question}</strong><small>{notes.find(note => note.id === card.noteId)?.title ?? 'Brak notatki'} · {card.dueAt <= now ? 'do powtórzenia' : `następna: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(card.dueAt)}`}</small></div><button className="link-button" onClick={() => onOpenNote(card.noteId)}>Otwórz notatkę</button><button className="icon-button" title="Usuń fiszkę" onClick={() => onDelete(card.id)}><X size={15} /></button></article>)}</div>
    </>}
  </section></div>
}
