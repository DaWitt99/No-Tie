import { useDeferredValue, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen, CalendarDays, Check, CheckSquare2, ChevronDown, Clock3, FileText, Folder, GripVertical, LoaderCircle, Palette, Paperclip, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, Tag, ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import { searchNotes } from './noteSearch'
import { VirtualizedGrid } from './VirtualizedGrid'
import { VirtualizedList } from './VirtualizedList'

type SortMode = 'manual' | 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc' | 'folder-asc' | 'folder-desc'
type DisplayMode = 'cards' | 'full' | 'names-tags' | 'names'
type NoteColorOption = { value: string; label: string }
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

export function AllNotesPage({ notes, attachments, searchAttachments = attachments, contentByNote, normalizedContentByNote, onVisibleNotes, advancedSearch = true, preset = 'all', onFolderChange, query, onQueryChange, tag, onTagChange, folder, semanticSearchEnabled = false, onSemanticSearchChange, semanticScores = {}, semanticSearchBusy = false, semanticSearchError = '', searchIndexProgress, bulkActionsEnabled = false, bulkSelectMode = false, onToggleBulkSelect, bulkSelectedIds = [], onBulkSelectedIdsChange, bulkTargetFolder = '', onBulkTargetFolderChange, bulkTagDraft = '', onBulkTagDraftChange, onMoveSelected, onApplySelectedTag, onDeleteSelected, foldersForBulk = [], noteOrder = [], onReorder, getNoteColor, noteColors, colorOptions, onOpen }: {
  notes: Note[]
  attachments: NoteAttachment[]
  searchAttachments?: NoteAttachment[]
  contentByNote?: ReadonlyMap<string, string>
  normalizedContentByNote?: ReadonlyMap<string, string>
  onVisibleNotes?: (notes: Note[]) => void
  advancedSearch?: boolean
  preset?: AllNotesPreset
  onFolderChange?: (folder: string) => void
  query: string
  onQueryChange: (query: string) => void
  tag: string
  onTagChange: (tag: string) => void
  folder: string
  semanticSearchEnabled?: boolean
  onSemanticSearchChange?: (enabled: boolean) => void
  semanticScores?: Record<string, number>
  semanticSearchBusy?: boolean
  semanticSearchError?: string
  searchIndexProgress?: { done: number; total: number } | null
  bulkActionsEnabled?: boolean
  bulkSelectMode?: boolean
  onToggleBulkSelect?: () => void
  bulkSelectedIds?: string[]
  onBulkSelectedIdsChange?: (ids: string[]) => void
  bulkTargetFolder?: string
  onBulkTargetFolderChange?: (folder: string) => void
  bulkTagDraft?: string
  onBulkTagDraftChange?: (value: string) => void
  onMoveSelected?: () => void
  onApplySelectedTag?: () => void
  onDeleteSelected?: () => void
  foldersForBulk?: string[]
  noteOrder?: string[]
  onReorder?: (sourceId: string, targetId: string) => void
  getNoteColor: (note: Note) => string | undefined
  noteColors: ReadonlyMap<string, string | undefined>
  colorOptions: NoteColorOption[]
  onOpen: (noteId: string) => void
}) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const stored = localStorage.getItem('no-tie-note-display-mode')
    return stored === 'names' || stored === 'names-tags' || stored === 'full' ? stored : 'cards'
  })
  const [gridColumns, setGridColumns] = useState(() => {
    const stored = Number(localStorage.getItem('no-tie-library-grid-columns'))
    return Number.isInteger(stored) && stored >= 1 && stored <= 4 ? stored : 0
  })
  const [colorFilter, setColorFilter] = useState('')
  const colorFilterLabel = colorFilter === '__none__' ? 'Bez koloru' : colorOptions.find(color => color.value === colorFilter)?.label ?? 'Wszystkie kolory'
  const [sortMode, setSortMode] = useState<SortMode>(preset === 'recent' ? 'updated-desc' : 'manual')
  const [favoritesOnly, setFavoritesOnly] = useState(preset === 'favorites')
  const [attachmentsOnly, setAttachmentsOnly] = useState(false)
  const [advancedHelpOpen, setAdvancedHelpOpen] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const hasSemanticScores = semanticSearchEnabled && Boolean(deferredQuery.trim()) && Object.keys(semanticScores).length > 0

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
      query: semanticSearchEnabled ? '' : deferredQuery,
      tag,
      folder,
      attachments: searchAttachments,
      contentByNote,
      normalizedContentByNote,
      advanced: advancedSearch,
      sortByUpdated: false,
    }).filter(note => (!favoritesOnly || note.favorite) && (!attachmentsOnly || (attachmentCounts.get(note.id) ?? 0) > 0))
      .filter(note => !colorFilter || (colorFilter === '__none__' ? !noteColors.get(note.id) : noteColors.get(note.id) === colorFilter))
      .filter(note => !hasSemanticScores || (semanticScores[note.id] ?? -1) >= .12)

    return results.sort((a, b) => {
      if (hasSemanticScores) {
        return (semanticScores[b.id] ?? -1) - (semanticScores[a.id] ?? -1)
      }
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
  }, [notes, deferredQuery, tag, folder, searchAttachments, contentByNote, normalizedContentByNote, advancedSearch, favoritesOnly, attachmentsOnly, attachmentCounts, colorFilter, noteColors, sortMode, noteOrderIndex, semanticSearchEnabled, semanticScores, hasSemanticScores])

  const hasFilters = Boolean(query.trim() || tag || folder || favoritesOnly || attachmentsOnly || colorFilter)
  const selectedIds = new Set(bulkSelectedIds)
  const toggleSelected = (noteId: string, checked?: boolean) => {
    const shouldSelect = checked ?? !selectedIds.has(noteId)
    onBulkSelectedIdsChange?.(shouldSelect ? [...new Set([...bulkSelectedIds, noteId])] : bulkSelectedIds.filter(id => id !== noteId))
  }
  const changeDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode)
    if (mode === 'full' || mode === 'names-tags' || mode === 'names') localStorage.setItem('no-tie-note-display-mode', mode)
    else localStorage.removeItem('no-tie-note-display-mode')
  }
  const changeGridColumns = (value: number) => {
    setGridColumns(value)
    if (value) localStorage.setItem('no-tie-library-grid-columns', String(value))
    else localStorage.removeItem('no-tie-library-grid-columns')
  }
  const resetFilters = () => {
    onQueryChange('')
    onTagChange('')
    onFolderChange?.('')
    setFavoritesOnly(false)
    setAttachmentsOnly(false)
    setColorFilter('')
  }

  const changeFolder = (value: string) => {
    onFolderChange?.(value)
  }

  return <section className="all-notes-page">
    <header className="all-notes-heading">
      <span className="all-notes-mark"><BookOpen size={21} /></span>
      <div className="all-notes-heading-copy">
        <p className="eyebrow">TWOJA PRZESTRZEŃ</p>
        <h1>Biblioteka</h1>
        <p>Wyszukuj, filtruj i porządkuj wszystkie notatki w jednym widoku.</p>
      </div>
      <div className="all-notes-total"><strong>{notes.length}</strong><span>{noteCountLabel(notes.length)} w bibliotece</span></div>
    </header>

    <div className="all-notes-filter-panel">
      <label className="all-notes-search">
        <Search size={17} aria-hidden="true" />
        <input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Szukaj w tytułach, treści i tagach…" aria-label="Szukaj w notatkach" />
        {query && <button type="button" onClick={() => onQueryChange('')} aria-label="Wyczyść wyszukiwanie">×</button>}
      </label>
      <div className="all-notes-filter-controls">
        <label className="all-notes-select"><span><Tag size={13} />Tag</span><select value={tag} onChange={event => onTagChange(event.target.value)}><option value="">Wszystkie tagi</option>{tags.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className="all-notes-select"><span><Folder size={13} />Folder</span><select value={folder} onChange={event => changeFolder(event.target.value)}><option value="">Wszystkie foldery</option><option value="__root__">Poziom główny</option>{folders.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <div className="all-notes-select all-notes-color-filter"><span><Palette size={13} />Kolor notatki</span><details className="all-notes-color-dropdown" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open') }}>
          <summary aria-label="Filtruj notatki według koloru"><span className="all-notes-color-current">{colorFilter && colorFilter !== '__none__' ? <i className="all-notes-color-swatch" style={{ backgroundColor: colorFilter }} /> : colorFilter === '__none__' ? <i className="all-notes-color-swatch is-empty" /> : <Palette size={14} />}{colorFilterLabel}</span><ChevronDown size={14} /></summary>
          <div className="all-notes-color-options" role="group" aria-label="Kolor notatki">
            <button type="button" aria-pressed={!colorFilter} onClick={event => { setColorFilter(''); event.currentTarget.closest('details')?.removeAttribute('open') }}><Palette size={14} />Wszystkie kolory{!colorFilter && <Check size={13} />}</button>
            <button type="button" aria-pressed={colorFilter === '__none__'} onClick={event => { setColorFilter('__none__'); event.currentTarget.closest('details')?.removeAttribute('open') }}><i className="all-notes-color-swatch is-empty" />Bez koloru{colorFilter === '__none__' && <Check size={13} />}</button>
            {colorOptions.map(color => <button type="button" key={color.value} aria-pressed={colorFilter === color.value} onClick={event => { setColorFilter(color.value); event.currentTarget.closest('details')?.removeAttribute('open') }}><i className="all-notes-color-swatch" style={{ backgroundColor: color.value }} />{color.label}{colorFilter === color.value && <Check size={13} />}</button>)}
          </div>
        </details></div>
        <label className="all-notes-select all-notes-sort"><span><SlidersHorizontal size={13} />Sortuj</span><select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>{Object.entries(sortLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="all-notes-toggles">
        <label className="all-notes-toggle"><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)} /><span className="all-notes-toggle-check"><Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /></span>Tylko ulubione</label>
        <label className="all-notes-toggle"><input type="checkbox" checked={attachmentsOnly} onChange={event => setAttachmentsOnly(event.target.checked)} /><span className="all-notes-toggle-check"><Paperclip size={12} /></span>Z załącznikami</label>
        {hasFilters && <button type="button" className="all-notes-reset" onClick={resetFilters}><RotateCcw size={13} />Wyczyść filtry</button>}
      </div>
      {(advancedSearch || onSemanticSearchChange) && <div className="all-notes-search-options">
        {advancedSearch && <button className="all-notes-advanced-toggle" type="button" aria-expanded={advancedHelpOpen} onClick={() => setAdvancedHelpOpen(open => !open)}><SlidersHorizontal size={13} />Składnia wyszukiwania</button>}
        {onSemanticSearchChange && <label className="all-notes-toggle all-notes-semantic-toggle"><input type="checkbox" checked={semanticSearchEnabled} onChange={event => onSemanticSearchChange(event.target.checked)} /><span className="all-notes-toggle-check"><Sparkles size={12} /></span>Szukaj semantycznie{semanticSearchBusy && <LoaderCircle size={12} className="all-notes-spinner" />}</label>}
        {advancedHelpOpen && advancedSearch && <p className="all-notes-query-help">Użyj <code>tag:projekt</code>, <code>folder:Praca</code>, <code>title:spotkanie</code>, <code>content:ustalenia</code>, <code>after:2026-01-01</code>, <code>has:pdf</code>, <code>OR</code> lub <code>NOT</code>.</p>}
        {semanticSearchError && <span className="all-notes-search-error" role="status">{semanticSearchError}</span>}
      </div>}
    </div>

    {searchIndexProgress && <div className="all-notes-index-status" role="status"><LoaderCircle size={13} />Wczytuję treść do wyszukiwania: {searchIndexProgress.done.toLocaleString('pl-PL')} / {searchIndexProgress.total.toLocaleString('pl-PL')}</div>}
    {bulkActionsEnabled && <div className="all-notes-bulk-toolbar">
      <button type="button" className={`button ${bulkSelectMode ? 'primary' : 'secondary'}`} onClick={onToggleBulkSelect}><CheckSquare2 size={14} />{bulkSelectMode ? 'Zakończ zaznaczanie' : 'Zaznacz notatki'}</button>
      {bulkSelectMode && <><span className="all-notes-selected-count">{bulkSelectedIds.length} zaznaczono</span><button type="button" className="link-button" onClick={() => onBulkSelectedIdsChange?.(filteredNotes.map(note => note.id))}>Zaznacz wyniki</button>
        <label className="all-notes-bulk-field"><span>Przenieś do</span><select aria-label="Przenieś zaznaczone notatki do folderu" value={bulkTargetFolder} onChange={event => onBulkTargetFolderChange?.(event.target.value)}><option value="">Poziom główny</option>{foldersForBulk.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" className="button secondary" disabled={!bulkSelectedIds.length} onClick={onMoveSelected}>Przenieś</button>
        <label className="all-notes-bulk-field all-notes-tag-field"><span>Tag do dodania lub usunięcia</span><input aria-label="Tag dla zaznaczonych notatek" value={bulkTagDraft} onChange={event => onBulkTagDraftChange?.(event.target.value)} placeholder="Nazwa tagu" /></label>
        <button type="button" className="button secondary" disabled={!bulkTagDraft.trim() || !bulkSelectedIds.length} onClick={onApplySelectedTag}>Zastosuj tag</button>
        <button type="button" className="button danger-button" disabled={!bulkSelectedIds.length} onClick={onDeleteSelected}><Trash2 size={13} />Do kosza</button>
      </>}
    </div>}

    <div className="all-notes-results-heading">
      <div><h2>{hasFilters ? 'Wyniki wyszukiwania' : 'Biblioteka'}</h2><span>{filteredNotes.length} z {notes.length} {noteCountLabel(notes.length)}</span></div>
      <div className="all-notes-results-actions">
        <label className="all-notes-display-select"><span>Widok wyników</span><select value={displayMode} onChange={event => changeDisplayMode(event.target.value as DisplayMode)} aria-label="Sposób wyświetlania wyników wyszukiwania"><option value="cards">Siatka</option><option value="full">Lista: treść i tagi</option><option value="names-tags">Lista: nazwy i tagi</option><option value="names">Lista: same nazwy</option></select></label>
        {displayMode === 'cards' && <label className="all-notes-display-select"><span>Kolumny</span><select value={gridColumns || 'auto'} onChange={event => changeGridColumns(event.target.value === 'auto' ? 0 : Number(event.target.value))} aria-label="Szerokość siatki wyników"><option value="auto">Auto</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>}
        {hasSemanticScores
          ? <span className="all-notes-sort-summary"><Sparkles size={13} />Dopasowanie semantyczne</span>
          : <span className="all-notes-sort-summary"><Clock3 size={13} />{sortLabels[sortMode]}</span>}
      </div>
    </div>

    {filteredNotes.length && displayMode === 'cards' ? <VirtualizedGrid
      className="all-notes-grid"
      items={filteredNotes}
      preferredColumns={gridColumns || undefined}
      keyOf={note => note.id}
      onItemsRendered={(start, end) => onVisibleNotes?.(filteredNotes.slice(start, end))}
      renderItem={(note, noteIndex) => {
      const preview = cachedNotePreview(note, contentByNote)
      const attachmentCount = attachmentCounts.get(note.id) ?? 0
      const color = getNoteColor(note)
      return <article draggable={sortMode === 'manual' && Boolean(onReorder) && !bulkSelectMode} onDragStart={event => event.dataTransfer.setData('text/no-tie-note-id', note.id)} onDragOver={event => { if (sortMode === 'manual') event.preventDefault() }} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/no-tie-note-id'); if (sourceId && sourceId !== note.id) onReorder?.(sourceId, note.id) }} className={`all-notes-card ${selectedIds.has(note.id) ? 'is-bulk-selected' : ''} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)}>
        <div className="all-notes-card-top">{bulkSelectMode && <label className="all-notes-card-select"><input type="checkbox" checked={selectedIds.has(note.id)} onChange={event => toggleSelected(note.id, event.target.checked)} aria-label={`Zaznacz notatkę ${note.title || 'Bez tytułu'}`} /><span><Check size={11} /></span></label>}<span className="all-notes-card-folder"><Folder size={13} />{note.folder || 'Poziom główny'}</span><span className="all-notes-card-top-actions">{sortMode === 'manual' && !bulkSelectMode && <><GripVertical size={14} className="all-notes-drag-handle" aria-hidden="true" /><button type="button" className="all-notes-move-button" title="Przenieś wyżej" aria-label={`Przenieś notatkę ${note.title} wyżej`} disabled={!noteIndex} onClick={() => onReorder?.(note.id, filteredNotes[noteIndex - 1]!.id)}><ArrowUp size={13} /></button><button type="button" className="all-notes-move-button" title="Przenieś niżej" aria-label={`Przenieś notatkę ${note.title} niżej`} disabled={noteIndex === filteredNotes.length - 1} onClick={() => onReorder?.(note.id, filteredNotes[noteIndex + 1]!.id)}><ArrowDown size={13} /></button></>}{note.favorite && <Star className="all-notes-card-star" size={15} fill="currentColor" aria-label="Ulubiona notatka" />}</span></div>
        <button type="button" className="all-notes-card-open" onClick={() => bulkSelectMode ? toggleSelected(note.id) : onOpen(note.id)}>
        <strong className="all-notes-card-title">{note.title || 'Bez tytułu'}</strong>
        <span className="all-notes-card-preview">{preview || 'Ta notatka nie ma jeszcze treści.'}</span>
        <span className="all-notes-card-tags">{note.tags.length ? <>{note.tags.slice(0, 3).map(value => <span className="all-notes-tag" key={value}>{value}</span>)}{note.tags.length > 3 && <span className="all-notes-tag-more">+{note.tags.length - 3}</span>}</> : <span className="all-notes-no-tags">Bez tagów</span>}</span>
        <span className="all-notes-card-footer"><span><CalendarDays size={12} />Zmieniono {dateLabel.format(note.updatedAt)}</span>{attachmentCount > 0 && <span><Paperclip size={12} />{attachmentCount}</span>}<FileText size={15} className="all-notes-open-mark" /></span>
        </button>
      </article>
    }}
    /> : filteredNotes.length ? <VirtualizedList
      className="all-notes-list"
      items={filteredNotes}
      itemHeight={displayMode === 'full' ? 128 : displayMode === 'names-tags' ? 86 : 50}
      keyOf={note => note.id}
      onItemsRendered={(start, end) => onVisibleNotes?.(filteredNotes.slice(start, end))}
      renderItem={note => {
        const color = getNoteColor(note)
        const content = contentByNote?.get(note.id) ?? note.content
        return <div className="all-notes-row-select">{bulkSelectMode && <input type="checkbox" className="all-notes-row-checkbox" aria-label={`Zaznacz notatkę ${note.title || 'Bez tytułu'}`} checked={selectedIds.has(note.id)} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={event => toggleSelected(note.id, event.target.checked)} />}<button type="button" className={`all-notes-row note-card view-${displayMode} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onClick={() => bulkSelectMode ? toggleSelected(note.id) : onOpen(note.id)}>
          {displayMode === 'full' && <span className="note-card-top"><span className="note-date">{dateLabel.format(note.updatedAt)}</span>{note.favorite && <Star size={14} className="favorite-mini" fill="currentColor" />}</span>}
          <strong>{note.title || 'Bez tytułu'}</strong>
          {displayMode === 'full' && <p>{content || note.contentLoaded !== false ? cachedNotePreview(note, contentByNote) || 'Ta notatka nie ma jeszcze treści.' : 'Wczytuję podgląd…'}</p>}
          {displayMode !== 'names' && <span className="note-card-bottom">{displayMode === 'full' && note.folder && <span className="folder-pill"><Folder size={12} />{note.folder}</span>}{note.tags.map(value => <span className="tag-pill" key={value}>{value}</span>)}</span>}
        </button></div>
      }}
    /> : <div className="all-notes-empty"><span><Search size={20} /></span><strong>{notes.length ? 'Nie znaleziono pasujących notatek' : 'Twoja biblioteka jest pusta'}</strong><p>{notes.length ? 'Zmień hasło lub usuń część filtrów, aby zobaczyć więcej wyników.' : 'Utwórz pierwszą notatkę, a pojawi się tutaj.'}</p>{hasFilters && <button type="button" className="button secondary" onClick={resetFilters}><RotateCcw size={14} />Wyczyść filtry</button>}</div>}
  </section>
}
