import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, BookOpen, Check, ChevronDown, Clock3, Code2, Eye, FilePlus2, Folder, Heart, Import, Lightbulb,
  Menu, MoreHorizontal, PanelLeft, Plus, Search, Settings2, Sparkles, Star, Tag, Trash2, X,
} from 'lucide-react'
import { downloadArchive, parseArchive } from './archive'
import { starterAssets, starterNotes } from './content'
import { getAssets, getNotes, hasInitialized, markInitialized, removeAssetsForNote, removeNote, saveAsset, saveNote, storageLocationLabel, usesNativeFiles } from './storage'
import type { Note, NoteAsset } from './types'
import './App.css'

type Filter = 'all' | 'favorites' | string


const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(module => ({ default: module.MarkdownEditor })))
const VectorEditor = lazy(() => import('./VectorEditor').then(module => ({ default: module.VectorEditor })))

type Template = { id: string; title: string; tags: string[]; content: string }
const templates: Template[] = [
  { id: 'meeting', title: 'Nowe spotkanie', tags: ['spotkanie'], content: '# Cel spotkania\n\n## Agenda\n\n- \n\n## Notatki\n\n\n## Ustalenia i zadania\n\n- [ ] ' },
  { id: 'learning', title: 'Nowa notatka z nauki', tags: ['nauka'], content: '# Temat\n\n## Najważniejsze informacje\n\n\n## Pytania\n\n- \n\n## Podsumowanie\n\n' },
  { id: 'project', title: 'Nowy projekt', tags: ['projekt'], content: '# Projekt\n\n## Cel\n\n\n## Etapy\n\n- [ ] \n\n## Pomysły\n\n' },
]

