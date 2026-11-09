import { useMemo, useState } from 'react'
import { ArrowRight, Check, Search, X } from 'lucide-react'
import type { Note } from './types'

type ReviewSessionDialogProps = {
  notes: Note[]
  onCancel: () => void
  onCreate: (title: string, noteIds: string[]) => void
}

export function ReviewSessionDialog({ notes, onCancel, onCreate }: ReviewSessionDialogProps) {
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedIds.length) return
    onCreate(title.trim(), selectedIds)
  }

  function noteLabel(note: Note) {
    return <><strong>{note.title || 'Bez tytułu'}</strong><span>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</span></>
  }

  return (
    <div className="modal-backdrop review-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="folder-dialog review-session-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
        <div className="folder-dialog-mark"><ArrowRight size={19} /></div>
        <h2 id="review-dialog-title">Utwórz powtórkę</h2>
        <p>Przenieś wybrane notatki na prawą listę. Zostaną zapisane w nowej sesji powtórkowej.</p>
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
                {selectedNotes.map((note, index) => <div className="review-picker-note selected-note" key={note.id}><span className="review-order">{index + 1}</span>{noteLabel(note)}<button type="button" onClick={() => removeNote(note.id)} title="Usuń z powtórki" aria-label={`Usuń ${note.title} z powtórki`}><X size={15} /></button></div>)}
                {!selectedNotes.length && <p className="review-picker-empty">Kliknij notatkę z lewej listy, aby dodać ją tutaj.</p>}
              </div>
            </section>
          </div>
          <div className="folder-dialog-actions">
            <button type="button" className="button secondary" onClick={onCancel}>Anuluj</button>
            <button type="submit" className="button primary" disabled={!selectedIds.length}><Check size={15} />Utwórz powtórkę ({selectedIds.length})</button>
          </div>
        </form>
      </section>
    </div>
  )
}
