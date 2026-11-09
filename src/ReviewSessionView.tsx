import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, Clock3, GripVertical, Pause, Pencil, Play, RotateCcw, Square } from 'lucide-react'
import { formatReviewDuration, moveReviewNote, reviewNoteTime, reviewTotalTime } from './reviews'
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
  const [draggingNoteId, setDraggingNoteId] = useState('')
  const [dropTargetNoteId, setDropTargetNoteId] = useState('')
  const noteById = new Map(notes.map(note => [note.id, note]))
  const sessionNotes = session.noteIds.map(id => ({ id, note: noteById.get(id) }))
  const activeNote = session.activeNoteId ? noteById.get(session.activeNoteId) : undefined
  const totalTime = reviewTotalTime(session, now)

  function moveNote(noteId: string, destinationIndex: number) {
    onReorder(moveReviewNote(session.noteIds, noteId, destinationIndex))
  }

  function handleDrop(event: React.DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggingNoteId
    const sourceIndex = session.noteIds.indexOf(sourceId)
    const row = event.currentTarget.getBoundingClientRect()
    const insertIndex = targetIndex + (event.clientY >= row.top + row.height / 2 ? 1 : 0)
    const destinationIndex = sourceIndex >= 0 && sourceIndex < insertIndex ? insertIndex - 1 : insertIndex
    onReorder(moveReviewNote(session.noteIds, sourceId, destinationIndex))
    setDraggingNoteId('')
    setDropTargetNoteId('')
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
            className={`review-session-note ${session.activeNoteId === id ? 'active' : ''} ${draggingNoteId === id ? 'dragging' : ''} ${dropTargetNoteId === id ? 'drop-target' : ''}`}
            key={id}
            onDragOver={event => { event.preventDefault(); setDropTargetNoteId(id) }}
            onDrop={event => handleDrop(event, index)}
            onDragEnd={() => { setDraggingNoteId(''); setDropTargetNoteId('') }}
          >
            <span className="review-note-number">{String(index + 1).padStart(2, '0')}</span>
            {note && <span
              className="review-drag-handle"
              draggable
              title="Przeciągnij, aby zmienić kolejność"
              aria-label={`Zmień kolejność notatki ${note.title}`}
              onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDraggingNoteId(id) }}
            ><GripVertical size={15} /></span>}
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
    </div>
  )
}
