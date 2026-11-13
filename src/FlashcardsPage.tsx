import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Brain, Check, ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { Flashcard, Note } from './types'
import type { FlashcardGrade } from './flashcards'
import { resolveWikiTarget } from './knowledge'

export function FlashcardsPage({ cards, notes, onCreate, onReview, onDelete, onOpenNote }: {
  cards: Flashcard[]
  notes: Note[]
  onCreate: (noteId: string, question: string, answer: string) => void
  onReview: (id: string, grade: FlashcardGrade) => void
  onDelete: (id: string) => void
  onOpenNote: (noteId: string) => void
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [tab, setTab] = useState<'review' | 'cards'>('review')
  const [now, setNow] = useState(() => Date.now())
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[] | null>(null)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const filteredCards = useMemo(() => selectedNoteIds === null ? cards : cards.filter(card => {
    const note = resolveWikiTarget(notes, card.noteId)
    return selectedNoteIds.includes(note?.id ?? card.noteId)
  }), [cards, notes, selectedNoteIds])
  const due = useMemo(() => filteredCards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt), [filteredCards, now])
  const current = due[0]
  const currentNote = current ? resolveWikiTarget(notes, current.noteId) : undefined
  function cardNote(card: Flashcard) { return resolveWikiTarget(notes, card.noteId) }
  function submit(event: FormEvent) { event.preventDefault(); if (!question.trim() || !answer.trim() || !noteId) return; onCreate(noteId, question.trim(), answer.trim()); setQuestion(''); setAnswer('') }
  function grade(value: FlashcardGrade) { if (!current) return; onReview(current.id, value); setShowAnswer(false) }
  const selectedCount = selectedNoteIds === null ? notes.length : selectedNoteIds.length
  return <section className="flashcards-page" aria-labelledby="flashcards-title">
    <header><span className="folder-dialog-mark"><Brain size={19} /></span><div><h1 id="flashcards-title">Fiszki</h1><p>{due.length} kart do powtórzenia · {filteredCards.length} zapisanych · {selectedCount} notatek</p></div></header>
    <details className="flashcard-note-filter"><summary><strong>Notatki źródłowe</strong><span>{selectedNoteIds === null ? 'Wszystkie' : `${selectedNoteIds.length} wybrano`}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="flashcard-note-options"><button type="button" onClick={() => setSelectedNoteIds(null)}>Wszystkie notatki</button>{notes.map(note => <label key={note.id}><input type="checkbox" checked={selectedNoteIds === null || selectedNoteIds.includes(note.id)} onChange={event => {
      const checked = event.currentTarget.checked
      setSelectedNoteIds(current => {
        const active = new Set(current ?? notes.map(item => item.id))
        if (checked) active.add(note.id); else active.delete(note.id)
        return [...active]
      })
    }} /><span>{note.title || 'Bez tytułu'}</span></label>)}</div></details>
    <div className="backup-trash-tabs"><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Powtarzaj <span>{due.length}</span></button><button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>Karty <span>{filteredCards.length}</span></button></div>
    {tab === 'review' ? current ? <div className="flashcard-review"><small>{currentNote?.title ?? 'Brak notatki'}</small><h3>{current.question}</h3>{showAnswer ? <><div className="flashcard-answer">{current.answer}</div><p>Jak łatwo przypomniałeś sobie odpowiedź?</p><div className="flashcard-grades"><button onClick={() => grade('again')}>Ponownie <small>10 min</small></button><button onClick={() => grade('hard')}>Trudne</button><button onClick={() => grade('good')}>Dobrze</button><button onClick={() => grade('easy')}>Łatwe</button></div></> : <button className="button primary" onClick={() => setShowAnswer(true)}>Pokaż odpowiedź <ChevronRight size={15} /></button>}</div> : <div className="backup-trash-empty"><Check size={20} />Nie ma kart do powtórzenia w wybranych notatkach. Przejdź do zakładki „Karty”, aby dodać fiszki.</div> : <>
      <form className="flashcard-create-form" onSubmit={submit}><select aria-label="Notatka dla karty" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}</select><textarea aria-label="Pytanie" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Pytanie lub pojęcie" rows={2} /><textarea aria-label="Odpowiedź" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Odpowiedź" rows={2} /><button className="button primary" disabled={!noteId || !question.trim() || !answer.trim()}><Plus size={15} />Dodaj fiszkę</button></form>
      <div className="flashcard-list">{filteredCards.map(card => { const note = cardNote(card); return <article key={card.id}><div><strong>{card.question}</strong><small>{note?.title ?? 'Brak notatki'} · {card.dueAt <= now ? 'do powtórzenia' : `następna: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(card.dueAt)}`}</small></div><button className="link-button" onClick={() => onOpenNote(note?.id ?? card.noteId)}>Otwórz notatkę</button><button className="icon-button" title="Usuń fiszkę" onClick={() => onDelete(card.id)}><X size={15} /></button></article> })}</div>
    </>}
  </section>
}
