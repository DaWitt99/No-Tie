import { useMemo, useState } from 'react'
import { BookOpen, CalendarDays, Clock3, FileText, Folder, Paperclip, RotateCcw, Search, SlidersHorizontal, Star, Tag } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { searchNotes } from './noteSearch'

type SortMode = 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc' | 'folder-asc' | 'folder-desc'
export type AllNotesPreset = 'all' | 'favorites' | 'recent'

const sortLabels: Record<SortMode, string> = {
  'updated-desc': 'Ostatnio zmienione',
  'updated-asc': 'Najdawniej zmienione',
  'created-desc': 'Najnowsze utworzone',
  'created-asc': 'Najdawniej utworzone',
  'title-asc': 'Tytuł: A–Z',
  'title-desc': 'Tytuł: Z–A',
  'folder-asc': 'Folder: A–Z',
  'folder-desc': 'Folder: Z–A',
}

const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true })
const dateLabel = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' })
const noteCountLabel = (count: number) => count === 1 ? 'notatka' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'notatki' : 'notatek'

function notePreview(content: string) {
  return content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function AllNotesPage({ notes, attachments, searchAttachments = attachments, advancedSearch = true, preset = 'all', initialFolder = '', onFolderChange, onOpen }: {
  notes: Note[]
  attachments: NoteAttachment[]
  searchAttachments?: NoteAttachment[]
  advancedSearch?: boolean
  preset?: AllNotesPreset
  initialFolder?: string
  onFolderChange?: (folder: string) => void
  onOpen: (noteId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [folder, setFolder] = useState(initialFolder)
  const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
  const [favoritesOnly, setFavoritesOnly] = useState(preset === 'favorites')
  const [attachmentsOnly, setAttachmentsOnly] = useState(false)

  const tags = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort(collator.compare), [notes])
  const folders = useMemo(() => [...new Set(notes.map(note => note.folder).filter(Boolean))].sort(collator.compare), [notes])
  const attachmentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const attachment of attachments) counts.set(attachment.noteId, (counts.get(attachment.noteId) ?? 0) + 1)
    return counts
  }, [attachments])

  const filteredNotes = useMemo(() => {
    const results = searchNotes(notes, {
      query,
      tag,
      folder,
      attachments: searchAttachments,
      advanced: advancedSearch,
    }).filter(note => (!favoritesOnly || note.favorite) && (!attachmentsOnly || (attachmentCounts.get(note.id) ?? 0) > 0))

    return results.sort((a, b) => {
      if (sortMode === 'updated-asc') return a.updatedAt - b.updatedAt
      if (sortMode === 'created-desc') return b.createdAt - a.createdAt
      if (sortMode === 'created-asc') return a.createdAt - b.createdAt
      if (sortMode === 'title-asc') return collator.compare(a.title || 'Bez tytułu', b.title || 'Bez tytułu')
      if (sortMode === 'title-desc') return collator.compare(b.title || 'Bez tytułu', a.title || 'Bez tytułu')
      if (sortMode === 'folder-asc') return collator.compare(a.folder || 'Poziom główny', b.folder || 'Poziom główny') || collator.compare(a.title, b.title)
      if (sortMode === 'folder-desc') return collator.compare(b.folder || 'Poziom główny', a.folder || 'Poziom główny') || collator.compare(a.title, b.title)
      return b.updatedAt - a.updatedAt
    })
  }, [notes, query, tag, folder, searchAttachments, advancedSearch, favoritesOnly, attachmentsOnly, attachmentCounts, sortMode])

  const hasFilters = Boolean(query.trim() || tag || folder || favoritesOnly || attachmentsOnly)
  const resetFilters = () => {
    setQuery('')
    setTag('')
    setFolder('')
    onFolderChange?.('')
    setFavoritesOnly(false)
    setAttachmentsOnly(false)
  }

  const changeFolder = (value: string) => {
    setFolder(value)
    onFolderChange?.(value)
  }

  return <section className="all-notes-page">
    <header className="all-notes-heading">
      <span className="all-notes-mark"><BookOpen size={21} /></span>
      <div className="all-notes-heading-copy">
        <p className="eyebrow">BIBLIOTEKA</p>
        <h1>Wszystkie notatki</h1>
        <p>Przeszukuj bibliotekę, zawężaj wyniki i układaj je tak, jak Ci wygodnie.</p>
      </div>
      <div className="all-notes-total"><strong>{notes.length}</strong><span>{noteCountLabel(notes.length)} w bibliotece</span></div>
    </header>

    <div className="all-notes-filter-panel">
      <label className="all-notes-search">
        <Search size={17} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj w tytułach, treści i tagach…" aria-label="Szukaj w notatkach" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Wyczyść wyszukiwanie">×</button>}
      </label>
      <div className="all-notes-filter-controls">
        <label className="all-notes-select"><span><Tag size={13} />Tag</span><select value={tag} onChange={event => setTag(event.target.value)}><option value="">Wszystkie tagi</option>{tags.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className="all-notes-select"><span><Folder size={13} />Folder</span><select value={folder} onChange={event => changeFolder(event.target.value)}><option value="">Wszystkie foldery</option><option value="__root__">Poziom główny</option>{folders.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className="all-notes-select all-notes-sort"><span><SlidersHorizontal size={13} />Sortuj</span><select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>{Object.entries(sortLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="all-notes-toggles">
        <label className="all-notes-toggle"><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)} /><span className="all-notes-toggle-check"><Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /></span>Tylko ulubione</label>
        <label className="all-notes-toggle"><input type="checkbox" checked={attachmentsOnly} onChange={event => setAttachmentsOnly(event.target.checked)} /><span className="all-notes-toggle-check"><Paperclip size={12} /></span>Z załącznikami</label>
        {hasFilters && <button type="button" className="all-notes-reset" onClick={resetFilters}><RotateCcw size={13} />Wyczyść filtry</button>}
      </div>
    </div>

    <div className="all-notes-results-heading">
      <div><h2>{hasFilters ? 'Wyniki wyszukiwania' : 'Biblioteka'}</h2><span>{filteredNotes.length} z {notes.length} {noteCountLabel(notes.length)}</span></div>
      <span className="all-notes-sort-summary"><Clock3 size={13} />{sortLabels[sortMode]}</span>
    </div>

    {filteredNotes.length ? <div className="all-notes-grid">{filteredNotes.map(note => {
      const preview = notePreview(note.content)
      const attachmentCount = attachmentCounts.get(note.id) ?? 0
      return <button type="button" className="all-notes-card" key={note.id} onClick={() => onOpen(note.id)}>
        <span className="all-notes-card-top"><span className="all-notes-card-folder"><Folder size={13} />{note.folder || 'Poziom główny'}</span>{note.favorite && <Star className="all-notes-card-star" size={15} fill="currentColor" aria-label="Ulubiona notatka" />}</span>
        <strong className="all-notes-card-title">{note.title || 'Bez tytułu'}</strong>
        <span className="all-notes-card-preview">{preview || 'Ta notatka nie ma jeszcze treści.'}</span>
        <span className="all-notes-card-tags">{note.tags.length ? <>{note.tags.slice(0, 3).map(value => <span className="all-notes-tag" key={value}>{value}</span>)}{note.tags.length > 3 && <span className="all-notes-tag-more">+{note.tags.length - 3}</span>}</> : <span className="all-notes-no-tags">Bez tagów</span>}</span>
        <span className="all-notes-card-footer"><span><CalendarDays size={12} />Zmieniono {dateLabel.format(note.updatedAt)}</span>{attachmentCount > 0 && <span><Paperclip size={12} />{attachmentCount}</span>}<FileText size={15} className="all-notes-open-mark" /></span>
      </button>
    })}</div> : <div className="all-notes-empty"><span><Search size={20} /></span><strong>{notes.length ? 'Nie znaleziono pasujących notatek' : 'Twoja biblioteka jest pusta'}</strong><p>{notes.length ? 'Zmień hasło lub usuń część filtrów, aby zobaczyć więcej wyników.' : 'Utwórz pierwszą notatkę, a pojawi się tutaj.'}</p>{hasFilters && <button type="button" className="button secondary" onClick={resetFilters}><RotateCcw size={14} />Wyczyść filtry</button>}</div>}
  </section>
}
