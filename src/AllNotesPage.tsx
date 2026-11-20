import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen, CalendarDays, Clock3, FileText, Folder, GripVertical, Paperclip, RotateCcw, Search, SlidersHorizontal, Star, Tag, ArrowDown, ArrowUp } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { searchNotes, searchQueryNeedsContent } from './noteSearch'
import { VirtualizedGrid } from './VirtualizedGrid'

type SortMode = 'manual' | 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc' | 'folder-asc' | 'folder-desc'
export type AllNotesPreset = 'all' | 'favorites' | 'recent'

const sortLabels: Record<SortMode, string> = {
  manual: 'Własna kolejność',
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
const entryColorStyle = (color?: string): CSSProperties | undefined => color ? { '--entry-color': color } as CSSProperties : undefined
const notePreviewCache = new WeakMap<Note, string>()
const externalNotePreviewCache = new WeakMap<Note, { content: string; preview: string }>()

function notePreview(content: string) {
  return content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cachedNotePreview(note: Note, contentByNote?: ReadonlyMap<string, string>) {
  const externalContent = contentByNote?.get(note.id)
  if (externalContent !== undefined) {
    const cachedExternal = externalNotePreviewCache.get(note)
    if (cachedExternal?.content === externalContent) return cachedExternal.preview
    const preview = notePreview(externalContent)
    externalNotePreviewCache.set(note, { content: externalContent, preview })
    return preview
  }
  const cached = notePreviewCache.get(note)
  if (cached !== undefined) return cached
  const preview = notePreview(note.content)
  notePreviewCache.set(note, preview)
  return preview
}

export function AllNotesPage({ notes, attachments, searchAttachments = attachments, contentByNote, normalizedContentByNote, onSearchContentChange, onVisibleNotes, advancedSearch = true, preset = 'all', initialFolder = '', onFolderChange, noteOrder = [], onReorder, getNoteColor, onOpen }: {
  notes: Note[]
  attachments: NoteAttachment[]
  searchAttachments?: NoteAttachment[]
  contentByNote?: ReadonlyMap<string, string>
  normalizedContentByNote?: ReadonlyMap<string, string>
  onSearchContentChange?: (needsContent: boolean) => void
  onVisibleNotes?: (notes: Note[]) => void
  advancedSearch?: boolean
  preset?: AllNotesPreset
  initialFolder?: string
  onFolderChange?: (folder: string) => void
  noteOrder?: string[]
  onReorder?: (sourceId: string, targetId: string) => void
  getNoteColor: (note: Note) => string | undefined
  onOpen: (noteId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [folder, setFolder] = useState(initialFolder)
  const [sortMode, setSortMode] = useState<SortMode>('manual')
  const [favoritesOnly, setFavoritesOnly] = useState(preset === 'favorites')
  const [attachmentsOnly, setAttachmentsOnly] = useState(false)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    onSearchContentChange?.(searchQueryNeedsContent(deferredQuery, advancedSearch))
    return () => onSearchContentChange?.(false)
  }, [deferredQuery, advancedSearch, onSearchContentChange])

  const tags = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort(collator.compare), [notes])
  const folders = useMemo(() => [...new Set(notes.map(note => note.folder).filter(Boolean))].sort(collator.compare), [notes])
  const attachmentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const attachment of attachments) counts.set(attachment.noteId, (counts.get(attachment.noteId) ?? 0) + 1)
    return counts
  }, [attachments])
  const noteOrderIndex = useMemo(() => new Map(noteOrder.map((id, index) => [id, index])), [noteOrder])

  const filteredNotes = useMemo(() => {
    const results = searchNotes(notes, {
      query: deferredQuery,
      tag,
      folder,
      attachments: searchAttachments,
      contentByNote,
      normalizedContentByNote,
      advanced: advancedSearch,
      sortByUpdated: false,
    }).filter(note => (!favoritesOnly || note.favorite) && (!attachmentsOnly || (attachmentCounts.get(note.id) ?? 0) > 0))

    return results.sort((a, b) => {
      if (sortMode === 'manual') {
        return (noteOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (noteOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER) || b.updatedAt - a.updatedAt
      }
      if (sortMode === 'updated-asc') return a.updatedAt - b.updatedAt
      if (sortMode === 'created-desc') return b.createdAt - a.createdAt
      if (sortMode === 'created-asc') return a.createdAt - b.createdAt
      if (sortMode === 'title-asc') return collator.compare(a.title || 'Bez tytułu', b.title || 'Bez tytułu')
      if (sortMode === 'title-desc') return collator.compare(b.title || 'Bez tytułu', a.title || 'Bez tytułu')
      if (sortMode === 'folder-asc') return collator.compare(a.folder || 'Poziom główny', b.folder || 'Poziom główny') || collator.compare(a.title, b.title)
      if (sortMode === 'folder-desc') return collator.compare(b.folder || 'Poziom główny', a.folder || 'Poziom główny') || collator.compare(a.title, b.title)
      return b.updatedAt - a.updatedAt
    })
  }, [notes, deferredQuery, tag, folder, searchAttachments, contentByNote, normalizedContentByNote, advancedSearch, favoritesOnly, attachmentsOnly, attachmentCounts, sortMode, noteOrderIndex])

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

    {filteredNotes.length ? <VirtualizedGrid
      className="all-notes-grid"
      items={filteredNotes}
      keyOf={note => note.id}
      onItemsRendered={(start, end) => onVisibleNotes?.(filteredNotes.slice(start, end))}
      renderItem={(note, noteIndex) => {
      const preview = cachedNotePreview(note, contentByNote)
      const attachmentCount = attachmentCounts.get(note.id) ?? 0
      const color = getNoteColor(note)
      return <article draggable={sortMode === 'manual' && Boolean(onReorder)} onDragStart={event => event.dataTransfer.setData('text/no-tie-note-id', note.id)} onDragOver={event => { if (sortMode === 'manual') event.preventDefault() }} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/no-tie-note-id'); if (sourceId && sourceId !== note.id) onReorder?.(sourceId, note.id) }} className={`all-notes-card ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)}>
        <div className="all-notes-card-top"><span className="all-notes-card-folder"><Folder size={13} />{note.folder || 'Poziom główny'}</span><span className="all-notes-card-top-actions">{sortMode === 'manual' && <><GripVertical size={14} className="all-notes-drag-handle" aria-hidden="true" /><button type="button" className="all-notes-move-button" title="Przenieś wyżej" aria-label={`Przenieś notatkę ${note.title} wyżej`} disabled={!noteIndex} onClick={() => onReorder?.(note.id, filteredNotes[noteIndex - 1]!.id)}><ArrowUp size={13} /></button><button type="button" className="all-notes-move-button" title="Przenieś niżej" aria-label={`Przenieś notatkę ${note.title} niżej`} disabled={noteIndex === filteredNotes.length - 1} onClick={() => onReorder?.(note.id, filteredNotes[noteIndex + 1]!.id)}><ArrowDown size={13} /></button></>}{note.favorite && <Star className="all-notes-card-star" size={15} fill="currentColor" aria-label="Ulubiona notatka" />}</span></div>
        <button type="button" className="all-notes-card-open" onClick={() => onOpen(note.id)}>
        <strong className="all-notes-card-title">{note.title || 'Bez tytułu'}</strong>
        <span className="all-notes-card-preview">{preview || 'Ta notatka nie ma jeszcze treści.'}</span>
        <span className="all-notes-card-tags">{note.tags.length ? <>{note.tags.slice(0, 3).map(value => <span className="all-notes-tag" key={value}>{value}</span>)}{note.tags.length > 3 && <span className="all-notes-tag-more">+{note.tags.length - 3}</span>}</> : <span className="all-notes-no-tags">Bez tagów</span>}</span>
        <span className="all-notes-card-footer"><span><CalendarDays size={12} />Zmieniono {dateLabel.format(note.updatedAt)}</span>{attachmentCount > 0 && <span><Paperclip size={12} />{attachmentCount}</span>}<FileText size={15} className="all-notes-open-mark" /></span>
        </button>
      </article>
    }}
    /> : <div className="all-notes-empty"><span><Search size={20} /></span><strong>{notes.length ? 'Nie znaleziono pasujących notatek' : 'Twoja biblioteka jest pusta'}</strong><p>{notes.length ? 'Zmień hasło lub usuń część filtrów, aby zobaczyć więcej wyników.' : 'Utwórz pierwszą notatkę, a pojawi się tutaj.'}</p>{hasFilters && <button type="button" className="button secondary" onClick={resetFilters}><RotateCcw size={14} />Wyczyść filtry</button>}</div>}
  </section>
}
