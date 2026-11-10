import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Archive, BookOpen, BookmarkPlus, CalendarDays, Check, CheckSquare2, Clock3, Eye, FilePlus2, FileText, Folder, Heart, History, Import, Lightbulb,
  CircleHelp, Link2, Menu, MessageCircle, MoreVertical, Network, Palette, PanelLeft, Pencil, Plus, Repeat2, Search, Settings2, SlidersHorizontal, Sparkles, Star, Tag, Trash2, X,
} from 'lucide-react'
import { exportArchiveToFolder, parseArchive } from './archive'
import { ChatPanel } from './ChatPanel'
import { starterAssets, starterNotes } from './content'
import { NoteHistoryDialog } from './NoteHistoryDialog'
import { NoteLinkDialog } from './NoteLinkDialog'
import { NoteSearchDialog } from './NoteSearchDialog'
import { NoteConnections } from './NoteConnections'
import { KnowledgeGraphDialog } from './KnowledgeGraphDialog'
import { DailyNotesDialog } from './DailyNotesDialog'
import { TaskManagerDialog } from './TaskManagerDialog'
import { SavedSearchDialog } from './SavedSearchDialog'
import { TemplateManagerDialog } from './TemplateManagerDialog'
import { NoteAttachmentsPanel } from './NoteAttachmentsPanel'
import { HelpDialog } from './HelpDialog'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { searchNotes } from './noteSearch'
import { parseTasks, updateTaskLine, type ParsedTask } from './knowledge'
import { listOllamaModels, type OllamaModel } from './ollama'
import { ReviewSessionDialog } from './ReviewSessionDialog'
import { ReviewSessionView } from './ReviewSessionView'
import { checkpointReviewSession } from './reviews'
import { getAssets, getAttachments, getFolderColors, getFolders, getNoteTemplates, getNoteVersions, getNotes, getReviewSessions, getSavedSearches, hasInitialized, markInitialized, removeAssetsForNote, removeAttachmentsForNote, removeAttachment, removeFolderFromDisk, removeNote, saveAsset, saveAttachment, saveFolderColors, saveFolders, saveNote, saveNoteTemplates, saveNoteVersion, saveNoteVersions, saveReviewSessions, saveSavedSearches, storageLocationLabel, usesNativeFiles } from './storage'
import type { Note, NoteAsset, NoteAttachment, NoteTemplate, NoteVersion, ReviewSession, SavedSearch } from './types'
import { dispatchWikiLinkInsert, replaceWikiLinkTarget } from './wikiLinks'
import './App.css'

type Filter = 'all' | 'favorites' | string
type NoteDisplayMode = 'full' | 'names-tags' | 'names'
type EntryTarget = { kind: 'folder'; path: string } | { kind: 'note'; id: string }
type DeleteTarget = EntryTarget & { label: string; noteCount: number }
type EntryColor = { value: string; label: string }
type EntryPointerDrag = { target: EntryTarget; label: string; pointerId: number; startX: number; startY: number; started: boolean }
type EntryDragVisual = { target: EntryTarget; label: string; x: number; y: number; dropFolder: string | null }

function folderParents(path: string): string[] {
  const parts = path.split('/').map(part => part.trim()).filter(Boolean)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

function relocateFolderColors(colors: Record<string, string>, source: string, destination: string): Record<string, string> {
  const relocate = (folder: string) => folder === source ? destination : folder.startsWith(`${source}/`) ? `${destination}${folder.slice(source.length)}` : folder
  return Object.fromEntries(Object.entries(colors).map(([folder, color]) => [relocate(folder), color]))
}

function copyNote(note: Note): Note {
  return { ...note, tags: [...note.tags] }
}


const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(module => ({ default: module.MarkdownEditor })))
const VectorEditor = lazy(() => import('./VectorEditor').then(module => ({ default: module.VectorEditor })))

const defaultTemplates: NoteTemplate[] = [
  { id: 'meeting', title: 'Nowe spotkanie', tags: ['spotkanie'], content: '# Cel spotkania\n\n## Agenda\n\n- \n\n## Notatki\n\n\n## Ustalenia i zadania\n\n- [ ] ' },
  { id: 'learning', title: 'Nowa notatka z nauki', tags: ['nauka'], content: '# Temat\n\n## Najważniejsze informacje\n\n\n## Pytania\n\n- \n\n## Podsumowanie\n\n' },
  { id: 'project', title: 'Nowy projekt', tags: ['projekt'], content: '# Projekt\n\n## Cel\n\n\n## Etapy\n\n- [ ] \n\n## Pomysły\n\n' },
]

