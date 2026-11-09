import { ArrowUpRight, BookOpen, Check, Clock3, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { formatReviewDuration, reviewNoteTime, reviewTotalTime } from './reviews'
import type { Note, ReviewSession } from './types'

type ReviewSessionViewProps = {
  session: ReviewSession
  notes: Note[]
  now: number
  onStart: () => void
  onPause: () => void
  onFinish: () => void
  onReset: () => void
  onSetActiveNote: (noteId: string) => void
  onOpenNote: (noteId: string) => void
}

function sessionStatusLabel(status: ReviewSession['status']) {
  if (status === 'running') return 'W trakcie'
  if (status === 'paused') return 'Wstrzymana'
  if (status === 'completed') return 'Zakończona'
  return 'Gotowa'
}

export function ReviewSessionView({ session, notes, now, onStart, onPause, onFinish, onReset, onSetActiveNote, onOpenNote }: ReviewSessionViewProps) {
  const noteById = new Map(notes.map(note => [note.id, note]))
  const sessionNotes = session.noteIds.map(id => ({ id, note: noteById.get(id) }))
  const activeNote = session.activeNoteId ? noteById.get(session.activeNoteId) : undefined
  const totalTime = reviewTotalTime(session, now)

  return (
    <div className="review-session-view">
      <div className="review-view-heading">
        <div>
          <p className="eyebrow">POWTÓRKA</p>
          <h1>{session.title}</h1>
          <span>Utworzono {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(session.createdAt)}</span>
        </div>
        <span className={`review-status-badge ${session.status}`}><i />{sessionStatusLabel(session.status)}</span>
      </div>

      <section className="review-timer-card" aria-label="Licznik czasu powtórki">
        <div className="review-timer-readout">
          <span><Clock3 size={15} />Łączny czas</span>
          <strong aria-live="off">{formatReviewDuration(totalTime)}</strong>
          <small>{session.noteIds.length} {session.noteIds.length === 1 ? 'notatka' : 'notatek'} w tej sesji{activeNote ? ` · aktywna: ${activeNote.title}` : ''}</small>
        </div>
        <div className="review-timer-actions">
          {session.status === 'running'
            ? <button className="button secondary" onClick={onPause}><Pause size={15} />Wstrzymaj</button>
            : <button className="button primary" onClick={onStart} disabled={session.status === 'completed'}><Play size={15} />{session.status === 'paused' ? 'Wznów' : 'Odlicz czas'}</button>}
          <button className="button secondary" onClick={onFinish} disabled={session.status === 'completed'}><Square size={14} />Zakończ</button>
          <button className="button secondary review-reset-button" onClick={onReset}><RotateCcw size={14} />Reset czasu</button>
        </div>
      </section>

      <section className="review-session-summary">
        <header className="review-summary-heading"><div><p className="eyebrow">PODSUMOWANIE</p><h2>Notatki i czas</h2></div><span>{formatReviewDuration(totalTime)} łącznie</span></header>
        <p className="review-session-hint">Wybierz aktywną notatkę, aby przypisać jej czas. Kliknij tytuł, by ją otworzyć; sesja pozostanie dostępna w panelu Powtórki.</p>
        <div className="review-session-notes">
          {sessionNotes.map(({ id, note }, index) => <article className={`review-session-note ${session.activeNoteId === id ? 'active' : ''}`} key={id}>
            <span className="review-note-number">{String(index + 1).padStart(2, '0')}</span>
            {note ? <div className="review-note-details">
              <a className="review-note-link" href={`#note-${encodeURIComponent(note.id)}`} onClick={event => { event.preventDefault(); onSetActiveNote(note.id); onOpenNote(note.id) }}>{note.title || 'Bez tytułu'}<ArrowUpRight size={13} /></a>
              <span>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</span>
            </div> : <div className="review-note-details"><strong>Notatka niedostępna</strong><span>Notatka mogła zostać usunięta.</span></div>}
            <span className="review-note-duration">{formatReviewDuration(reviewNoteTime(session, id, now))}</span>
            {note && <button className="review-active-note-button" onClick={() => onSetActiveNote(id)} aria-pressed={session.activeNoteId === id} title={session.activeNoteId === id ? 'Czas jest przypisywany do tej notatki' : 'Przypisz liczony czas do tej notatki'}>{session.activeNoteId === id ? <><Check size={13} />Aktywna</> : <><BookOpen size={13} />Aktywuj</>}</button>}
          </article>)}
          {!session.noteIds.length && <p className="review-no-notes">Ta powtórka nie zawiera notatek.</p>}
        </div>
      </section>
    </div>
  )
}
