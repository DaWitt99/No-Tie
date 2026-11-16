import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Columns3, GripVertical } from 'lucide-react'
import type { Note } from './types'

export type NoteWorkflowStatus = 'idea' | 'doing' | 'done'
export const noteWorkflowColumns: { id: NoteWorkflowStatus; title: string }[] = [{ id: 'idea', title: 'Pomysły' }, { id: 'doing', title: 'W toku' }, { id: 'done', title: 'Gotowe' }]
type NoteBoardDrag = { noteId: string; pointerId: number; startStatus: NoteWorkflowStatus; startX: number; startY: number; active: boolean }

export function NoteBoardPage({ notes, onSetStatus, onOpen, onClose }: { notes: Note[]; onSetStatus: (noteId: string, status: NoteWorkflowStatus) => void; onOpen: (noteId: string) => void; onClose: () => void }) {
  const [drag, setDrag] = useState<NoteBoardDrag | null>(null)
  const activePointerId = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<NoteWorkflowStatus | null>(null)

  function startDrag(note: Note, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || activePointerId.current !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointerId.current = event.pointerId
    setDrag({
      noteId: note.id,
      pointerId: event.pointerId,
      startStatus: (note.properties?.['no-tie-status'] as NoteWorkflowStatus | undefined) ?? 'idea',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    })
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return
    const active = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6
    if (!active) return
    if (!drag.active) setDrag({ ...drag, active: true })
    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-note-status-column]')
    setDropTarget((column?.dataset.noteStatusColumn as NoteWorkflowStatus | undefined) ?? null)
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return
    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-note-status-column]')
    const targetStatus = column?.dataset.noteStatusColumn as NoteWorkflowStatus | undefined
    const active = drag.active || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6
    if (active && targetStatus && targetStatus !== drag.startStatus) onSetStatus(drag.noteId, targetStatus)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    activePointerId.current = null
    setDrag(null)
    setDropTarget(null)
  }

  function cancelDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (activePointerId.current !== event.pointerId) return
    activePointerId.current = null
    setDrag(null)
    setDropTarget(null)
  }

  return <section className="workspace-tool-page note-board-page" aria-labelledby="note-board-title">
    <header className="workspace-tool-heading"><span className="workspace-tool-mark"><Columns3 size={21} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="note-board-title">Statusy notatek</h1><p>{notes.length} notatek · przeciągnij uchwyt karty, aby zmienić status</p></div><button type="button" className="icon-button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
    <div className="workspace-tool-content note-board-content"><div className="note-board-columns">{noteWorkflowColumns.map(column => { const columnNotes = notes.filter(note => (note.properties?.['no-tie-status'] ?? 'idea') === column.id); return <section className={`note-board-column ${dropTarget === column.id ? 'drop-target-active' : ''}`} data-note-status-column={column.id} key={column.id}><h3>{column.title}<span>{columnNotes.length}</span></h3>{columnNotes.map(note => <article className={`note-board-card ${drag?.noteId === note.id && drag.active ? 'is-dragging' : ''}`} key={note.id}><div className="note-board-card-heading"><button type="button" className="note-board-card-title" onClick={() => onOpen(note.id)}>{note.title || 'Bez tytułu'}</button><button type="button" className="note-board-drag-handle" aria-label={`Przeciągnij ${note.title || 'notatkę'} do innego statusu`} title="Przeciągnij do innego statusu" onPointerDown={event => startDrag(note, event)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag}><GripVertical size={16} /></button></div><p>{note.content.replace(/[#>*_`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Pusta notatka'}</p><div><small>{note.folder || 'Bez folderu'} · {note.tags.join(', ') || 'bez tagów'}</small><select aria-label={`Status notatki ${note.title}`} value={(note.properties?.['no-tie-status'] as NoteWorkflowStatus | undefined) ?? 'idea'} onChange={event => onSetStatus(note.id, event.target.value as NoteWorkflowStatus)}>{noteWorkflowColumns.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}</select><ArrowRight size={13} /></div></article>)}{!columnNotes.length && <div className="note-board-empty">Przeciągnij tu notatkę</div>}</section>})}</div></div>
  </section>
}