const dateLabel = (value: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(value)
const currentTimestamp = () => Date.now()
const safeAttachmentName = (value: string) => value.split(/[\\/]/).at(-1)?.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^\.+|\.+$/g, '').slice(0, 100) || 'zalacznik'
const uniqueAttachmentName = (name: string, used: Set<string>) => {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let candidate = name
  let number = 2
  while (used.has(candidate.toLocaleLowerCase('pl'))) candidate = `${base}-${number++}${extension}`
  used.add(candidate.toLocaleLowerCase('pl'))
  return candidate
}
const dataUrlFromFile = async (file: File, mimeType: string) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const excerpt = (content: string) => content.replace(/^#+\s*/gm, '').replace(/[>*_`!-]/g, '').replace(/\(\.\/assets\/[^)]+\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 110)
const countEditorText = (text: string) => ({
  words: text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
  characters: Array.from(text).length,
})
const markdownTextForCounts = (markdown: string) => markdown
  .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
  .replace(/[*_~]/g, '')
  .replace(/\\([*_`])/g, '$1')
function polishCount(value: number, forms: [string, string, string]) {
  const mod100 = value % 100
  const mod10 = value % 10
  const form = value === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? forms[1] : forms[2]
  return `${value.toLocaleString('pl-PL')} ${form}`
}
const entryColors: EntryColor[] = [
  { value: '#ef7777', label: 'Koral' },
  { value: '#e99a4a', label: 'Mandarynka' },
  { value: '#c5a33f', label: 'Miód' },
  { value: '#60a777', label: 'Szałwia' },
  { value: '#5889d0', label: 'Błękit' },
  { value: '#9270c5', label: 'Fiolet' },
  { value: '#cf709b', label: 'Róż' },
  { value: '#459d9d', label: 'Morski' },
]
const entryColorStyle = (color?: string): CSSProperties | undefined => color ? { '--entry-color': color } as CSSProperties : undefined
const makeNote = (folder: string, template?: NoteTemplate): Note => {
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
  const noteHistory = useRef<Note[]>([])
  const noteRedoHistory = useRef<Note[]>([])
  const historyNoteId = useRef('')
  const undoNoteAction = useRef<() => void>(() => {})
  const redoNoteAction = useRef<() => void>(() => {})
  const [assets, setAssets] = useState<NoteAsset[]>([])
  const [attachments, setAttachments] = useState<NoteAttachment[]>([])
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [templates, setTemplates] = useState<NoteTemplate[]>(defaultTemplates)
  const [showDailyNotes, setShowDailyNotes] = useState(false)
  const [showTaskManager, setShowTaskManager] = useState(false)
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false)
  const [showSavedSearches, setShowSavedSearches] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [searchTag, setSearchTag] = useState('')
  const [searchFolder, setSearchFolder] = useState('')
  const [showSearchFilters, setShowSearchFilters] = useState(false)
  const [showQuickSearch, setShowQuickSearch] = useState(false)
  const [quickSearchActiveIndex, setQuickSearchActiveIndex] = useState(0)
  const [showNoteLinkDialog, setShowNoteLinkDialog] = useState(false)
  const [showNoteHistory, setShowNoteHistory] = useState(false)
  const [noteVersions, setNoteVersions] = useState<NoteVersion[]>([])
  const [noteVersionsLoading, setNoteVersionsLoading] = useState(false)
  const [historyDialogNoteId, setHistoryDialogNoteId] = useState('')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(true)
  const [editorRevision, setEditorRevision] = useState(0)
  const [editorMode, setEditorModeState] = useState<'rendered' | 'source'>('rendered')
  const [showDrawing, setShowDrawing] = useState(false)
  const [editingAsset, setEditingAsset] = useState<NoteAsset | undefined>()
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'notes' | 'sidebar'>('none')
  const [tagInput, setTagInput] = useState('')
  const [folderRegistry, setFolderRegistry] = useState<string[]>([])
  const [folderColors, setFolderColors] = useState<Record<string, string>>({})
  const [reviewSessions, setReviewSessions] = useState<ReviewSession[]>([])
  const [activeReviewSessionId, setActiveReviewSessionId] = useState('')
  const [showReviewSessionDialog, setShowReviewSessionDialog] = useState(false)
  const [editingReviewSessionId, setEditingReviewSessionId] = useState('')
  const [reviewClockNow, setReviewClockNow] = useState(() => Date.now())
  const [editorSelection, setEditorSelection] = useState({ noteId: '', mode: 'rendered' as 'rendered' | 'source', text: '' })
  const [entryDragVisual, setEntryDragVisual] = useState<EntryDragVisual | null>(null)
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const [toast, setToast] = useState('')
  const [showLibrary, setShowLibrary] = useState(() => localStorage.getItem('no-tie-library-visible') !== 'false')
  const [showChat, setShowChat] = useState(() => localStorage.getItem('no-tie-ollama-chat-open') === 'true')
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => localStorage.getItem('no-tie-ollama-url') || 'http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem('no-tie-ollama-model') || '')
  const [showOllamaSettings, setShowOllamaSettings] = useState(false)
  const [ollamaDraftUrl, setOllamaDraftUrl] = useState('http://localhost:11434')
  const [ollamaDraftModel, setOllamaDraftModel] = useState('')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [ollamaSettingsMessage, setOllamaSettingsMessage] = useState('')
  const [ollamaSettingsError, setOllamaSettingsError] = useState('')
  const [openActionMenu, setOpenActionMenu] = useState('')
  const [renameTarget, setRenameTarget] = useState<EntryTarget | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [colorTarget, setColorTarget] = useState<EntryTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [noteDisplayMode, setNoteDisplayMode] = useState<NoteDisplayMode>(() => {
    const stored = localStorage.getItem('no-tie-note-display-mode')
    return stored === 'names' || stored === 'names-tags' ? stored : 'full'
  })
  const importInput = useRef<HTMLInputElement>(null)
  const persistentVersionTimers = useRef(new Map<string, number>())
  const historyDialogNoteIdRef = useRef('')
  const entryPointerDrag = useRef<EntryPointerDrag | null>(null)
  const entryDropTarget = useRef<HTMLElement | null>(null)
  const suppressEntryClick = useRef(false)
  const entryDropAction = useRef<(target: EntryTarget, folder: string) => void>(() => {})
  const entryDragRenderFrame = useRef<number | null>(null)
  const nextEntryDragVisual = useRef<EntryDragVisual | null>(null)

  function reportDiskSaveError(error: unknown) {
    setSaved(false)
    const detail = error instanceof Error ? error.message : 'Spróbuj ponownie.'
    setToast(`Nie udało się zapisać zmian: ${detail}`)
    window.setTimeout(() => setToast(''), 5000)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let storedNotes = await getNotes()
        let storedAssets = await getAssets()
        const storedAttachments = await getAttachments()
        const storedSearches = await getSavedSearches()
        const storedTemplates = await getNoteTemplates()
        let storedFolders = await getFolders()
        const storedFolderColors = await getFolderColors()
        const storedReviewSessions = await getReviewSessions()
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
          storedFolders = [...new Set([...storedFolders, ...storedNotes.flatMap(note => folderParents(note.folder))])]
          setFolderRegistry(storedFolders)
          setFolderColors(storedFolderColors)
          setReviewSessions(storedReviewSessions)
          setAttachments(storedAttachments)
          setSavedSearches(storedSearches)
          setTemplates(storedTemplates.length ? storedTemplates : defaultTemplates)
          storedNotes.sort((a, b) => b.updatedAt - a.updatedAt)
          historyNoteId.current = storedNotes[0]?.id ?? ''
          noteHistory.current = storedNotes[0] ? [copyNote(storedNotes[0])] : []
          setNotes(storedNotes)
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
      void Promise.all(notes.map(saveNote)).then(() => setSaved(true), reportDiskSaveError)
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [notes, ready])

  const folders = useMemo(() => [...new Set([...folderRegistry, ...notes.flatMap(note => folderParents(note.folder))])].sort((a, b) => a.localeCompare(b, 'pl')), [folderRegistry, notes])
  const folderKey = folders.join('\u0000')
  useEffect(() => {
    if (ready) void saveFolders(folderKey ? folderKey.split('\u0000') : []).catch(reportDiskSaveError)
  }, [folderKey, ready])
  useEffect(() => {
    if (ready) void saveFolderColors(folderColors).catch(reportDiskSaveError)
  }, [folderColors, ready])
  useEffect(() => {
    if (ready) void saveReviewSessions(reviewSessions).catch(reportDiskSaveError)
  }, [ready, reviewSessions])
  useEffect(() => { if (ready) void saveSavedSearches(savedSearches).catch(reportDiskSaveError) }, [ready, savedSearches])
  useEffect(() => { if (ready) void saveNoteTemplates(templates).catch(reportDiskSaveError) }, [ready, templates])
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now()
      setReviewClockNow(now)
      setReviewSessions(current => {
        let changed = false
        const next = current.map(session => {
          if (session.status !== 'running' || !session.runningSince || now - session.runningSince < 10_000) return session
          changed = true
          return checkpointReviewSession(session, now)
        })
        return changed ? next : current
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    function clearPointerDrag() {
      entryPointerDrag.current = null
      entryDropTarget.current?.classList.remove('drop-target-active')
      entryDropTarget.current = null
      document.querySelectorAll('.drop-target-active').forEach(element => element.classList.remove('drop-target-active'))
      if (entryDragRenderFrame.current !== null) window.cancelAnimationFrame(entryDragRenderFrame.current)
      entryDragRenderFrame.current = null
      nextEntryDragVisual.current = null
      setEntryDragVisual(null)
    }

    function findDropTarget(x: number, y: number): HTMLElement | null {
      return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-folder]') ?? null
    }

    function onPointerMove(event: PointerEvent) {
      const drag = entryPointerDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      if (event.cancelable) event.preventDefault()
      drag.started = true
      const targetElement = findDropTarget(event.clientX, event.clientY)
      if (entryDropTarget.current !== targetElement) {
        entryDropTarget.current?.classList.remove('drop-target-active')
        targetElement?.classList.add('drop-target-active')
        entryDropTarget.current = targetElement
      }
      nextEntryDragVisual.current = {
        target: drag.target,
        label: drag.label,
        x: event.clientX,
        y: event.clientY,
        dropFolder: targetElement ? targetElement.dataset.dropFolder ?? '' : null,
      }
      if (entryDragRenderFrame.current === null) {
        entryDragRenderFrame.current = window.requestAnimationFrame(() => {
          entryDragRenderFrame.current = null
          if (nextEntryDragVisual.current) setEntryDragVisual(nextEntryDragVisual.current)
        })
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = entryPointerDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.started) {
        if (event.cancelable) event.preventDefault()
        const targetElement = findDropTarget(event.clientX, event.clientY)
        if (targetElement) entryDropAction.current(drag.target, targetElement.dataset.dropFolder ?? '')
        suppressEntryClick.current = true
        window.setTimeout(() => { suppressEntryClick.current = false }, 0)
      }
      clearPointerDrag()
    }

    function onPointerCancel(event: PointerEvent) {
      if (entryPointerDrag.current?.pointerId === event.pointerId) clearPointerDrag()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])
  const selectedNote = notes.find(note => note.id === selectedId)
  const activeReviewSession = reviewSessions.find(session => session.id === activeReviewSessionId)
  const notesRef = useRef<Note[]>([])
  useLayoutEffect(() => { notesRef.current = notes }, [notes])
  useLayoutEffect(() => {
    const note = notesRef.current.find(item => item.id === selectedId)
    if (!note) return
    historyNoteId.current = note.id
    noteHistory.current = [copyNote(note)]
    noteRedoHistory.current = []
  }, [selectedId])
  const tagOptions = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort((a, b) => a.localeCompare(b, 'pl')), [notes])
  const searchResults = useMemo(() => searchNotes(notes, { query, tag: searchTag, folder: searchFolder }), [notes, query, searchTag, searchFolder])
  const visibleNotes = useMemo(() => {
    return searchResults.filter(note => {
      if (activeFilter === 'favorites' && !note.favorite) return false
      if (activeFilter === 'root' && note.folder) return false
      if (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' && note.folder !== activeFilter && !note.folder.startsWith(`${activeFilter}/`)) return false
      return true
    })
  }, [searchResults, activeFilter])
  const currentAssets = assets.filter(asset => asset.noteId === selectedId)
  const currentAttachments = attachments.filter(attachment => attachment.noteId === selectedId)
  const parsedTasks = useMemo(() => parseTasks(notes), [notes])
  const documentCounts = selectedNote ? countEditorText(markdownTextForCounts(selectedNote.content)) : { words: 0, characters: 0 }
  const selectionText = selectedNote && editorSelection.noteId === selectedNote.id && editorSelection.mode === editorMode ? editorSelection.text : ''
  const selectionCounts = countEditorText(selectionText)

  function scheduleNoteVersion(note: Note, previous: Note) {
    if (!persistentVersionTimers.current.has(note.id)) {
      void saveNoteVersion(previous).catch(reportDiskSaveError)
    }
    const existingTimer = persistentVersionTimers.current.get(note.id)
    if (existingTimer !== undefined) window.clearTimeout(existingTimer)
    const timer = window.setTimeout(() => {
      persistentVersionTimers.current.delete(note.id)
      const latest = notesRef.current.find(item => item.id === note.id)
      if (!latest) return
      void saveNoteVersion(latest).then(async () => {
        if (historyDialogNoteIdRef.current === note.id) setNoteVersions(await getNoteVersions(note.id))
      }).catch(reportDiskSaveError)
    }, 1600)
    persistentVersionTimers.current.set(note.id, timer)
  }

  async function flushNoteVersion(noteId: string, fallback?: Note) {
    const timer = persistentVersionTimers.current.get(noteId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      persistentVersionTimers.current.delete(noteId)
    }
    const latest = notesRef.current.find(item => item.id === noteId) ?? fallback
    if (latest) await saveNoteVersion(latest)
  }

  function patchNote(id: string, patch: Partial<Note>) {
    const existing = notes.find(note => note.id === id)
    if (existing && Object.entries(patch).every(([key, value]) => JSON.stringify(existing[key as keyof Note]) === JSON.stringify(value))) return
    setSaved(false)
    const updatedAt = currentTimestamp()
    const updated = existing ? { ...existing, ...patch, updatedAt } : undefined
    if (existing && updated) scheduleNoteVersion(updated, existing)
    setNotes(current => current.map(note => {
      if (note.id !== id) return note
      const next = { ...note, ...patch, updatedAt }
      if (id === selectedId) recordNoteHistory(next)
      return next
    }))
  }

  function selectNote(id: string) {
    setEditorSelection({ noteId: id, mode: editorMode, text: '' })
    setSelectedId(id)
  }

  function setEditorMode(mode: 'rendered' | 'source') {
    setEditorSelection({ noteId: selectedId, mode, text: '' })
    setEditorModeState(mode)
  }

  function openLinkedNote(target: string) {
    const needle = target.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl')
    const note = notes.find(item => item.id === target || item.title.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl') === needle)
    if (!note) {
      setToast(`Nie znaleziono notatki „${target}”.`)
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    setActiveReviewSessionId('')
    setActiveFilter(note.folder || 'root')
    setQuery('')
    setSearchTag('')
    setSearchFolder('')
    selectNote(note.id)
    setMobileDrawer('none')
  }

  function openSearchResult(note: Note) {
    setShowQuickSearch(false)
    setActiveReviewSessionId('')
    setActiveFilter(note.folder || 'root')
    setQuery('')
    setSearchTag('')
    setSearchFolder('')
    selectNote(note.id)
    setMobileDrawer('none')
  }

  function openDailyNote(date: string) {
    let note = notes.find(item => item.dailyDate === date)
    if (!note) {
      const readableDate = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      note = { id: `daily-${date}`, title: `Dziennik · ${date}`, dailyDate: date, folder: 'Dziennik', tags: ['dziennik'], favorite: false, createdAt: Date.now(), updatedAt: Date.now(), content: `# ${readableDate}\n\n## Najważniejsze\n\n\n## Notatki\n\n\n## Zadania\n\n- [ ] ` }
      setNotes(current => [note!, ...current])
      setFolderRegistry(current => [...new Set([...current, 'Dziennik'])])
      setSaved(false)
      void saveNote(note).then(() => saveNoteVersion(note!)).catch(reportDiskSaveError)
    }
    setActiveReviewSessionId('')
    setActiveFilter(note.folder || 'root')
    setQuery('')
    setSearchTag('')
    setSearchFolder('')
    selectNote(note.id)
    setShowDailyNotes(false)
    setMobileDrawer('none')
  }

  function applySavedSearch(search: SavedSearch) {
    setQuery(search.query)
    setSearchTag(search.tag)
    setSearchFolder(search.folder)
    setActiveFilter('all')
    setActiveReviewSessionId('')
    setShowSavedSearches(false)
    setShowLibrary(true)
    localStorage.setItem('no-tie-library-visible', 'true')
    setMobileDrawer('none')
  }

  function updateTask(task: ParsedTask, patch: Partial<Pick<ParsedTask, 'done' | 'dueDate' | 'priority'>>) {
    const note = notes.find(item => item.id === task.noteId)
    if (!note) return
    patchNote(note.id, { content: updateTaskLine(note.content, task, patch) })
  }

  function createTask(noteId: string, title: string, dueDate: string, priority: ParsedTask['priority']) {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    const metadata = dueDate || priority !== 'normal' ? ` <!-- no-tie-task${dueDate ? ` due=${dueDate}` : ''}${priority !== 'normal' ? ` priority=${priority}` : ''} -->` : ''
    const separator = note.content.endsWith('\n') ? '' : '\n'
    patchNote(noteId, { content: `${note.content}${separator}- [ ] ${title}${metadata}\n` })
  }

  async function addAttachments(files: File[]) {
    if (!selectedNote) return
    const note = selectedNote
    const additions: NoteAttachment[] = []
    const usedNames = new Set(attachments.filter(attachment => attachment.noteId === note.id).map(attachment => attachment.fileName.toLocaleLowerCase('pl')))
    let content = note.content
    for (const file of files) {
      const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
      const mimeType = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf' } as Record<string, string>)[extension] || ''
      if (!mimeType || (file.type && file.type !== mimeType)) { setToast(`Typ pliku „${file.name}” nie jest obsługiwany.`); window.setTimeout(() => setToast(''), 3000); continue }
      if (file.size > 15 * 1024 * 1024) { setToast(`Plik „${file.name}” przekracza limit 15 MB.`); window.setTimeout(() => setToast(''), 3000); continue }
      const fileName = uniqueAttachmentName(safeAttachmentName(file.name), usedNames)
      const attachment: NoteAttachment = { id: `${note.id}:${crypto.randomUUID()}`, noteId: note.id, fileName, mimeType, dataUrl: await dataUrlFromFile(file, mimeType), size: file.size }
      await saveAttachment(attachment)
      additions.push(attachment)
      if (mimeType.startsWith('image/')) content += `\n\n![${fileName}](./assets/${fileName})`
    }
    if (additions.length) {
      setAttachments(current => [...current, ...additions])
      patchNote(note.id, { content })
      setEditorRevision(value => value + 1)
      setToast(`Dodano ${additions.length} ${additions.length === 1 ? 'załącznik' : 'załączniki'}.`)
      window.setTimeout(() => setToast(''), 2500)
    }
  }

  async function deleteAttachment(attachment: NoteAttachment) {
    await removeAttachment(attachment)
    setAttachments(current => current.filter(item => item.id !== attachment.id))
    const note = notes.find(item => item.id === attachment.noteId)
    if (note) {
      const path = escapeRegExp(`./assets/${attachment.fileName}`)
      const content = note.content.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${path}\\)`, 'g'), '').replace(/\n{3,}/g, '\n\n')
      if (content !== note.content) patchNote(note.id, { content })
    }
    setEditorRevision(value => value + 1)
  }

  async function openNoteHistory() {
    if (!selectedNote) return
    const note = selectedNote
    historyDialogNoteIdRef.current = note.id
    setHistoryDialogNoteId(note.id)
    setShowNoteHistory(true)
    setNoteVersionsLoading(true)
    try {
      await flushNoteVersion(note.id, note)
      let versions = await getNoteVersions(note.id)
      if (!versions.length) {
        await saveNoteVersion(note)
        versions = await getNoteVersions(note.id)
      }
      setNoteVersions(versions)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nie udało się wczytać historii wersji.')
      window.setTimeout(() => setToast(''), 3500)
    } finally {
      setNoteVersionsLoading(false)
    }
  }

  function closeNoteHistory() {
    setShowNoteHistory(false)
    setHistoryDialogNoteId('')
    historyDialogNoteIdRef.current = ''
  }

  function restoreNoteVersion(version: NoteVersion) {
    if (!selectedNote || selectedNote.id !== version.noteId) return
    const snapshot = version.note
    patchNote(selectedNote.id, {
      title: snapshot.title,
      content: snapshot.content,
      folder: snapshot.folder,
      color: snapshot.color,
      tags: [...snapshot.tags],
      favorite: snapshot.favorite,
    })
    setEditorRevision(value => value + 1)
    setToast('Przywrócono wybraną wersję notatki.')
    window.setTimeout(() => setToast(''), 2800)
  }

  function recordNoteHistory(note: Note) {
    const snapshot = copyNote(note)
    if (historyNoteId.current !== note.id) {
      historyNoteId.current = note.id
      noteHistory.current = [snapshot]
      noteRedoHistory.current = []
      return
    }
    const latest = noteHistory.current.at(-1)
    if (latest && JSON.stringify(latest) === JSON.stringify(snapshot)) return
    noteHistory.current.push(snapshot)
    if (noteHistory.current.length > 21) noteHistory.current.shift()
    noteRedoHistory.current = []
  }

  function undoNoteChange() {
    if (noteHistory.current.length < 2 || historyNoteId.current !== selectedId) return
    noteRedoHistory.current.push(noteHistory.current.pop()!)
    const previous = noteHistory.current.at(-1)
    if (!previous) return
    setNotes(current => current.map(note => note.id === previous.id ? copyNote(previous) : note))
    setSaved(false)
    setEditorRevision(value => value + 1)
  }

  function redoNoteChange() {
    if (!noteRedoHistory.current.length || historyNoteId.current !== selectedId) return
    const next = noteRedoHistory.current.pop()!
    noteHistory.current.push(next)
    setNotes(current => current.map(note => note.id === next.id ? copyNote(next) : note))
    setSaved(false)
    setEditorRevision(value => value + 1)
  }

  const createNote = useCallback((template?: NoteTemplate, folderOverride?: string) => {
    const folder = folderOverride ?? (activeFilter === 'root' ? '' : activeFilter !== 'all' && activeFilter !== 'favorites' ? activeFilter : 'Osobiste')
    const note = makeNote(folder, template)
    setActiveReviewSessionId('')
    setSaved(false)
    void saveNote(note).then(async () => {
      await saveNoteVersion(note)
      setSaved(true)
    }, () => setSaved(false))
    setNotes(current => [note, ...current])
    setEditorSelection({ noteId: note.id, mode: editorMode, text: '' })
    setSelectedId(note.id)
    setEditorRevision(value => value + 1)
    setMobileDrawer('none')
  }, [activeFilter, editorMode])

  async function createFolder() {
    const name = folderDraft.trim().replace(/^\/+|\/+$/g, '')
    if (!name) return
    if (folders.includes(name)) {
      setToast(`Folder „${name}” już istnieje`)
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    const next = [...new Set([...folders, ...folderParents(name)])]
    setFolderRegistry(next)
    try {
      await saveFolders(next)
    } catch {
      setToast('Nie udało się zapisać folderu')
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    setActiveFilter(name)
    setFolderDraft('')
    setShowFolderDialog(false)
    setToast(`Folder „${name}” został utworzony`)
    window.setTimeout(() => setToast(''), 2800)
  }

  function moveNoteToFolder(id: string, folder: string) {
    patchNote(id, { folder })
    if (folder) setFolderRegistry(current => [...new Set([...current, ...folderParents(folder)])])
  }

  function moveFolder(source: string, target: string) {
    if (!source || source === target || target.startsWith(`${source}/`)) return
    const destination = target ? `${target}/${source.split('/').at(-1)}` : source.split('/').at(-1) ?? source
    if (folders.includes(destination) && destination !== source) {
      setToast('Folder o tej nazwie już istnieje')
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    const relocate = (folder: string) => folder === source ? destination : folder.startsWith(`${source}/`) ? `${destination}${folder.slice(source.length)}` : folder
    const nextFolders = [...new Set(folders.map(relocate).flatMap(folderParents))]
    setFolderRegistry(nextFolders)
    setFolderColors(current => relocateFolderColors(current, source, destination))
    setActiveFilter(current => current === source || current.startsWith(`${source}/`) ? relocate(current) : current)
    const updatedAt = currentTimestamp()
    setNotes(current => current.map(note => {
      if (note.folder !== source && !note.folder.startsWith(`${source}/`)) return note
      const updated = { ...note, folder: relocate(note.folder), updatedAt }
      if (note.id === selectedId) {
        historyNoteId.current = note.id
        noteHistory.current = [copyNote(updated)]
        noteRedoHistory.current = []
      }
      return updated
    }))
  }

  function startEntryPointerDrag(event: React.PointerEvent, target: EntryTarget, label: string) {
    if (event.button !== 0) return
    entryDropAction.current = handleEntryDrop
    entryPointerDrag.current = {
      target,
      label,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    }
  }

  function ignoreClickAfterDrag(): boolean {
    if (!suppressEntryClick.current) return false
    suppressEntryClick.current = false
    return true
  }

  function handleEntryDrop(target: EntryTarget, targetFolder: string) {
    if (target.kind === 'note') moveNoteToFolder(target.id, targetFolder)
    else moveFolder(target.path, targetFolder)
    setOpenActionMenu('')
  }

  function menuKey(target: EntryTarget) {
    return target.kind === 'folder' ? `folder:${target.path}` : `note:${target.id}`
  }

  function beginRename(target: EntryTarget) {
    const value = target.kind === 'folder'
      ? target.path.split('/').at(-1) ?? target.path
      : notes.find(note => note.id === target.id)?.title ?? ''
    setRenameTarget(target)
    setRenameDraft(value)
    setOpenActionMenu('')
  }

  function askDelete(target: EntryTarget) {
    const note = target.kind === 'note' ? notes.find(item => item.id === target.id) : undefined
    const label = target.kind === 'folder' ? target.path.split('/').at(-1) ?? target.path : note?.title ?? 'notatkę'
    const noteCount = target.kind === 'folder'
      ? notes.filter(item => item.folder === target.path || item.folder.startsWith(`${target.path}/`)).length
      : 1
    setDeleteTarget({ ...target, label, noteCount } as DeleteTarget)
    setOpenActionMenu('')
  }

  function commitRename() {
    const value = renameDraft.trim()
    if (!renameTarget || !value) return
    if (renameTarget.kind === 'note') {
      const renamed = notes.find(note => note.id === renameTarget.id)
      if (renamed && renamed.title !== value) {
        notes.filter(note => note.id !== renamed.id).forEach(note => {
          const content = replaceWikiLinkTarget(note.content, renamed.title, value)
          if (content !== note.content) patchNote(note.id, { content })
        })
      }
      patchNote(renameTarget.id, { title: value })
    } else {
      if (value.includes('/') || value.includes('\\')) {
        setToast('Nazwa folderu nie może zawierać ukośnika')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      const parts = renameTarget.path.split('/')
      parts[parts.length - 1] = value
      const destination = parts.join('/')
      if (destination !== renameTarget.path && folders.includes(destination)) {
        setToast('Folder o tej nazwie już istnieje')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      const source = renameTarget.path
      const relocate = (folder: string) => folder === source ? destination : folder.startsWith(`${source}/`) ? `${destination}${folder.slice(source.length)}` : folder
      setFolderRegistry([...new Set(folders.map(relocate).flatMap(folderParents))])
      setFolderColors(current => relocateFolderColors(current, source, destination))
      setActiveFilter(current => current === source || current.startsWith(`${source}/`) ? relocate(current) : current)
      const updatedAt = currentTimestamp()
      setNotes(current => current.map(note => {
        if (note.folder !== source && !note.folder.startsWith(`${source}/`)) return note
        const updated = { ...note, folder: relocate(note.folder), updatedAt }
        if (note.id === selectedId) {
          historyNoteId.current = note.id
          noteHistory.current = [copyNote(updated)]
          noteRedoHistory.current = []
        }
        return updated
      }))
    }
    setRenameTarget(null)
    setRenameDraft('')
  }

  async function removeNoteFromLibrary(id: string) {
    await removeAssetsForNote(id)
    await removeAttachmentsForNote(id)
    await removeNote(id)
    setAssets(current => current.filter(asset => asset.noteId !== id))
    setAttachments(current => current.filter(attachment => attachment.noteId !== id))
    setNotes(current => current.filter(note => note.id !== id))
    if (selectedId === id) selectNote(notes.find(note => note.id !== id)?.id ?? '')
    setSaved(true)
  }

  async function confirmDelete() {
    const target = deleteTarget
    if (!target) return
    try {
      if (target.kind === 'note') {
        await removeNoteFromLibrary(target.id)
      } else {
        const removedNotes = notes.filter(note => note.folder === target.path || note.folder.startsWith(`${target.path}/`))
        await Promise.all(removedNotes.map(async note => {
          await removeAssetsForNote(note.id)
          await removeAttachmentsForNote(note.id)
          await removeNote(note.id)
        }))
        const removedIds = new Set(removedNotes.map(note => note.id))
        setAssets(current => current.filter(asset => !removedIds.has(asset.noteId)))
        setAttachments(current => current.filter(attachment => !removedIds.has(attachment.noteId)))
        setNotes(current => current.filter(note => !removedIds.has(note.id)))
        if (selectedId && removedIds.has(selectedId)) selectNote(notes.find(note => !removedIds.has(note.id))?.id ?? '')
        const nextFolders = folders.filter(folder => folder !== target.path && !folder.startsWith(`${target.path}/`))
        setFolderRegistry(nextFolders)
        setFolderColors(current => Object.fromEntries(Object.entries(current).filter(([folder]) => folder !== target.path && !folder.startsWith(`${target.path}/`))))
        await saveFolders(nextFolders)
        await removeFolderFromDisk(target.path)
        if (activeFilter === target.path || activeFilter.startsWith(`${target.path}/`)) setActiveFilter('all')
      }
      setDeleteTarget(null)
      setToast(`Usunięto „${target.label}”`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nie udało się usunąć elementu')
    }
    window.setTimeout(() => setToast(''), 2800)
  }

  function renderEntryMenu(target: EntryTarget): React.ReactNode {
    const key = menuKey(target)
    return <div className="entry-actions" onClick={event => event.stopPropagation()}>
      <button className="entry-more-button" title="Więcej opcji" aria-label="Więcej opcji" aria-expanded={openActionMenu === key} onClick={() => setOpenActionMenu(current => current === key ? '' : key)}><MoreVertical size={16} /></button>
      {openActionMenu === key && <div className="sidebar-context-menu" role="menu">
        <button role="menuitem" onClick={() => { setColorTarget(target); setOpenActionMenu('') }}><Palette size={14} />Ustaw kolor</button>
        <button role="menuitem" onClick={() => beginRename(target)}><Pencil size={14} />Zmień nazwę</button>
        <button className="danger-menu-item" role="menuitem" onClick={() => askDelete(target)}><Trash2 size={14} />Usuń</button>
      </div>}
    </div>
  }

  function renderNoteFile(note: Note, depth = 0): React.ReactNode {
    const target: EntryTarget = { kind: 'note', id: note.id }
    const color = noteDisplayColor(note)
    return <div key={note.id} className={`folder-file-row ${selectedId === note.id ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={{ paddingLeft: `${27 + depth * 14}px`, ...(entryColorStyle(color) ?? {}) }}>
      <button className={`folder-file-item ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, target, note.title || 'Bez tytułu')} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); setActiveFilter(note.folder ? note.folder : 'root'); selectNote(note.id); setMobileDrawer('none') }} title="Przeciągnij notatkę do innego folderu"><FileText size={13} /><span>{note.title || 'Bez tytułu'}</span></button>
      {renderEntryMenu(target)}
    </div>
  }

  function renderFolderTree(parent: string, depth = 0): React.ReactNode {
    const children = folders.filter(folder => (folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '') === parent)
    return children.map(folder => {
      const label = folder.split('/').at(-1) ?? folder
      const directNotes = notes.filter(note => note.folder === folder).sort((a, b) => a.title.localeCompare(b.title, 'pl'))
      const count = notes.filter(note => note.folder === folder || note.folder.startsWith(`${folder}/`)).length
      const target: EntryTarget = { kind: 'folder', path: folder }
      const color = folderDisplayColor(folder)
      return <div key={folder} className="folder-tree-node" data-drop-folder={folder}>
        <div className={`folder-drop-row ${activeFilter === folder ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={{ paddingLeft: `${10 + depth * 14}px`, ...(entryColorStyle(color) ?? {}) }} data-drop-folder={folder}>
          <button className={`nav-item folder-item ${activeFilter === folder && !activeReviewSession ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, target, label)} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); setActiveFilter(folder); setMobileDrawer('none') }} title={`Przeciągnij folder „${label}”, aby go przenieść`}><Folder size={16} /><span>{label}</span><span className="nav-count">{count}</span></button>
          {renderEntryMenu(target)}
        </div>
        {directNotes.map(note => renderNoteFile(note, depth))}
        {renderFolderTree(folder, depth + 1)}
      </div>
    })
  }

  function folderDisplayColor(folder: string): string | undefined {
    const parents = folderParents(folder)
    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const color = folderColors[parents[index]]
      if (color) return color
    }
    return undefined
  }

  function noteDisplayColor(note: Note): string | undefined {
    return note.color || folderDisplayColor(note.folder)
  }

  function applyEntryColor(color?: string) {
    if (!colorTarget) return
    if (colorTarget.kind === 'note') {
      patchNote(colorTarget.id, { color })
    } else {
      setFolderColors(current => {
        const next = { ...current }
        if (color) next[colorTarget.path] = color
        else delete next[colorTarget.path]
        return next
      })
    }
    setColorTarget(null)
  }

  function createReviewSession(title: string, noteIds: string[]) {
    if (!noteIds.length) return
    const now = Date.now()
    const session: ReviewSession = {
      id: crypto.randomUUID(),
      title: title || `Powtórka ${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now)}`,
      noteIds: [...noteIds],
      createdAt: now,
      updatedAt: now,
      totalTimeMs: 0,
      noteTimesMs: Object.fromEntries(noteIds.map(id => [id, 0])),
      activeNoteId: noteIds[0] ?? null,
      status: 'ready',
    }
    setReviewSessions(current => [session, ...current])
    setActiveReviewSessionId(session.id)
    setShowReviewSessionDialog(false)
    setEditingReviewSessionId('')
    setMobileDrawer('none')
  }

  function updateReviewSession(sessionId: string, title: string, noteIds: string[]) {
    const validNoteIds = [...new Set(noteIds.filter(id => notes.some(note => note.id === id)))]
    if (!validNoteIds.length) return
    const now = Date.now()
    setReviewSessions(current => current.map(session => {
      if (session.id !== sessionId) return session
      const checkpointed = checkpointReviewSession(session, now)
      return {
        ...checkpointed,
        title: title.trim() || session.title,
        noteIds: validNoteIds,
        noteTimesMs: Object.fromEntries(validNoteIds.map(id => [id, checkpointed.noteTimesMs[id] ?? 0])),
        activeNoteId: session.activeNoteId && validNoteIds.includes(session.activeNoteId) ? session.activeNoteId : validNoteIds[0],
        updatedAt: now,
      }
    }))
    setActiveReviewSessionId(sessionId)
    setShowReviewSessionDialog(false)
    setEditingReviewSessionId('')
    setMobileDrawer('none')
  }

  function reorderReviewSession(sessionId: string, noteIds: string[]) {
    const now = Date.now()
    setReviewSessions(current => current.map(session => session.id === sessionId
      ? { ...checkpointReviewSession(session, now), noteIds: [...noteIds], updatedAt: now }
      : session))
  }

  function openReviewSessionEditor(sessionId = '') {
    setEditingReviewSessionId(sessionId)
    setShowReviewSessionDialog(true)
  }

  function closeReviewSessionEditor() {
    setShowReviewSessionDialog(false)
    setEditingReviewSessionId('')
  }

  function startReviewTimer(sessionId: string) {
    const now = Date.now()
    setReviewSessions(current => current.map(session => {
      if (session.id === sessionId) {
        if (session.status === 'completed') return session
        const readySession = session.activeNoteId ? session : { ...session, activeNoteId: session.noteIds[0] ?? null }
        return checkpointReviewSession(readySession, now, 'running')
      }
      return session.status === 'running' ? checkpointReviewSession(session, now, 'paused') : session
    }))
  }

  function pauseReviewTimer(sessionId: string, status: 'paused' | 'completed' = 'paused') {
    const now = Date.now()
    setReviewSessions(current => current.map(session => session.id === sessionId ? checkpointReviewSession(session, now, status) : session))
  }

  function resetReviewTimer(sessionId: string) {
    const now = Date.now()
    setReviewSessions(current => current.map(session => session.id === sessionId ? {
      ...session,
      totalTimeMs: 0,
      noteTimesMs: Object.fromEntries(session.noteIds.map(id => [id, 0])),
      activeNoteId: session.noteIds[0] ?? null,
      status: 'ready',
      runningSince: undefined,
      updatedAt: now,
    } : session))
  }

  function setActiveReviewNote(sessionId: string, noteId: string) {
    const now = Date.now()
    setReviewSessions(current => current.map(session => {
      if (session.id !== sessionId || !session.noteIds.includes(noteId)) return session
      return { ...checkpointReviewSession(session, now), activeNoteId: noteId, updatedAt: now }
    }))
  }

  function openReviewNote(noteId: string) {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    setActiveReviewSessionId('')
    selectNote(note.id)
    setActiveFilter(note.folder || 'root')
    setMobileDrawer('none')
  }

  function setDisplayMode(mode: NoteDisplayMode) {
    setNoteDisplayMode(mode)
    localStorage.setItem('no-tie-note-display-mode', mode)
  }

  function toggleChat() {
    setShowChat(current => {
      const next = !current
      localStorage.setItem('no-tie-ollama-chat-open', String(next))
      return next
    })
  }

  function closeChat() {
    setShowChat(false)
    localStorage.setItem('no-tie-ollama-chat-open', 'false')
  }

  function toggleLibrary() {
    setShowLibrary(current => {
      const next = !current
      localStorage.setItem('no-tie-library-visible', String(next))
      return next
    })
  }

  function openOllamaSettings() {
    setOllamaDraftUrl(ollamaBaseUrl)
    setOllamaDraftModel(ollamaModel)
    setOllamaSettingsMessage('')
    setOllamaSettingsError('')
    setShowOllamaSettings(true)
  }

  async function discoverOllamaModels() {
    setCheckingOllama(true)
    setOllamaSettingsMessage('Łączę się z lokalnym serwerem…')
    setOllamaSettingsError('')
    try {
      const available = await listOllamaModels(ollamaDraftUrl)
      setOllamaModels(available)
      if (available.length) {
        setOllamaDraftModel(current => available.some(model => model.name === current) ? current : available[0].name)
        setOllamaSettingsMessage(`Połączono. Dostępne modele: ${available.length}.`)
      } else {
        setOllamaSettingsMessage('Połączono, ale nie znaleziono modeli. Pobierz model w Ollama, a potem odśwież listę.')
      }
    } catch (error) {
      setOllamaSettingsMessage('')
      setOllamaSettingsError(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Nie udało się połączyć z Ollama.')
    } finally {
      setCheckingOllama(false)
    }
  }

  function saveOllamaSettings() {
    const baseUrl = ollamaDraftUrl.trim().replace(/\/+$/, '')
    const model = ollamaDraftModel.trim()
    if (!baseUrl) {
      setOllamaSettingsError('Wpisz adres lokalnego serwera Ollama.')
      return
    }
    setOllamaBaseUrl(baseUrl)
    setOllamaModel(model)
    localStorage.setItem('no-tie-ollama-url', baseUrl)
    localStorage.setItem('no-tie-ollama-model', model)
    setShowOllamaSettings(false)
  }

  async function exportNotesArchive() {
    try {
      await Promise.all(notes.map(note => flushNoteVersion(note.id, note)))
      const versions = (await Promise.all(notes.map(note => getNoteVersions(note.id)))).flat()
      const savedPath = await exportArchiveToFolder(notes, assets, versions, attachments)
      if (!savedPath) return
      setToast(`Paczka została zapisana: ${savedPath}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nie udało się przygotować paczki')
    }
    window.setTimeout(() => setToast(''), 2800)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuickSearchActiveIndex(0)
        setShowQuickSearch(true)
      } else if (event.key.toLowerCase() === 'n' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        createNote()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote])

  useEffect(() => {
    undoNoteAction.current = undoNoteChange
    redoNoteAction.current = redoNoteChange
  })

  useEffect(() => {
    const onHistoryKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('[role="dialog"]') || !target.closest('.note-editor')) return
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey && noteHistory.current.length > 1) {
        event.preventDefault()
        event.stopPropagation()
        undoNoteAction.current()
      } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && noteRedoHistory.current.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        redoNoteAction.current()
      }
    }
    window.addEventListener('keydown', onHistoryKeyDown, true)
    return () => window.removeEventListener('keydown', onHistoryKeyDown, true)
  }, [])

  useEffect(() => {
    if (!openActionMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.entry-actions')) setOpenActionMenu('')
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [openActionMenu])

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = parseArchive(new Uint8Array(await file.arrayBuffer()))
      setSaved(false)
      await Promise.all(imported.notes.map(async note => {
        await saveNote(note)
        const versions = imported.versions.filter(version => version.noteId === note.id)
        if (versions.length) await saveNoteVersions(note.id, versions)
        else await saveNoteVersion(note)
      }))
      await Promise.all(imported.assets.map(saveAsset))
      await Promise.all(imported.attachments.map(saveAttachment))
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
      setAttachments(current => {
        const byId = new Map(current.map(attachment => [attachment.id, attachment]))
        imported.attachments.forEach(attachment => byId.set(attachment.id, attachment))
        return [...byId.values()]
      })
      selectNote(imported.notes[0].id)
      setActiveFilter('all')
      setEditorRevision(value => value + 1)
      window.alert(`Zaimportowano ${imported.notes.length} notatek.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Nie udało się zaimportować paczki.')
    }
    event.target.value = ''
  }

  async function deleteSelected() {
    if (selectedNote) askDelete({ kind: 'note', id: selectedNote.id })
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
    <main className={`app-shell ${mobileDrawer !== 'none' ? 'drawer-open' : ''} ${showChat ? 'with-ollama-chat' : ''} ${showLibrary ? '' : 'library-hidden'}`}>
      <aside className={`sidebar ${mobileDrawer === 'sidebar' ? 'mobile-visible' : ''}`}>
        <div className="sidebar-content">
          <div className="brand-row"><div className="brand-mark">N</div><span>No-Tie</span><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij menu"><X size={18} /></button></div>
          <button className="new-note-button" onClick={() => createNote()}><Plus size={17} /><span>Nowa notatka</span><kbd>N</kbd></button>
          <div className="sidebar-section">
            <span className="section-label">BIBLIOTEKA</span>
            <button className={`nav-item ${activeFilter === 'all' && !activeReviewSession ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(''); setActiveFilter('all'); setMobileDrawer('none') }}><BookOpen size={17} /><span>Wszystkie notatki</span><span className="nav-count">{notes.length}</span></button>
            <button className={`nav-item ${activeFilter === 'favorites' && !activeReviewSession ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(''); setActiveFilter('favorites'); setMobileDrawer('none') }}><Heart size={17} /><span>Ulubione</span></button>
            <button className="nav-item" onClick={() => { setActiveReviewSessionId(''); setActiveFilter('all'); setQuery(''); setMobileDrawer('notes') }}><Clock3 size={17} /><span>Ostatnie</span></button>
          </div>
          <div className="sidebar-section workspace-tools">
            <div className="section-heading"><span className="section-label">NARZĘDZIA</span></div>
            <button className="nav-item" onClick={() => setShowDailyNotes(true)}><CalendarDays size={16} /><span>Notatki dzienne</span></button>
            <button className="nav-item" onClick={() => setShowTaskManager(true)}><CheckSquare2 size={16} /><span>Zadania</span><span className="nav-count">{parsedTasks.filter(task => !task.done).length}</span></button>
            <button className="nav-item" onClick={() => setShowKnowledgeGraph(true)}><Network size={16} /><span>Mapa powiązań</span></button>
            <button className="nav-item" onClick={() => setShowSavedSearches(true)}><BookmarkPlus size={16} /><span>Zapisane widoki</span><span className="nav-count">{savedSearches.length}</span></button>
            {savedSearches.map(search => <button className="nav-item saved-search-nav" key={search.id} title={search.name} onClick={() => applySavedSearch(search)}><Search size={14} /><span>{search.name}</span></button>)}
            <button className="nav-item" onClick={() => setShowTemplateManager(true)}><FilePlus2 size={16} /><span>Szablony</span></button>
          </div>
          <div className="sidebar-section review-sidebar-section">
            <div className="section-heading"><span className="section-label">POWTÓRKI</span><button className="tiny-icon" title="Nowa powtórka" aria-label="Nowa powtórka" onClick={() => openReviewSessionEditor()}><Plus size={15} /></button></div>
            <button className="nav-item review-new-button" onClick={() => openReviewSessionEditor()}><Repeat2 size={16} /><span>Nowa powtórka</span></button>
            {reviewSessions.map(session => <button key={session.id} className={`nav-item review-session-nav ${activeReviewSessionId === session.id ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(session.id); setMobileDrawer('none') }} title={session.title} aria-current={activeReviewSessionId === session.id ? 'page' : undefined}><Repeat2 size={14} /><span className={`review-session-dot ${session.status === 'running' ? 'running' : ''}`} /><span>{session.title}</span><span className="nav-count">{session.noteIds.length}</span></button>)}
            {!reviewSessions.length && <p className="review-sidebar-empty">Utwórz sesję, aby zapisać listę notatek do powtórki.</p>}
          </div>
          <div className="sidebar-section folders-section" data-drop-folder="">
            <div className="section-heading"><span className="section-label">FOLDERY</span><button className="tiny-icon" title="Dodaj folder" aria-label="Dodaj folder" onClick={() => { setFolderDraft(''); setShowFolderDialog(true) }}><Plus size={15} /></button></div>
            <div className={`folder-drop-row root-folder-drop ${activeFilter === 'root' ? 'active' : ''}`} data-drop-folder="">
              <button className={`nav-item folder-item ${activeFilter === 'root' && !activeReviewSession ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(''); setActiveFilter('root'); setMobileDrawer('none') }}><Folder size={16} /><span>Bez folderu</span><span className="nav-count">{notes.filter(note => !note.folder).length}</span></button>
            </div>
            {notes.filter(note => !note.folder).map(note => renderNoteFile(note))}
            {renderFolderTree('')}
            {!folders.length && !notes.some(note => !note.folder) && <p className="empty-hint">Utwórz folder lub przeciągnij tu notatkę.</p>}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="offline-card"><span className="online-dot" /><div><strong>Dane lokalne</strong><span>{storageLocationLabel} · offline</span></div><Check size={15} /></div>
          <div className="user-row"><div className="avatar">N</div><div><strong>Moje notatki</strong><span>Przestrzeń prywatna</span></div><button type="button" className="sidebar-help-button" onClick={() => setShowHelp(true)} title="Instrukcja obsługi" aria-label="Otwórz instrukcję obsługi"><CircleHelp size={19} /></button></div>
        </div>
      </aside>

      <section className={`notes-panel ${mobileDrawer === 'notes' ? 'mobile-visible' : ''}`} hidden={!showLibrary}>
        <div className="notes-panel-heading"><div><p className="eyebrow">TWOJA BIBLIOTEKA</p><h1>{activeFilter === 'all' ? 'Notatki' : activeFilter === 'favorites' ? 'Ulubione' : activeFilter === 'root' ? 'Bez folderu' : activeFilter.split('/').at(-1)}</h1></div><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij listę"><X size={18} /></button></div>
        <div className="search-controls">
          <label className="search-box"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setQuickSearchActiveIndex(0) }} placeholder="Szukaj notatek…" title="Szukaj także po treści, tagach i folderach. Obsługuje tag:, folder:, title: i content:." /><kbd>⌘/Ctrl K</kbd></label>
          <button className={`search-filter-button ${showSearchFilters ? 'active' : ''}`} type="button" aria-label="Filtry wyszukiwania" aria-expanded={showSearchFilters} title="Filtruj po tagu i folderze" onClick={() => setShowSearchFilters(value => !value)}><SlidersHorizontal size={16} /></button>
          <button className="search-quick-button" type="button" aria-label="Otwórz szybkie wyszukiwanie" title="Szybkie wyszukiwanie (Ctrl+K)" onClick={() => { setQuickSearchActiveIndex(0); setShowQuickSearch(true) }}><Search size={15} /><kbd>⌘K</kbd></button>
        </div>
        {showSearchFilters && <div className="search-filter-panel">
          <label><span>Tag</span><select value={searchTag} onChange={event => setSearchTag(event.target.value)} aria-label="Filtruj bibliotekę po tagu"><option value="">Wszystkie tagi</option>{tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <label><span>Folder</span><select value={searchFolder} onChange={event => setSearchFolder(event.target.value)} aria-label="Filtruj bibliotekę po folderze"><option value="">Wszystkie foldery</option><option value="__root__">Bez folderu</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select></label>
          {(searchTag || searchFolder) && <button type="button" className="link-button" onClick={() => { setSearchTag(''); setSearchFolder('') }}>Wyczyść</button>}
          <small>Możesz też wpisać <code>tag:projekt</code>, <code>folder:Praca</code>, <code>title:spotkanie</code> lub <code>content:ustalenia</code>.</small>
        </div>}
        <div className="list-toolbar"><span>{visibleNotes.length} NOTATKI</span><label className="list-view-select"><span>Widok</span><select value={noteDisplayMode} onChange={event => setDisplayMode(event.target.value as NoteDisplayMode)} aria-label="Sposób wyświetlania notatek"><option value="full">Treść i tagi</option><option value="names-tags">Nazwy i tagi</option><option value="names">Same nazwy</option></select></label></div>
        <div className="note-list">
          {visibleNotes.map(note => (
            <button key={note.id} className={`note-card view-${noteDisplayMode} ${selectedId === note.id ? 'selected' : ''} ${noteDisplayColor(note) ? 'has-entry-color' : ''}`} style={entryColorStyle(noteDisplayColor(note))} onPointerDown={event => startEntryPointerDrag(event, { kind: 'note', id: note.id }, note.title || 'Bez tytułu')} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); selectNote(note.id); setMobileDrawer('none') }}>
              {noteDisplayMode === 'full' && <div className="note-card-top"><span className="note-date">{dateLabel(note.updatedAt)}</span>{note.favorite && <Star size={14} className="favorite-mini" fill="currentColor" />}</div>}
              <strong>{note.title || 'Bez tytułu'}</strong>
              {noteDisplayMode === 'full' && <p>{excerpt(note.content) || 'Pusta notatka'}</p>}
              {noteDisplayMode !== 'names' && <div className="note-card-bottom">{noteDisplayMode === 'full' && <span className="folder-pill"><Folder size={12} />{note.folder || 'Bez folderu'}</span>}{note.tags.map(tag => <span key={tag} className="tag-pill">{tag}</span>)}</div>}
            </button>
          ))}
          {!visibleNotes.length && <div className="empty-state compact"><div className="empty-illustration"><Search size={22} /></div><strong>Brak pasujących notatek</strong><span>Spróbuj zmienić wyszukiwanie albo utwórz nową notatkę.</span><button className="button secondary" onClick={() => createNote()}><Plus size={15} />Nowa notatka</button></div>}
        </div>
        <div className="notes-list-footer"><span><span className="online-dot" />{usesNativeFiles ? ' Pliki na tym urządzeniu' : ' Zapis na tym urządzeniu'}</span><button title="Ustawienia Ollama" aria-label="Ustawienia Ollama" onClick={openOllamaSettings}><Settings2 size={16} /></button></div>
      </section>

      <section className="editor-panel">
        <header className="topbar">
          <div className="mobile-actions"><button className="icon-button" onClick={() => setMobileDrawer('sidebar')} aria-label="Otwórz menu"><Menu size={19} /></button><button className="icon-button" onClick={() => { if (!showLibrary) { localStorage.setItem('no-tie-library-visible', 'true'); setShowLibrary(true) } setMobileDrawer('notes') }} aria-label={showLibrary ? 'Pokaż notatki' : 'Pokaż bibliotekę'}><PanelLeft size={18} /></button></div>
          <div className="breadcrumb"><span>{activeReviewSession ? 'Powtórki' : 'Notatki'}</span><span className="crumb-slash">/</span><span>{activeReviewSession?.title ?? selectedNote?.folder ?? 'Osobiste'}</span></div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saved ? 'is-saved' : ''}`}><span className="save-dot" />{saved ? 'Zapisano' : 'Zapisywanie…'}</span>
            {selectedNote && <button className="icon-button note-history-button" onClick={() => void openNoteHistory()} title="Historia wersji notatki" aria-label="Historia wersji notatki"><History size={17} /></button>}
            <button className={`icon-button library-toggle ${showLibrary ? 'active' : ''}`} onClick={toggleLibrary} title={showLibrary ? 'Ukryj bibliotekę' : 'Pokaż bibliotekę'} aria-label={showLibrary ? 'Ukryj bibliotekę' : 'Pokaż bibliotekę'} aria-pressed={showLibrary}><PanelLeft size={17} /></button>
            <button className={`icon-button ollama-toggle ${showChat ? 'active' : ''}`} onClick={toggleChat} title={showChat ? 'Ukryj czat Ollama' : 'Pokaż czat Ollama'} aria-label={showChat ? 'Ukryj czat Ollama' : 'Pokaż czat Ollama'} aria-pressed={showChat}><MessageCircle size={17} /></button>
            <button className="button secondary export-button" onClick={exportNotesArchive}><Archive size={15} /><span>Eksportuj</span></button>
            <button className="icon-button import-icon" onClick={() => importInput.current?.click()} title="Importuj paczkę" aria-label="Importuj paczkę"><Import size={17} /></button>
            <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={handleImport} />
          </div>
        </header>

        {activeReviewSession ? (
          <ReviewSessionView
            session={activeReviewSession}
            notes={notes}
            now={reviewClockNow}
            onStart={() => startReviewTimer(activeReviewSession.id)}
            onPause={() => pauseReviewTimer(activeReviewSession.id)}
            onFinish={() => pauseReviewTimer(activeReviewSession.id, 'completed')}
            onReset={() => resetReviewTimer(activeReviewSession.id)}
            onSetActiveNote={noteId => setActiveReviewNote(activeReviewSession.id, noteId)}
            onOpenNote={openReviewNote}
            onEdit={() => openReviewSessionEditor(activeReviewSession.id)}
            onReorder={noteIds => reorderReviewSession(activeReviewSession.id, noteIds)}
          />
        ) : selectedNote ? (
          <article className="note-editor" key={selectedNote.id}>
            <div className="editor-scroll">
              <div className="note-meta-line"><span className="meta-dot" /><select className="folder-select" value={selectedNote.folder} onChange={event => moveNoteToFolder(selectedNote.id, event.target.value)} aria-label="Folder notatki"><option value="">Bez folderu</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><span className="meta-divider">·</span>Utworzono {dateLabel(selectedNote.createdAt)}</div>
              <input className="note-title-input" value={selectedNote.title} onChange={event => patchNote(selectedNote.id, { title: event.target.value })} placeholder="Tytuł notatki" aria-label="Tytuł notatki" />
              <div className="tags-row"><Tag size={15} /><div className="tag-list">{selectedNote.tags.map(tag => <button className="editable-tag" key={tag} onClick={() => patchNote(selectedNote.id, { tags: selectedNote.tags.filter(item => item !== tag) })} title="Usuń tag">{tag}<X size={11} /></button>)}<input className="tag-input" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} placeholder={selectedNote.tags.length ? 'Dodaj tag…' : 'Dodaj tag'} aria-label="Dodaj tag" />{tagInput && <button className="tag-add-button" onClick={addTag}>Dodaj</button>}</div></div>
              <div className="editor-tools-row">
                <div className="editor-tools-left"><div className="view-mode-toggle" role="group" aria-label="Widok notatki"><button className={`view-mode-button ${editorMode === 'rendered' ? 'active' : ''}`} title="Widok wizualny" aria-label="Widok wizualny" aria-pressed={editorMode === 'rendered'} onClick={() => setEditorMode('rendered')}><Eye size={16} /></button><button className={`view-mode-button ${editorMode === 'source' ? 'active' : ''}`} title="Surowy Markdown" aria-label="Surowy Markdown" aria-pressed={editorMode === 'source'} onClick={() => setEditorMode('source')}><FileText size={16} /></button></div><span className="toolbar-separator" /><button className="inline-tool" onClick={() => { setEditingAsset(undefined); setShowDrawing(true) }}><Sparkles size={15} />Dodaj schemat</button><button className="inline-tool" onClick={() => setShowNoteLinkDialog(true)}><Link2 size={15} />Połącz notatkę</button>{currentAssets.map(asset => <button className="inline-tool asset-tool" key={asset.id} onClick={() => { setEditingAsset(asset); setShowDrawing(true) }}><Lightbulb size={14} />{asset.fileName}</button>)}</div>
                <div className="template-toolbar"><select className="template-select" defaultValue="" aria-label="Wstaw szablon" onChange={event => { const template = templates.find(item => item.id === event.target.value); if (template) { patchNote(selectedNote.id, { title: template.title, content: template.content, tags: [...new Set([...selectedNote.tags, ...template.tags])] }); setEditorRevision(value => value + 1) } event.target.value = '' }}><option value="" disabled>Szablon</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select><button type="button" className="icon-button template-manage-button" title="Zarządzaj szablonami" aria-label="Zarządzaj szablonami" onClick={() => setShowTemplateManager(true)}><Pencil size={14} /></button></div>
              </div>
              {editorMode === 'source' ? <MarkdownSourceEditor noteId={selectedNote.id} markdown={selectedNote.content} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'source', text })} /> : <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownEditor key={`${selectedNote.id}-${editorRevision}`} noteId={selectedNote.id} markdown={selectedNote.content} assets={currentAssets} attachments={currentAttachments} revision={editorRevision} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'rendered', text })} onOpenNote={openLinkedNote} /></Suspense>}
      <NoteConnections note={selectedNote} notes={notes} onOpen={note => openLinkedNote(note.id)} onShowGraph={() => setShowKnowledgeGraph(true)} />
              <NoteAttachmentsPanel attachments={currentAttachments} onAdd={files => void addAttachments(files)} onRemove={attachment => void deleteAttachment(attachment)} />
              <div className="editor-content-stats" aria-label="Statystyki dokumentu i zaznaczenia">
                <span>Dokument: <strong>{polishCount(documentCounts.words, ['słowo', 'słowa', 'słów'])}</strong><i>·</i><strong>{polishCount(documentCounts.characters, ['znak', 'znaki', 'znaków'])}</strong></span>
                <span className="editor-stats-divider" aria-hidden="true" />
                <span>Zaznaczenie: <strong>{polishCount(selectionCounts.words, ['słowo', 'słowa', 'słów'])}</strong><i>·</i><strong>{polishCount(selectionCounts.characters, ['znak', 'znaki', 'znaków'])}</strong></span>
              </div>
              <div className="editor-end-note"><span className="end-line" /><span>Koniec notatki</span><span className="end-line" /></div>
            </div>
            <footer className="editor-footer"><span><Sparkles size={14} />Zapis automatyczny</span><div><button className={`footer-icon ${selectedNote.favorite ? 'favorited' : ''}`} onClick={() => patchNote(selectedNote.id, { favorite: !selectedNote.favorite })} title={selectedNote.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}><Star size={17} fill={selectedNote.favorite ? 'currentColor' : 'none'} /></button><button className="footer-icon delete-note" onClick={() => void deleteSelected()} title="Usuń notatkę"><Trash2 size={17} /></button></div></footer>
          </article>
        ) : (
          <div className="empty-state editor-empty"><div className="empty-illustration"><FilePlus2 size={25} /></div><p className="eyebrow">TWOJA PRZESTRZEŃ</p><h2>Zapisz pierwszą myśl</h2><span>Twoje notatki będą dostępne lokalnie i offline.</span><button className="button primary" onClick={() => createNote()}><Plus size={16} />Nowa notatka</button></div>
        )}
      </section>
      <ChatPanel open={showChat} baseUrl={ollamaBaseUrl} model={ollamaModel} note={selectedNote} notes={notes} assets={assets} onClose={closeChat} onOpenSettings={openOllamaSettings} />
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {entryDragVisual && <div className="entry-drag-ghost" style={{ left: entryDragVisual.x, top: entryDragVisual.y }} aria-hidden="true"><div>{entryDragVisual.target.kind === 'folder' ? <Folder size={15} /> : <FileText size={15} />}<strong>{entryDragVisual.label}</strong></div><span>{entryDragVisual.dropFolder === null ? 'Upuść na folder' : entryDragVisual.dropFolder ? `Przenieś do: ${entryDragVisual.dropFolder}` : 'Przenieś do: Bez folderu'}</span></div>}
      {showDrawing && selectedNote && <Suspense fallback={<div className="modal-backdrop"><div className="loading-screen">Otwieram edytor SVG…</div></div>}><VectorEditor asset={editingAsset} onClose={() => { setShowDrawing(false); setEditingAsset(undefined) }} onSave={svg => void saveDrawing(svg)} /></Suspense>}
      {showReviewSessionDialog && <ReviewSessionDialog
        notes={notes}
        session={reviewSessions.find(session => session.id === editingReviewSessionId)}
        onCancel={closeReviewSessionEditor}
        onSave={(title, noteIds) => editingReviewSessionId ? updateReviewSession(editingReviewSessionId, title, noteIds) : createReviewSession(title, noteIds)}
      />}
      {showFolderDialog && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowFolderDialog(false) }}><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title"><div className="folder-dialog-mark"><Folder size={20} /></div><h2 id="folder-dialog-title">Utwórz folder</h2><p>Foldery możesz później układać, przeciągając je na siebie w panelu po lewej.</p><form onSubmit={event => { event.preventDefault(); void createFolder() }}><label htmlFor="new-folder-name">Nazwa folderu</label><input id="new-folder-name" autoFocus value={folderDraft} onChange={event => setFolderDraft(event.target.value)} placeholder="np. Projekty" /><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={() => setShowFolderDialog(false)}>Anuluj</button><button type="submit" className="button primary" disabled={!folderDraft.trim()}>Utwórz folder</button></div></form></section></div>}
      {renameTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRenameTarget(null) }}><section className="folder-dialog action-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title"><div className="folder-dialog-mark"><Pencil size={19} /></div><h2 id="rename-dialog-title">Zmień nazwę</h2><p>{renameTarget.kind === 'folder' ? 'Zmienisz nazwę folderu wraz z jego podfolderami.' : 'Zmienisz nazwę notatki i zapisany plik Markdown.'}</p><form onSubmit={event => { event.preventDefault(); commitRename() }}><label htmlFor="entry-rename">Nowa nazwa</label><input id="entry-rename" autoFocus value={renameDraft} onChange={event => setRenameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRenameTarget(null) }} /><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={() => setRenameTarget(null)}>Anuluj</button><button type="submit" className="button primary" disabled={!renameDraft.trim()}>Zapisz nazwę</button></div></form></section></div>}
      {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDeleteTarget(null) }}><section className="folder-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><div className="danger-mark"><Trash2 size={19} /></div><h2 id="delete-dialog-title">{deleteTarget.kind === 'folder' ? 'Usuń folder?' : 'Usuń notatkę?'}</h2><p>{deleteTarget.kind === 'folder' ? <>Folder <strong>„{deleteTarget.label}”</strong> i jego zawartość zostaną trwale usunięte. {deleteTarget.noteCount ? `Usunięte zostanie też ${deleteTarget.noteCount} ${deleteTarget.noteCount === 1 ? 'notatka' : 'notatek'} wraz z załącznikami SVG.` : 'Folder jest pusty.'}</> : <>Notatka <strong>„{deleteTarget.label}”</strong> i dołączone do niej schematy SVG zostaną trwale usunięte.</>}</p><div className="folder-dialog-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>Anuluj</button><button className="button danger-button" onClick={() => void confirmDelete()}><Trash2 size={14} />Usuń</button></div></section></div>}
      {colorTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setColorTarget(null) }}><section className="folder-dialog entry-color-dialog" role="dialog" aria-modal="true" aria-labelledby="entry-color-title"><div className="folder-dialog-mark"><Palette size={19} /></div><h2 id="entry-color-title">Ustaw kolor</h2><p>{colorTarget.kind === 'folder' ? <>Kolor folderu <strong>„{colorTarget.path.split('/').at(-1)}”</strong> będzie widoczny po lewej i na kartach jego notatek w bibliotece.</> : <>Kolor pliku <strong>„{notes.find(note => note.id === colorTarget.id)?.title ?? 'notatka'}”</strong> będzie widoczny po lewej i w bibliotece.</>}</p><div className="entry-color-grid">{entryColors.map(color => <button key={color.value} className="entry-color-option" type="button" aria-label={`Ustaw kolor: ${color.label}`} aria-pressed={(colorTarget.kind === 'note' ? notes.find(note => note.id === colorTarget.id)?.color : folderColors[colorTarget.path]) === color.value} onClick={() => applyEntryColor(color.value)}><span className="entry-color-swatch" style={{ backgroundColor: color.value }} /><span>{color.label}</span></button>)}</div><div className="folder-dialog-actions"><button className="button secondary" onClick={() => applyEntryColor(undefined)}>Domyślny / kolor folderu</button><button className="button secondary" onClick={() => setColorTarget(null)}>Zamknij</button></div></section></div>}
      {showOllamaSettings && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowOllamaSettings(false) }}><section className="folder-dialog ollama-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ollama-settings-title"><div className="folder-dialog-mark"><MessageCircle size={19} /></div><h2 id="ollama-settings-title">Lokalny model Ollama</h2><p>Podłącz uruchomiony serwer Ollama. Domyślny adres lokalny to <code>http://localhost:11434</code>.</p><form onSubmit={event => { event.preventDefault(); saveOllamaSettings() }}><label htmlFor="ollama-base-url">Adres serwera</label><input id="ollama-base-url" autoFocus type="url" value={ollamaDraftUrl} onChange={event => { setOllamaDraftUrl(event.target.value); setOllamaModels([]); setOllamaSettingsMessage('') }} placeholder="http://localhost:11434" /><div className="ollama-model-label"><label htmlFor="ollama-model-name">Model</label><button type="button" className="link-button" onClick={() => void discoverOllamaModels()} disabled={checkingOllama}><span>{checkingOllama ? 'Łączenie…' : 'Pobierz listę modeli'}</span></button></div><input id="ollama-model-name" list="ollama-model-options" value={ollamaDraftModel} onChange={event => setOllamaDraftModel(event.target.value)} placeholder="np. llama3.2" /><datalist id="ollama-model-options">{ollamaModels.map(model => <option key={model.name} value={model.name} />)}</datalist>{ollamaSettingsMessage && <p className="ollama-settings-status" role="status">{ollamaSettingsMessage}</p>}{ollamaSettingsError && <p className="ollama-settings-error" role="alert">{ollamaSettingsError}</p>}<p className="ollama-settings-help">Modele pobierzesz poleceniem <code>ollama pull llama3.2</code>. Rozmowy są obsługiwane przez lokalny serwer.</p><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={() => setShowOllamaSettings(false)}>Anuluj</button><button type="submit" className="button primary">Zapisz ustawienia</button></div></form></section></div>}
      {showDailyNotes && <DailyNotesDialog notes={notes} onSelect={openDailyNote} onClose={() => setShowDailyNotes(false)} />}
      {showTaskManager && <TaskManagerDialog notes={notes} tasks={parsedTasks} onUpdate={updateTask} onOpenNote={noteId => { setShowTaskManager(false); openLinkedNote(noteId) }} onCreate={createTask} onClose={() => setShowTaskManager(false)} />}
      {showKnowledgeGraph && <KnowledgeGraphDialog notes={notes} onOpen={note => { setShowKnowledgeGraph(false); openLinkedNote(note.id) }} onClose={() => setShowKnowledgeGraph(false)} />}
      {showSavedSearches && <SavedSearchDialog searches={savedSearches} current={{ query, tag: searchTag, folder: searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : '') }} onSave={name => { const folder = searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : ''); setSavedSearches(current => [{ id: crypto.randomUUID(), name, query, tag: searchTag, folder }, ...current]) }} onApply={applySavedSearch} onDelete={id => setSavedSearches(current => current.filter(search => search.id !== id))} onClose={() => setShowSavedSearches(false)} />}
      {showTemplateManager && <TemplateManagerDialog templates={templates} onSave={setTemplates} onClose={() => setShowTemplateManager(false)} />}
      {showQuickSearch && <NoteSearchDialog
        query={query}
        tag={searchTag}
        folder={searchFolder}
        tags={tagOptions}
        folders={folders}
        results={searchResults.slice(0, 40)}
        activeIndex={quickSearchActiveIndex}
        onQueryChange={setQuery}
        onTagChange={setSearchTag}
        onFolderChange={setSearchFolder}
        onActiveIndexChange={setQuickSearchActiveIndex}
        onSelect={openSearchResult}
        onClose={() => setShowQuickSearch(false)}
      />}
      {showNoteLinkDialog && selectedNote && <NoteLinkDialog
        notes={notes}
        currentNoteId={selectedNote.id}
        onSelect={note => {
          dispatchWikiLinkInsert({ noteId: selectedNote.id, target: note.title || note.id })
          setShowNoteLinkDialog(false)
        }}
        onClose={() => setShowNoteLinkDialog(false)}
      />}
      {showNoteHistory && selectedNote && historyDialogNoteId === selectedNote.id && <NoteHistoryDialog note={selectedNote} versions={noteVersions} loading={noteVersionsLoading} onRestore={restoreNoteVersion} onClose={closeNoteHistory} />}
      {toast && <div className="app-toast" role="status"><Check size={16} />{toast}</div>}
      {mobileDrawer !== 'none' && <button className="drawer-scrim" aria-label="Zamknij menu" onClick={() => setMobileDrawer('none')} />}
    </main>
  )
}

export default App