const dateLabel = (value: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(value)
const excerpt = (content: string) => content.replace(/^#+\s*/gm, '').replace(/[>*_`!-]/g, '').replace(/\(\.\/assets\/[^)]+\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 110)
const makeNote = (folder: string, template?: Template): Note => {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: template?.title ?? 'Nowa notatka',
    folder,
    tags: template?.tags ?? [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    content: template?.content ?? '# Nowa notatka\n\nZacznij pisać…\n',
  }
}

function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [assets, setAssets] = useState<NoteAsset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(true)
  const [editorRevision, setEditorRevision] = useState(0)
  const [editorMode, setEditorMode] = useState<'rendered' | 'source'>('rendered')
  const [showDrawing, setShowDrawing] = useState(false)
  const [editingAsset, setEditingAsset] = useState<NoteAsset | undefined>()
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'notes' | 'sidebar'>('none')
  const [tagInput, setTagInput] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let storedNotes = await getNotes()
        let storedAssets = await getAssets()
        if (!await hasInitialized()) {
          if (!storedNotes.length) {
            await Promise.all(starterNotes.map(saveNote))
            await Promise.all(starterAssets.map(saveAsset))
            storedNotes = starterNotes
            storedAssets = starterAssets
          }
          await markInitialized()
        }
        if (!cancelled) {
          setNotes(storedNotes.sort((a, b) => b.updatedAt - a.updatedAt))
          setAssets(storedAssets)
          setSelectedId(storedNotes[0]?.id ?? '')
          setReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Nie udało się otworzyć plików notatek.')
          setReady(true)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || !notes.length) return
    const timeout = window.setTimeout(() => {
      void Promise.all(notes.map(saveNote)).then(() => setSaved(true), () => setSaved(false))
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [notes, ready])

  const folders = useMemo(() => [...new Set(notes.map(note => note.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')), [notes])
  const selectedNote = notes.find(note => note.id === selectedId)
  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl')
    return notes.filter(note => {
      if (activeFilter === 'favorites' && !note.favorite) return false
      if (activeFilter !== 'all' && activeFilter !== 'favorites' && note.folder !== activeFilter) return false
      return !needle || `${note.title} ${note.content} ${note.tags.join(' ')}`.toLocaleLowerCase('pl').includes(needle)
    }).sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, activeFilter, query])
  const currentAssets = assets.filter(asset => asset.noteId === selectedId)

  function patchNote(id: string, patch: Partial<Note>) {
    setSaved(false)
    setNotes(current => current.map(note => note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note))
  }

  const createNote = useCallback((template?: Template, folderOverride?: string) => {
    const folder = folderOverride ?? (activeFilter !== 'all' && activeFilter !== 'favorites' ? activeFilter : 'Osobiste')
    const note = makeNote(folder, template)
    setSaved(false)
    void saveNote(note).then(() => setSaved(true), () => setSaved(false))
    setNotes(current => [note, ...current])
    setSelectedId(note.id)
    setEditorRevision(value => value + 1)
    setMobileDrawer('none')
  }, [activeFilter])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      } else if (event.key.toLowerCase() === 'n' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        createNote()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote])

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = parseArchive(new Uint8Array(await file.arrayBuffer()))
      setSaved(false)
      await Promise.all(imported.notes.map(saveNote))
      await Promise.all(imported.assets.map(saveAsset))
      setNotes(current => {
        const byId = new Map(current.map(note => [note.id, note]))
        imported.notes.forEach(note => byId.set(note.id, note))
        return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
      })
      setAssets(current => {
        const byId = new Map(current.map(asset => [asset.id, asset]))
        imported.assets.forEach(asset => byId.set(asset.id, asset))
        return [...byId.values()]
      })
      setSelectedId(imported.notes[0].id)
      setActiveFilter('all')
      setEditorRevision(value => value + 1)
      window.alert(`Zaimportowano ${imported.notes.length} notatek.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Nie udało się zaimportować paczki.')
    }
    event.target.value = ''
  }

  async function deleteSelected() {
    if (!selectedNote || !window.confirm(`Usunąć notatkę „${selectedNote.title}” z tego urządzenia?`)) return
    await removeNote(selectedNote.id)
    await removeAssetsForNote(selectedNote.id)
    setSaved(true)
    setAssets(current => current.filter(asset => asset.noteId !== selectedNote.id))
    setNotes(current => current.filter(note => note.id !== selectedNote.id))
    const next = notes.find(note => note.id !== selectedNote.id)
    setSelectedId(next?.id ?? '')
  }

  async function saveDrawing(svg: string) {
    if (!selectedNote) return
    const asset: NoteAsset = editingAsset
      ? { ...editingAsset, svg }
      : { id: crypto.randomUUID(), noteId: selectedNote.id, fileName: `schemat-${assets.filter(item => item.noteId === selectedNote.id).length + 1}.svg`, svg }
    setSaved(false)
    await saveAsset(asset)
    setSaved(true)
    setAssets(current => editingAsset ? current.map(item => item.id === asset.id ? asset : item) : [...current, asset])
    if (!editingAsset) {
      const image = `\n\n![Schemat](./assets/${asset.fileName})\n`
      patchNote(selectedNote.id, { content: `${selectedNote.content.trimEnd()}${image}` })
    }
    setEditorRevision(value => value + 1)
    setShowDrawing(false)
    setEditingAsset(undefined)
  }

  function addTag() {
    const value = tagInput.trim().replace(/^#/, '')
    if (!selectedNote || !value || selectedNote.tags.includes(value)) return setTagInput('')
    patchNote(selectedNote.id, { tags: [...selectedNote.tags, value] })
    setTagInput('')
  }

  if (!ready) {
    return <div className="loading-screen"><div className="brand-mark">N</div><p>Otwieram Twoje notatki…</p></div>
  }
  if (loadError) {
    return <div className="loading-screen"><div className="brand-mark">N</div><p>Nie udało się otworzyć notatek.</p><small className="storage-error">{loadError}</small></div>
  }

  return (
    <main className={`app-shell ${mobileDrawer !== 'none' ? 'drawer-open' : ''}`}>
      <aside className={`sidebar ${mobileDrawer === 'sidebar' ? 'mobile-visible' : ''}`}>
        <div className="brand-row"><div className="brand-mark">N</div><span>No-Tie</span><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij menu"><X size={18} /></button></div>
        <button className="new-note-button" onClick={() => createNote()}><Plus size={17} /><span>Nowa notatka</span><kbd>N</kbd></button>
        <div className="sidebar-section">
          <span className="section-label">BIBLIOTEKA</span>
          <button className={`nav-item ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => { setActiveFilter('all'); setMobileDrawer('none') }}><BookOpen size={17} /><span>Wszystkie notatki</span><span className="nav-count">{notes.length}</span></button>
          <button className={`nav-item ${activeFilter === 'favorites' ? 'active' : ''}`} onClick={() => { setActiveFilter('favorites'); setMobileDrawer('none') }}><Heart size={17} /><span>Ulubione</span></button>
          <button className="nav-item" onClick={() => { setActiveFilter('all'); setQuery(''); setMobileDrawer('notes') }}><Clock3 size={17} /><span>Ostatnie</span></button>
        </div>
        <div className="sidebar-section folders-section">
          <div className="section-heading"><span className="section-label">FOLDERY</span><button className="tiny-icon" title="Dodaj folder" onClick={() => { const name = window.prompt('Nazwa nowego folderu'); if (name?.trim()) { setActiveFilter(name.trim()); createNote(undefined, name.trim()) } }}><Plus size={15} /></button></div>
          {folders.map(folder => <button key={folder} className={`nav-item folder-item ${activeFilter === folder ? 'active' : ''}`} onClick={() => { setActiveFilter(folder); setMobileDrawer('none') }}><Folder size={16} /><span>{folder}</span><span className="nav-count">{notes.filter(note => note.folder === folder).length}</span></button>)}
          {!folders.length && <p className="empty-hint">Foldery pojawią się przy notatkach.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="offline-card"><span className="online-dot" /><div><strong>Dane lokalne</strong><span>{storageLocationLabel} · offline</span></div><Check size={15} /></div>
          <div className="user-row"><div className="avatar">N</div><div><strong>Moje notatki</strong><span>Przestrzeń prywatna</span></div><MoreHorizontal size={19} /></div>
        </div>
      </aside>

      <section className={`notes-panel ${mobileDrawer === 'notes' ? 'mobile-visible' : ''}`}>
        <div className="notes-panel-heading"><div><p className="eyebrow">TWOJA BIBLIOTEKA</p><h1>{activeFilter === 'all' ? 'Notatki' : activeFilter === 'favorites' ? 'Ulubione' : activeFilter}</h1></div><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij listę"><X size={18} /></button></div>
        <label className="search-box"><Search size={16} /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj notatek…" /><kbd>⌘/Ctrl K</kbd></label>
        <div className="list-toolbar"><span>{visibleNotes.length} NOTATKI</span><button className="sort-button" title="Sortowane od najnowszych"><Clock3 size={14} /><ChevronDown size={13} /></button></div>
        <div className="note-list">
          {visibleNotes.map(note => (
            <button key={note.id} className={`note-card ${selectedId === note.id ? 'selected' : ''}`} onClick={() => { setSelectedId(note.id); setMobileDrawer('none') }}>
              <div className="note-card-top"><span className="note-date">{dateLabel(note.updatedAt)}</span>{note.favorite && <Star size={14} className="favorite-mini" fill="currentColor" />}</div>
              <strong>{note.title || 'Bez tytułu'}</strong>
              <p>{excerpt(note.content) || 'Pusta notatka'}</p>
              <div className="note-card-bottom"><span className="folder-pill"><Folder size={12} />{note.folder}</span>{note.tags.slice(0, 2).map(tag => <span key={tag} className="tag-pill">{tag}</span>)}</div>
            </button>
          ))}
          {!visibleNotes.length && <div className="empty-state compact"><div className="empty-illustration"><Search size={22} /></div><strong>Brak pasujących notatek</strong><span>Spróbuj zmienić wyszukiwanie albo utwórz nową notatkę.</span><button className="button secondary" onClick={() => createNote()}><Plus size={15} />Nowa notatka</button></div>}
        </div>
        <div className="notes-list-footer"><span><span className="online-dot" />{usesNativeFiles ? ' Pliki na tym urządzeniu' : ' Zapis na tym urządzeniu'}</span><button title="Ustawienia" aria-label="Ustawienia"><Settings2 size={16} /></button></div>
      </section>

      <section className="editor-panel">
        <header className="topbar">
          <div className="mobile-actions"><button className="icon-button" onClick={() => setMobileDrawer('sidebar')} aria-label="Otwórz menu"><Menu size={19} /></button><button className="icon-button" onClick={() => setMobileDrawer('notes')} aria-label="Pokaż notatki"><PanelLeft size={18} /></button></div>
          <div className="breadcrumb"><span>Notatki</span><span className="crumb-slash">/</span><span>{selectedNote?.folder ?? 'Osobiste'}</span></div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saved ? 'is-saved' : ''}`}><span className="save-dot" />{saved ? 'Zapisano' : 'Zapisywanie…'}</span>
            <button className="button secondary export-button" onClick={() => downloadArchive(notes, assets)}><Archive size={15} /><span>Eksportuj</span></button>
            <button className="icon-button import-icon" onClick={() => importInput.current?.click()} title="Importuj paczkę" aria-label="Importuj paczkę"><Import size={17} /></button>
            <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={handleImport} />
          </div>
        </header>

        {selectedNote ? (
          <article className="note-editor" key={selectedNote.id}>
            <div className="editor-scroll">
              <div className="note-meta-line"><span className="meta-dot" /><select className="folder-select" value={selectedNote.folder} onChange={event => patchNote(selectedNote.id, { folder: event.target.value })} aria-label="Folder notatki">{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><span className="meta-divider">·</span>Utworzono {dateLabel(selectedNote.createdAt)}</div>
              <input className="note-title-input" value={selectedNote.title} onChange={event => patchNote(selectedNote.id, { title: event.target.value })} placeholder="Tytuł notatki" aria-label="Tytuł notatki" />
              <div className="tags-row"><Tag size={15} /><div className="tag-list">{selectedNote.tags.map(tag => <button className="editable-tag" key={tag} onClick={() => patchNote(selectedNote.id, { tags: selectedNote.tags.filter(item => item !== tag) })} title="Usuń tag">{tag}<X size={11} /></button>)}<input className="tag-input" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} placeholder={selectedNote.tags.length ? 'Dodaj tag…' : 'Dodaj tag'} aria-label="Dodaj tag" />{tagInput && <button className="tag-add-button" onClick={addTag}>Dodaj</button>}</div></div>
              <div className="editor-tools-row">
                <div className="editor-tools-left"><div className="view-mode-toggle" role="group" aria-label="Widok notatki"><button className={`view-mode-button ${editorMode === 'rendered' ? 'active' : ''}`} aria-pressed={editorMode === 'rendered'} onClick={() => setEditorMode('rendered')}><Eye size={14} />Wizualny</button><button className={`view-mode-button ${editorMode === 'source' ? 'active' : ''}`} aria-pressed={editorMode === 'source'} onClick={() => setEditorMode('source')}><Code2 size={14} />Surowy Markdown</button></div><span className="toolbar-separator" /><button className="inline-tool" onClick={() => { setEditingAsset(undefined); setShowDrawing(true) }}><Sparkles size={15} />Dodaj schemat</button>{currentAssets.map(asset => <button className="inline-tool asset-tool" key={asset.id} onClick={() => { setEditingAsset(asset); setShowDrawing(true) }}><Lightbulb size={14} />{asset.fileName}</button>)}</div>
                <select className="template-select" defaultValue="" aria-label="Wstaw szablon" onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) { patchNote(selectedNote.id, { title: template.title, content: template.content, tags: [...new Set([...selectedNote.tags, ...template.tags])] }); setEditorRevision(value => value + 1) } event.target.value = '' }}><option value="" disabled>Szablon</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select>
              </div>
              {editorMode === 'source' ? <textarea className="markdown-source-editor" aria-label="Surowy tekst Markdown" spellCheck={false} value={selectedNote.content} onChange={event => patchNote(selectedNote.id, { content: event.target.value })} /> : <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownEditor key={`${selectedNote.id}-${editorRevision}`} noteId={selectedNote.id} markdown={selectedNote.content} assets={currentAssets} revision={editorRevision} onChange={content => patchNote(selectedNote.id, { content })} /></Suspense>}
              <div className="editor-end-note"><span className="end-line" /><span>Koniec notatki</span><span className="end-line" /></div>
            </div>
            <footer className="editor-footer"><span><Sparkles size={14} />Zapis automatyczny</span><div><button className={`footer-icon ${selectedNote.favorite ? 'favorited' : ''}`} onClick={() => patchNote(selectedNote.id, { favorite: !selectedNote.favorite })} title={selectedNote.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}><Star size={17} fill={selectedNote.favorite ? 'currentColor' : 'none'} /></button><button className="footer-icon delete-note" onClick={() => void deleteSelected()} title="Usuń notatkę"><Trash2 size={17} /></button></div></footer>
          </article>
        ) : (
          <div className="empty-state editor-empty"><div className="empty-illustration"><FilePlus2 size={25} /></div><p className="eyebrow">TWOJA PRZESTRZEŃ</p><h2>Zapisz pierwszą myśl</h2><span>Twoje notatki będą dostępne lokalnie i offline.</span><button className="button primary" onClick={() => createNote()}><Plus size={16} />Nowa notatka</button></div>
        )}
      </section>
      {showDrawing && selectedNote && <Suspense fallback={<div className="modal-backdrop"><div className="loading-screen">Otwieram edytor SVG…</div></div>}><VectorEditor asset={editingAsset} onClose={() => { setShowDrawing(false); setEditingAsset(undefined) }} onSave={svg => void saveDrawing(svg)} /></Suspense>}
      {mobileDrawer !== 'none' && <button className="drawer-scrim" aria-label="Zamknij menu" onClick={() => setMobileDrawer('none')} />}
    </main>
  )
}

export default App
