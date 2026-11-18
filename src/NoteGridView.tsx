import { lazy, Suspense, useDeferredValue, useMemo, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { Code2, Eye, FileText, Folder, X } from 'lucide-react'
import type { MarkdownNoteAction } from './MarkdownContextMenu'
import type { Note, NoteAsset, NoteAttachment } from './types'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(module => ({ default: module.MarkdownEditor })))
const MarkdownSourceEditor = lazy(() => import('./MarkdownSourceEditor').then(module => ({ default: module.MarkdownSourceEditor })))

export function NoteGridView({
  notes,
  allNotes,
  assets,
  attachments,
  activeNoteId,
  revision,
  getNoteActions,
  onFocus,
  onRemove,
  onAdd,
  onPatch,
  onSelectionChange,
  onNoteAction,
  onOpenNote,
  onOpenAttachment,
}: {
  notes: Note[]
  allNotes: Note[]
  assets: NoteAsset[]
  attachments: NoteAttachment[]
  activeNoteId: string
  revision: number
  getNoteActions: (noteId: string, mode: 'rendered' | 'source') => MarkdownNoteAction[]
  onFocus: (noteId: string) => void
  onRemove: (noteId: string) => void
  onAdd: (noteId: string) => void
  onPatch: (noteId: string, patch: Partial<Note>) => void
  onSelectionChange: (noteId: string, mode: 'rendered' | 'source', text: string) => void
  onNoteAction: (action: string, noteId: string, mode: 'rendered' | 'source') => void
  onOpenNote: (target: string, sourceNoteId: string) => void
  onOpenAttachment: (fileName: string, sourceNoteId: string, page?: number, fragment?: string) => void
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const openNoteIds = useMemo(() => new Set(notes.map(note => note.id)), [notes])
  const availableNotes = useMemo(() => allNotes.filter(note => !openNoteIds.has(note.id)), [allNotes, openNoteIds])
  const assetsByNote = useMemo(() => {
    const grouped = new Map<string, NoteAsset[]>()
    for (const asset of assets) {
      let items = grouped.get(asset.noteId)
      if (!items) grouped.set(asset.noteId, items = [])
      items.push(asset)
    }
    return grouped
  }, [assets])
  const attachmentsByNote = useMemo(() => {
    const grouped = new Map<string, NoteAttachment[]>()
    for (const attachment of attachments) {
      let items = grouped.get(attachment.noteId)
      if (!items) grouped.set(attachment.noteId, items = [])
      items.push(attachment)
    }
    return grouped
  }, [attachments])
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase('pl')
  const filteredNotes = useMemo(() => availableNotes.filter(note => `${note.title} ${note.folder}`.toLocaleLowerCase('pl').includes(normalizedSearch)), [availableNotes, normalizedSearch])

  return <section className="note-grid-view" aria-label="Siatka edycji notatek">
    <div className="note-grid-toolbar">
      <div className="note-grid-description"><strong>Siatka notatek</strong><span>{notes.length} z 4 otwartych · wybierz kartę, aby ustawić fokus · Ctrl + kółko: powiększenie</span></div>
      <details className="note-grid-add-menu">
        <summary className="button secondary"><FileText size={14} />Dodaj notatkę</summary>
        <div className="note-grid-picker" role="group" aria-label="Dodaj notatkę do siatki">
          <label><span>Szukaj notatki</span><input autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tytuł lub folder" /></label>
          <div className="note-grid-picker-list">
            {filteredNotes.slice(0, 100).map(note => <button type="button" key={note.id} onClick={event => { onAdd(note.id); setSearch(''); event.currentTarget.closest('details')?.removeAttribute('open') }}>
              <FileText size={14} /><span><strong>{note.title || 'Bez tytułu'}</strong><small>{note.folder || 'Bez folderu'}</small></span>
            </button>)}
            {!filteredNotes.length && <p>Brak pasujących notatek.</p>}
            {filteredNotes.length > 100 && <p>Wpisz tytuł lub folder, aby zawęzić listę.</p>}
          </div>
        </div>
      </details>
    </div>
    {notes.length > 4 && <p className="note-grid-limit" role="status">W siatce mogą być otwarte najwyżej 4 notatki.</p>}
    <div className={`note-grid-cards note-grid-count-${notes.length}`}>
      {notes.map(note => <NoteGridCard
        key={note.id}
        note={note}
        active={note.id === activeNoteId}
        revision={revision}
        assets={assetsByNote.get(note.id) ?? EMPTY_ASSETS}
        attachments={attachmentsByNote.get(note.id) ?? EMPTY_ATTACHMENTS}
        allAssets={assets}
        allNotes={allNotes}
        onFocus={() => onFocus(note.id)}
        onRemove={() => onRemove(note.id)}
        onPatch={patch => onPatch(note.id, patch)}
        getNoteActions={getNoteActions}
        onSelectionChange={(mode, text) => onSelectionChange(note.id, mode, text)}
        onNoteAction={(action, mode) => onNoteAction(action, note.id, mode)}
        onOpenNote={target => onOpenNote(target, note.id)}
        onOpenAttachment={(fileName, page, fragment) => onOpenAttachment(fileName, note.id, page, fragment)}
      />)}
      {!notes.length && <div className="note-grid-empty"><FileText size={20} /><strong>Dodaj notatki do siatki</strong><span>Otwórz kilka notatek obok siebie i pracuj nad każdą niezależnie.</span></div>}
    </div>
  </section>
}

const EMPTY_ASSETS: NoteAsset[] = []
const EMPTY_ATTACHMENTS: NoteAttachment[] = []

function NoteGridCard({
  note,
  active,
  revision,
  assets,
  attachments,
  allAssets,
  allNotes,
  getNoteActions,
  onFocus,
  onRemove,
  onPatch,
  onSelectionChange,
  onNoteAction,
  onOpenNote,
  onOpenAttachment,
}: {
  note: Note
  active: boolean
  revision: number
  assets: NoteAsset[]
  attachments: NoteAttachment[]
  allAssets: NoteAsset[]
  allNotes: Note[]
  getNoteActions: (noteId: string, mode: 'rendered' | 'source') => MarkdownNoteAction[]
  onFocus: () => void
  onRemove: () => void
  onPatch: (patch: Partial<Note>) => void
  onSelectionChange: (mode: 'rendered' | 'source', text: string) => void
  onNoteAction: (action: string, mode: 'rendered' | 'source') => void
  onOpenNote: (target: string) => void
  onOpenAttachment: (fileName: string, page?: number, fragment?: string) => void
}) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const [zoom, setZoom] = useState(1)
  const noteActions = getNoteActions(note.id, mode)
  function handleEditorWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return
    event.preventDefault()
    onFocus()
    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY
    setZoom(current => Math.max(.6, Math.min(2.25, current * Math.pow(1.1, -deltaY / 120))))
  }
  return <article className={`note-grid-card ${active ? 'is-focused' : ''}`} data-note-grid-slot={note.id} title="Upuść tu notatkę z panelu Foldery i pliki, aby otworzyć ją w tym polu" onPointerDownCapture={onFocus} onFocusCapture={onFocus} aria-label={`Notatka: ${note.title || 'Bez tytułu'}`}>
    <header className="note-grid-card-header">
      <span className="note-grid-card-mark"><FileText size={15} /></span>
      <span className="note-grid-card-heading"><strong>{note.folder || 'Bez folderu'}</strong><small>{active ? 'Ma fokus' : 'Kliknij, aby ustawić fokus'} · {Math.round(zoom * 100)}%</small></span>
      <div className="note-grid-card-actions" role="group" aria-label="Widok notatki">
        <button type="button" className={`view-mode-button ${mode === 'rendered' ? 'active' : ''}`} title="Widok wizualny" aria-label={`Pokaż ${note.title} jako widok wizualny`} aria-pressed={mode === 'rendered'} onClick={() => { onFocus(); setMode('rendered') }}><Eye size={15} /></button>
        <button type="button" className={`view-mode-button ${mode === 'source' ? 'active' : ''}`} title="Surowy Markdown" aria-label={`Pokaż ${note.title} jako Markdown`} aria-pressed={mode === 'source'} onClick={() => { onFocus(); setMode('source') }}><Code2 size={15} /></button>
        <button type="button" className="note-grid-remove" title="Usuń z siatki" aria-label={`Usuń notatkę ${note.title} z siatki`} onClick={event => { event.stopPropagation(); onRemove() }}><X size={15} /></button>
      </div>
    </header>
    <div className="note-grid-card-title"><input value={note.title} onChange={event => onPatch({ title: event.target.value })} onFocus={onFocus} aria-label={`Tytuł notatki ${note.title || 'Bez tytułu'}`} placeholder="Tytuł notatki" /></div>
    <div className="note-grid-card-meta"><Folder size={12} /><span>{note.folder || 'Bez folderu'}</span><span aria-hidden="true">·</span><span>{note.tags.length ? note.tags.join(', ') : 'Bez tagów'}</span></div>
    <div className="note-grid-card-editor" onWheel={handleEditorWheel} title="Ctrl + kółko myszy zmienia powiększenie treści">
      <div className="note-grid-card-zoom" style={{ zoom }}>
        {active ? mode === 'source'
          ? <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownSourceEditor noteId={note.id} markdown={note.content} onChange={markdown => onPatch({ content: markdown })} onSelectionChange={text => onSelectionChange('source', text)} noteActions={noteActions} onNoteAction={action => onNoteAction(action, 'source')} /></Suspense>
          : <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownEditor key={`${note.id}-${revision}`} noteId={note.id} markdown={note.content} assets={assets} attachments={attachments} revision={revision} onChange={markdown => onPatch({ content: markdown })} onSelectionChange={text => onSelectionChange('rendered', text)} onOpenNote={onOpenNote} onOpenAttachment={onOpenAttachment} notes={allNotes} allAssets={allAssets} noteActions={noteActions} onNoteAction={action => onNoteAction(action, 'rendered')} /></Suspense>
          : <button type="button" className="note-grid-inactive-preview" onClick={onFocus} aria-label={`Ustaw fokus i edytuj ${note.title || 'notatkę'}`}><span>Ustaw fokus, aby edytować tę notatkę</span><pre>{note.content.slice(0, 1400) || 'Pusta notatka'}{note.content.length > 1400 ? '…' : ''}</pre></button>}
      </div>
    </div>
  </article>
}
