import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderHeart, Plus, Search, Trash2 } from 'lucide-react'
import type { Note, NoteCollection } from './types'

export function CollectionsPage({ collections, notes, initialCollectionId = '', onChange, onOpen }: {
  collections: NoteCollection[]
  notes: Note[]
  initialCollectionId?: string
  onChange: (collections: NoteCollection[]) => void
  onOpen: (noteId: string) => void
}) {
  const [activeId, setActiveId] = useState(initialCollectionId || collections[0]?.id || '')
  const lastInitialId = useRef(initialCollectionId)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const active = collections.find(collection => collection.id === activeId) ?? collections[0]
  useEffect(() => {
    if (lastInitialId.current === initialCollectionId) return
    lastInitialId.current = initialCollectionId
    if (initialCollectionId && collections.some(collection => collection.id === initialCollectionId)) setActiveId(initialCollectionId)
  }, [initialCollectionId, collections])
  const filtered = useMemo(() => notes.filter(note => `${note.title} ${note.content} ${note.folder}`.toLocaleLowerCase('pl').includes(query.trim().toLocaleLowerCase('pl'))), [notes, query])
  function createCollection() {
    const name = draft.trim()
    if (!name) return
    const collection = { id: crypto.randomUUID(), name, noteIds: [] }
    onChange([...collections, collection])
    setActiveId(collection.id)
    setDraft('')
  }
  function toggleNote(noteId: string, checked: boolean) {
    if (!active) return
    onChange(collections.map(collection => collection.id !== active.id ? collection : { ...collection, noteIds: checked ? [...new Set([...collection.noteIds, noteId])] : collection.noteIds.filter(id => id !== noteId) }))
  }
  return <section className="workspace-tool-page collections-page">
    <header className="workspace-tool-heading"><span className="workspace-tool-icon"><FolderHeart size={20} /></span><div><p className="eyebrow">ORGANIZACJA</p><h1>Kolekcje</h1><p>Zbieraj notatki z różnych folderów bez zmieniania ich położenia.</p></div></header>
    <div className="collections-layout">
      <aside className="collections-sidebar"><form onSubmit={event => { event.preventDefault(); createCollection() }}><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nazwa kolekcji" aria-label="Nazwa nowej kolekcji" /><button type="submit" className="button primary" disabled={!draft.trim()}><Plus size={14} />Dodaj</button></form>
        {collections.map(collection => <button type="button" key={collection.id} className={`collection-nav ${active?.id === collection.id ? 'active' : ''}`} onClick={() => setActiveId(collection.id)}><FolderHeart size={15} /><span>{collection.name}</span><small>{collection.noteIds.length}</small></button>)}
        {!collections.length && <p className="empty-hint">Utwórz kolekcję, aby zacząć.</p>}
      </aside>
      <div className="collections-content">{active ? <>
        <header><div><h2>{active.name}</h2><p>{active.noteIds.length} {active.noteIds.length === 1 ? 'notatka' : 'notatek'} w kolekcji</p></div><button type="button" className="icon-button danger-icon" aria-label="Usuń kolekcję" title="Usuń kolekcję" onClick={() => { onChange(collections.filter(item => item.id !== active.id)); setActiveId(collections.find(item => item.id !== active.id)?.id ?? '') }}><Trash2 size={16} /></button></header>
        <label className="collection-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Znajdź notatkę do kolekcji" /></label>
        <div className="collection-notes-list">{filtered.map(note => <div className="collection-note-row" key={note.id}><label><input type="checkbox" checked={active.noteIds.includes(note.id)} onChange={event => toggleNote(note.id, event.target.checked)} /><span><strong>{note.title || 'Bez tytułu'}</strong><small>{note.folder || 'Poziom główny'}</small></span></label><button type="button" className="link-button" onClick={() => onOpen(note.id)}>Otwórz</button></div>)}{!filtered.length && <p className="empty-hint">Nie znaleziono notatek.</p>}</div>
      </> : <div className="collections-empty"><FolderHeart size={24} /><strong>Utwórz pierwszą kolekcję</strong><span>Kolekcje grupują notatki niezależnie od folderów.</span></div>}</div>
    </div>
  </section>
}
