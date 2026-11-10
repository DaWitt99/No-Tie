import { useState, type FormEvent } from 'react'
import { BookmarkPlus, Play, Trash2, X } from 'lucide-react'
import type { SavedSearch } from './types'

export function SavedSearchDialog({ searches, current, onSave, onApply, onDelete, onClose }: {
  searches: SavedSearch[]
  current: Omit<SavedSearch, 'id' | 'name'>
  onSave: (name: string) => void
  onApply: (search: SavedSearch) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const filtersActive = Boolean(current.query || current.tag || current.folder)
  function submit(event: FormEvent) { event.preventDefault(); if (name.trim()) { onSave(name.trim()); setName('') } }
  return <div className="modal-backdrop saved-search-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="saved-search-dialog" role="dialog" aria-modal="true" aria-labelledby="saved-search-title">
      <header><span className="folder-dialog-mark"><BookmarkPlus size={19} /></span><div><h2 id="saved-search-title">Zapisane wyszukiwania</h2><p>Utrwal zapytanie i filtry jako własny widok.</p></div><button type="button" className="icon-button" aria-label="Zamknij zapisane wyszukiwania" onClick={onClose}><X size={17} /></button></header>
      <form className="saved-search-create" onSubmit={submit}><input aria-label="Nazwa zapisanego wyszukiwania" value={name} onChange={event => setName(event.target.value)} placeholder="Nazwa widoku, np. Projekty do sprawdzenia" /><button type="submit" className="button primary" disabled={!name.trim() || !filtersActive}><BookmarkPlus size={15} />Zapisz bieżące</button></form>
      {!filtersActive && <p className="saved-search-hint">Najpierw wpisz zapytanie lub wybierz filtr tagu/folderu w bibliotece.</p>}
      <div className="saved-search-list">{searches.map(search => <div className="saved-search-row" key={search.id}><div><strong>{search.name}</strong><span>{[search.query && `„${search.query}”`, search.tag && `tag: ${search.tag}`, search.folder && `folder: ${search.folder === '__root__' ? 'Bez folderu' : search.folder}`].filter(Boolean).join(' · ') || 'Wszystkie notatki'}</span></div><button className="icon-button" type="button" aria-label={`Otwórz ${search.name}`} onClick={() => onApply(search)}><Play size={15} /></button><button className="icon-button danger-icon" type="button" aria-label={`Usuń ${search.name}`} onClick={() => onDelete(search.id)}><Trash2 size={15} /></button></div>)}{!searches.length && <div className="saved-search-empty">Nie zapisano jeszcze żadnych widoków.</div>}</div>
    </section>
  </div>
}
