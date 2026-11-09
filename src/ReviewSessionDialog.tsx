import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Check, GripVertical, Pencil, Search, X } from 'lucide-react'
import { moveReviewNote } from './reviews'
import { usePointerReorder } from './usePointerReorder'
import type { Note, ReviewSession } from './types'

type ReviewSessionDialogProps = {
  notes: Note[]
  session?: ReviewSession
  onCancel: () => void
  onSave: (title: string, noteIds: string[]) => void
}

export function ReviewSessionDialog({ notes, session, onCancel, onSave }: ReviewSessionDialogProps) {
  const [title, setTitle] = useState(() => session?.title ?? '')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(() => session?.noteIds.filter(id => notes.some(note => note.id === id)) ?? [])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const { draggingNoteId, dropTargetNoteId, dropAfter, dragPosition, startDrag } = usePointerReorder(selectedIds, setSelectedIds)
  const availableNotes = useMemo(() => notes
    .filter(note => !selected.has(note.id))
    .filter(note => `${note.title} ${note.folder} ${note.tags.join(' ')}`.toLocaleLowerCase('pl').includes(query.trim().toLocaleLowerCase('pl')))
    .sort((a, b) => a.title.localeCompare(b.title, 'pl')), [notes, query, selected])
  const selectedNotes = selectedIds.map(id => notes.find(note => note.id === id)).filter((note): note is Note => Boolean(note))

  function addNote(id: string) {
    setSelectedIds(current => current.includes(id) ? current : [...current, id])
  }

  function removeNote(id: string) {
    setSelectedIds(current => current.filter(selectedId => selectedId !== id))
  }

  function moveNote(id: string, index: number) {
    setSelectedIds(current => moveReviewNote(current, id, index))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedIds.length) return
    onSave(title.trim(), selectedIds)
  }

  function noteLabel(note: Note) {
    return <span className="review-picker-note-label"><strong>{note.title || 'Bez tytułu'}</strong><span>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</span></span>
  }

  return (
    <div className="modal-backdrop review-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="folder-dialog review-session-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
        <div className="folder-dialog-mark">{session ? <Pencil size={18} /> : <ArrowRight size={19} />}</div>
        <h2 id="review-dialog-title">{session ? 'Edytuj powtórkę' : 'Utwórz powtórkę'}</h2>
        <p>{session ? 'Zmień nazwę, kolejność lub skład zapisanej powtórki.' : 'Przenieś wybrane notatki na prawą listę. Zostaną zapisane w nowej sesji powtórkowej.'}</p>
        <form onSubmit={submit}>
          <label htmlFor="review-session-title">Nazwa powtórki</label>
          <input id="review-session-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="np. Powtórka z biologii" />
          <div className="review-picker-columns">
            <section className="review-picker-column" aria-labelledby="review-available-title">
              <header><strong id="review-available-title">Wszystkie notatki</strong><span>{availableNotes.length}</span></header>
              <label className="review-picker-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj notatek…" aria-label="Szukaj notatek do powtórki" /></label>
              <div className="review-picker-list">
                {availableNotes.map(note => <button className="review-picker-note" type="button" key={note.id} onClick={() => addNote(note.id)} title="Dodaj do powtórki">{noteLabel(note)}<ArrowRight size={15} /></button>)}
                {!availableNotes.length && <p className="review-picker-empty">{notes.length ? 'Brak pasujących notatek.' : 'Nie ma jeszcze notatek do powtórki.'}</p>}
              </div>
            </section>
            <section className="review-picker-column selected" aria-labelledby="review-selected-title">
              <header><strong id="review-selected-title">Wybrane do powtórki</strong><span>{selectedNotes.length}</span></header>
              <div className="review-picker-list selected-list">
                {selectedNotes.map((note, index) => <div
                  className={`review-picker-note selected-note ${draggingNoteId === note.id ? 'dragging' : ''} ${dropTargetNoteId === note.id ? `drop-target ${dropAfter ? 'drop-after' : 'drop-before'}` : ''}`}
                  key={note.id}
                  data-review-reorder-id={note.id}
                >
                  <span className="review-order">{index + 1}</span>
                  <button
                    type="button"
                    className="review-drag-handle"
                    onPointerDown={event => startDrag(event, note.id)}
                    title="Przeciągnij, aby zmienić kolejność"
                    aria-label={`Zmień kolejność notatki ${note.title}`}
                    draggable={false}
                    onDragStart={event => event.preventDefault()}
                  ><GripVertical size={15} /></button>
                  {noteLabel(note)}
                  <div className="review-reorder-actions">
                    <button type="button" disabled={index === 0} onClick={() => moveNote(note.id, index - 1)} title="Przenieś wyżej" aria-label={`Przenieś ${note.title} wyżej`}><ArrowUp size={13} /></button>
                    <button type="button" disabled={index === selectedNotes.length - 1} onClick={() => moveNote(note.id, index + 1)} title="Przenieś niżej" aria-label={`Przenieś ${note.title} niżej`}><ArrowDown size={13} /></button>
                  </div>
                  <button className="review-remove-button" type="button" onClick={() => removeNote(note.id)} title="Usuń z powtórki" aria-label={`Usuń ${note.title} z powtórki`}><X size={15} /></button>
                </div>)}
                {!selectedNotes.length && <p className="review-picker-empty">Kliknij notatkę z lewej listy, aby dodać ją tutaj.</p>}
              </div>
            </section>
          </div>
          {draggingNoteId && dragPosition && <div className="review-drag-ghost" style={{ left: dragPosition.x, top: dragPosition.y }} aria-hidden="true"><GripVertical size={14} /><strong>{selectedNotes.find(note => note.id === draggingNoteId)?.title || 'Notatka'}</strong></div>}
          <div className="folder-dialog-actions">
            <button type="button" className="button secondary" onClick={onCancel}>Anuluj</button>
            <button type="submit" className="button primary" disabled={!selectedIds.length}><Check size={15} />{session ? `Zapisz zmiany (${selectedIds.length})` : `Utwórz powtórkę (${selectedIds.length})`}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
