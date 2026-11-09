import { ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, Clock3, GripVertical, Pause, Pencil, Play, RotateCcw, Square } from 'lucide-react'
import { formatReviewDuration, moveReviewNote, reviewNoteTime, reviewTotalTime } from './reviews'
import { usePointerReorder } from './usePointerReorder'
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
  onEdit: () => void
  onReorder: (noteIds: string[]) => void
}

function sessionStatusLabel(status: ReviewSession['status']) {
  if (status === 'running') return 'W trakcie'
  if (status === 'paused') return 'Wstrzymana'
  if (status === 'completed') return 'Zakończona'
  return 'Gotowa'
}

export function ReviewSessionView({ session, notes, now, onStart, onPause, onFinish, onReset, onSetActiveNote, onOpenNote, onEdit, onReorder }: ReviewSessionViewProps) {
  const { draggingNoteId, dropTargetNoteId, dropAfter, dragPosition, startDrag } = usePointerReorder(session.noteIds, onReorder)
  const noteById = new Map(notes.map(note => [note.id, note]))
  const sessionNotes = session.noteIds.map(id => ({ id, note: noteById.get(id) }))
  const activeNote = session.activeNoteId ? noteById.get(session.activeNoteId) : undefined
  const totalTime = reviewTotalTime(session, now)

  function moveNote(noteId: string, destinationIndex: number) {
    onReorder(moveReviewNote(session.noteIds, noteId, destinationIndex))
  }

  return (
    <div className="review-session-view">
      <div className="review-view-heading">
        <div>
          <p className="eyebrow">POWTÓRKA</p>
          <h1>{session.title}</h1>
          <span>Utworzono {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(session.createdAt)}</span>
        </div>
          <div className="review-view-heading-actions">
            <button className="button secondary review-edit-button" onClick={onEdit}><Pencil size={14} />Edytuj powtórkę</button>
            <span className={`review-status-badge ${session.status}`}><i />{sessionStatusLabel(session.status)}</span>
          </div>
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
        <p className="review-session-hint">Wybierz aktywną notatkę, aby przypisać jej czas. Kliknij tytuł, by ją otworzyć; przeciągnij uchwyt lub użyj strzałek, aby zmienić kolejność.</p>
        <div className="review-session-notes">
          {sessionNotes.map(({ id, note }, index) => <article
            className={`review-session-note ${session.activeNoteId === id ? 'active' : ''} ${draggingNoteId === id ? 'dragging' : ''} ${dropTargetNoteId === id ? `drop-target ${dropAfter ? 'drop-after' : 'drop-before'}` : ''}`}
            key={id}
            data-review-reorder-id={id}
          >
            <span className="review-note-number">{String(index + 1).padStart(2, '0')}</span>
            {note && <button
              type="button"
              className="review-drag-handle"
              onPointerDown={event => startDrag(event, id)}
              title="Przeciągnij, aby zmienić kolejność"
              aria-label={`Zmień kolejność notatki ${note.title}`}
              draggable={false}
              onDragStart={event => event.preventDefault()}
            ><GripVertical size={15} /></button>}
            {note ? <div className="review-note-details">
              <a className="review-note-link" href={`#note-${encodeURIComponent(note.id)}`} onClick={event => { event.preventDefault(); onSetActiveNote(note.id); onOpenNote(note.id) }}>{note.title || 'Bez tytułu'}<ArrowUpRight size={13} /></a>
              <span>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</span>
            </div> : <div className="review-note-details"><strong>Notatka niedostępna</strong><span>Notatka mogła zostać usunięta.</span></div>}
            <span className="review-note-duration">{formatReviewDuration(reviewNoteTime(session, id, now))}</span>
            {note && <>
              <div className="review-reorder-actions">
                <button type="button" disabled={index === 0} onClick={() => moveNote(id, index - 1)} title="Przenieś wyżej" aria-label={`Przenieś ${note.title} wyżej`}><ArrowUp size={13} /></button>
                <button type="button" disabled={index === sessionNotes.length - 1} onClick={() => moveNote(id, index + 1)} title="Przenieś niżej" aria-label={`Przenieś ${note.title} niżej`}><ArrowDown size={13} /></button>
              </div>
              <button className="review-active-note-button" onClick={() => onSetActiveNote(id)} aria-pressed={session.activeNoteId === id} title={session.activeNoteId === id ? 'Czas jest przypisywany do tej notatki' : 'Przypisz liczony czas do tej notatki'}>{session.activeNoteId === id ? <><Check size={13} />Aktywna</> : <><BookOpen size={13} />Aktywuj</>}</button>
            </>}
          </article>)}
          {!session.noteIds.length && <p className="review-no-notes">Ta powtórka nie zawiera notatek.</p>}
        </div>
      </section>
      {draggingNoteId && dragPosition && <div className="review-drag-ghost" style={{ left: dragPosition.x, top: dragPosition.y }} aria-hidden="true"><GripVertical size={14} /><strong>{noteById.get(draggingNoteId)?.title || 'Notatka'}</strong></div>}
    </div>
  )
}
