import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Archive, BarChart3, Bell, BookOpen, BookmarkPlus, Brain, CalendarDays, Check, CheckSquare2, ChevronDown, Clock3, Code2, Columns3, Copy, Eye, FilePlus2, FileText, Folder, Heart, History, Import, Lightbulb,
  CircleHelp, LockKeyhole, Menu, MessageCircle, MoreVertical, Network, Paperclip, Palette, PanelLeft, Pencil, Plus, Puzzle, Repeat2, Search, Settings2, SlidersHorizontal, Sparkles, Star, Tag, Trash2, X,
} from 'lucide-react'
import { buildArchive, exportArchiveToFolder, parseArchive } from './archive'
import { ChatPanel } from './ChatPanel'
import { markdownToNote, starterAssets, starterNotes } from './content'
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
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog'
import { HelpDialog } from './HelpDialog'
import { BackupTrashDialog } from './BackupTrashDialog'
import { FlashcardsPage } from './FlashcardsPage'
import { CreateNoteDialog } from './CreateNoteDialog'
import { NoteCollectionPage } from './NoteCollectionPage'
import { AiSelectionEditDialog } from './AiSelectionEditDialog'
import { FeatureManagerDialog } from './FeatureManagerDialog'
import { AppLockDialog } from './AppLockDialog'
import { AttachmentManagerDialog } from './AttachmentManagerDialog'
import { DuplicateManagerDialog } from './DuplicateManagerDialog'
import { NoteBoardDialog, type NoteWorkflowStatus } from './NoteBoardDialog'
import { NoteReminderDialog } from './NoteReminderDialog'
import { ProjectDashboardDialog } from './ProjectDashboardDialog'
import { AiNoteToolsDialog, type AiNoteTool } from './AiNoteToolsDialog'
import { NotePropertiesEditor } from './NotePropertiesEditor'
import { MarkdownSourceEditor } from './MarkdownSourceEditor'
import { searchNotes } from './noteSearch'
import { nextTaskDate, parseTasks, updateTaskLine, type ParsedTask, type TaskPatch } from './knowledge'
import { resolveWikiTarget } from './knowledge'
import { embedOllamaTexts, imageAttachmentToPngBase64, listOllamaModels, streamOllamaMessage, transcribeLocalAudio, type OllamaModel } from './ollama'
import { ReviewSessionDialog } from './ReviewSessionDialog'
import { ReviewSessionView } from './ReviewSessionView'
import { ReviewSessionsOverview } from './ReviewSessionsOverview'
import { checkpointReviewSession } from './reviews'
import { archiveAttachment, deleteAutoBackup, getAssets, getAttachmentHistory, getAttachments, getAutoBackups, getFlashcards, getFolderColors, getFolders, getNoteTemplates, getNoteVersions, getNotes, getReviewSessions, getSavedSearches, getTrashEntries, hasInitialized, markInitialized, readAutoBackup, removeAssetsForNote, removeAttachmentsForNote, removeAttachment, removeFolderFromDisk, removeNote, restoreArchivedAttachment, saveArchivedAttachment, saveAsset, saveAttachment, saveAttachmentMetadata, saveAttachmentTranscript as persistAttachmentTranscript, saveAutoBackup, saveFlashcards, saveFolderColors, saveFolders, saveNote, saveNoteTemplates, saveNoteVersion, saveNoteVersions, saveReviewSessions, saveSavedSearches, saveTrashEntries, storageLocationLabel, usesNativeFiles } from './storage'
import type { AutoBackupInfo } from './storage'
import type { Flashcard, Note, NoteAsset, NoteAttachment, NoteAttachmentReference, NoteTemplate, NoteVersion, ReviewSession, SavedSearch, TrashEntry } from './types'
import { readFeatureFlags, type FeatureFlags, type FeatureId } from './features'
import { dispatchAiReplaceSelection, dispatchWikiEmbedInsert, dispatchWikiLinkInsert, replaceWikiLinkTarget } from './wikiLinks'
import { fileFingerprint } from './fileFingerprint'
import { reviewFlashcard, type FlashcardGrade } from './flashcards'
import './App.css'

type Filter = 'all' | 'favorites' | string
type NoteDisplayMode = 'full' | 'names-tags' | 'names'
type EntryTarget = { kind: 'folder'; path: string } | { kind: 'note'; id: string }

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch { /* use the fallback when a plugin error is not serializable */ }
  }
  return fallback
}
type DeleteTarget = EntryTarget & { label: string; noteCount: number }
type EntryColor = { value: string; label: string }
type EntryPointerDrag = { target: EntryTarget; label: string; pointerId: number; startX: number; startY: number; started: boolean }
type EntryDragVisual = { target: EntryTarget; label: string; x: number; y: number; dropFolder: string | null }

const REVIEW_SESSIONS_OVERVIEW_ID = '__no_tie_review_sessions_overview__'
const SAVED_SEARCHES_PAGE_ID = '__no_tie_saved_searches_page__'
const NOTE_TEMPLATES_PAGE_ID = '__no_tie_note_templates_page__'
const RECENT_NOTES_PAGE_ID = '__no_tie_recent_notes_page__'
const FAVORITE_NOTES_PAGE_ID = '__no_tie_favorite_notes_page__'
const FLASHCARDS_PAGE_ID = '__no_tie_flashcards_page__'

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
  return { dataUrl: `data:${mimeType};base64,${btoa(binary)}`, contentHash: fileFingerprint(bytes) }
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const countEditorText = (text: string) => ({
  words: text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
  characters: Array.from(text).length,
})
const plainMarkdownTextForCounts = (markdown: string) => markdown
  .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
  .replace(/[*_~]/g, '')
  .replace(/\\([*_`])/g, '$1')

function hasMarkdownTablePipe(line: string) {
  return line.replace(/\\\|/g, '').includes('|')
}

function markdownTableCells(line: string) {
  const escapedPipe = '\uE000'
  const normalized = line.trim()
    .replace(/\\\|/g, escapedPipe)
    .replace(/\[\[[^\]]*\|[^\]]*\]\]/g, match => match.replace('|', escapedPipe))
    .replace(/^\|/, '')
    .replace(/\|$/, '')
  return normalized.split('|').map(cell => cell.replaceAll(escapedPipe, '|').trim())
}

function markdownTextForPreview(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const textLines: string[] = []
  let codeFenceCharacter = ''
  for (let index = 0; index < lines.length;) {
    const codeFence = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/)
    if (codeFence && (!codeFenceCharacter || codeFenceCharacter === codeFence[1][0])) {
      const character = codeFence[1][0]
      codeFenceCharacter = codeFenceCharacter ? '' : character
      index++
      continue
    }
    if (codeFenceCharacter) {
      textLines.push(lines[index++])
      continue
    }
    if (hasMarkdownTablePipe(lines[index]) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      textLines.push(markdownTableCells(lines[index]).join(' '))
      index += 2
      while (index < lines.length && hasMarkdownTablePipe(lines[index])) textLines.push(markdownTableCells(lines[index++]).join(' '))
      continue
    }
    textLines.push(lines[index++])
  }
  return textLines.join('\n').replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
}

function cleanLibraryTag(tag: string) {
  return tag.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').replace(/[|]/g, ' ').replace(/^#+\s*/, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim()
}

function excerpt(content: string) {
  return markdownTextForPreview(content)
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => raw.split('|', 2)[1]?.trim() || raw.split('|', 1)[0].trim())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:\/\/[^>]+|mailto:[^>]+)>/gi, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\([*_`])/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/[>*_~`$]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110)
}

function isMarkdownTableSeparator(line: string) {
  const cells = markdownTableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function markdownTextForCounts(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const documentLines: string[] = []
  const tableCells: string[] = []
  let insideCodeFence = false
  for (let index = 0; index < lines.length;) {
    if (/^\s{0,3}```/.test(lines[index])) {
      insideCodeFence = !insideCodeFence
      documentLines.push(lines[index++])
      continue
    }
    if (insideCodeFence) {
      documentLines.push(lines[index++])
      continue
    }
    if (hasMarkdownTablePipe(lines[index]) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      tableCells.push(...markdownTableCells(lines[index]))
      index += 2
      while (index < lines.length && hasMarkdownTablePipe(lines[index])) tableCells.push(...markdownTableCells(lines[index++]))
      continue
    }
    documentLines.push(lines[index++])
  }
  return {
    document: plainMarkdownTextForCounts(documentLines.join('\n')),
    tableCells: tableCells.map(plainMarkdownTextForCounts),
  }
}

function countMarkdownDocument(markdown: string) {
  const parts = markdownTextForCounts(markdown)
  const body = countEditorText(parts.document)
  return parts.tableCells.reduce((total, cell) => {
    const counts = countEditorText(cell)
    return { words: total.words + counts.words, characters: total.characters + counts.characters }
  }, body)
}
const attachmentBytesFromDataUrl = (dataUrl: string) => {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
const attachmentReference = (attachment: NoteAttachment): NoteAttachmentReference => ({
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  size: attachment.size,
  contentHash: attachment.contentHash ?? fileFingerprint(attachmentBytesFromDataUrl(attachment.dataUrl)),
})
const sameAttachmentReference = (attachment: NoteAttachment, reference: NoteAttachmentReference) => {
  const current = attachmentReference(attachment)
  return current.fileName === reference.fileName && current.mimeType === reference.mimeType && current.size === reference.size
    && (!reference.contentHash || current.contentHash === reference.contentHash)
}
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
  const [previewAttachmentId, setPreviewAttachmentId] = useState('')
  const [previewAttachmentPage, setPreviewAttachmentPage] = useState(1)
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [templates, setTemplates] = useState<NoteTemplate[]>(defaultTemplates)
  const [showDailyNotes, setShowDailyNotes] = useState(false)
  const [showTaskManager, setShowTaskManager] = useState(false)
  const [showAiEdit, setShowAiEdit] = useState(false)
  const [aiNoteTool, setAiNoteTool] = useState<AiNoteTool | null>(null)
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false)
  const [showDuplicateManager, setShowDuplicateManager] = useState(false)
  const [showAttachmentManager, setShowAttachmentManager] = useState(false)
  const [showNoteBoard, setShowNoteBoard] = useState(false)
  const [showProjectDashboard, setShowProjectDashboard] = useState(false)
  const [showNoteReminder, setShowNoteReminder] = useState(false)
  const [attachmentIndexing, setAttachmentIndexing] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(() => readFeatureFlags())
  const [showFeatureManager, setShowFeatureManager] = useState(false)
  const [showLockSetup, setShowLockSetup] = useState(false)
  const [hasLockPin, setHasLockPin] = useState(() => Boolean(localStorage.getItem('no-tie-app-lock-hash')))
  const [appLocked, setAppLocked] = useState(() => Boolean(localStorage.getItem('no-tie-app-lock-hash') && localStorage.getItem('no-tie-app-locked') === 'true'))
  const [selectedId, setSelectedId] = useState('')
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('no-tie-recent-note-ids') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 60) : [] } catch { return [] }
  })
  const [query, setQuery] = useState('')
  const [searchTag, setSearchTag] = useState('')
  const [searchFolder, setSearchFolder] = useState('')
  const [showSearchFilters, setShowSearchFilters] = useState(false)
  const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(() => localStorage.getItem('no-tie-semantic-search') === 'true')
  const [semanticScores, setSemanticScores] = useState<Record<string, number>>({})
  const [semanticSearchBusy, setSemanticSearchBusy] = useState(false)
  const [semanticSearchError, setSemanticSearchError] = useState('')
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([])
  const [bulkTargetFolder, setBulkTargetFolder] = useState('')
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [showQuickSearch, setShowQuickSearch] = useState(false)
  const [quickSearchActiveIndex, setQuickSearchActiveIndex] = useState(0)
  const [showNoteLinkDialog, setShowNoteLinkDialog] = useState(false)
  const [showNoteEmbedDialog, setShowNoteEmbedDialog] = useState(false)
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
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([])
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [autoBackups, setAutoBackups] = useState<AutoBackupInfo[]>([])
  const [showBackupTrash, setShowBackupTrash] = useState(false)
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const automaticBackupRunning = useRef(false)
  const [activeReviewSessionId, setActiveReviewSessionId] = useState('')
  const [showReviewSessionDialog, setShowReviewSessionDialog] = useState(false)
  const [editingReviewSessionId, setEditingReviewSessionId] = useState('')
  const [reviewClockNow, setReviewClockNow] = useState(() => Date.now())
  const [editorSelection, setEditorSelection] = useState({ noteId: '', mode: 'rendered' as 'rendered' | 'source', text: '' })
  const [entryDragVisual, setEntryDragVisual] = useState<EntryDragVisual | null>(null)
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const [toast, setToast] = useState('')
  const [showMainSidebar, setShowMainSidebar] = useState(() => localStorage.getItem('no-tie-main-sidebar-visible') !== 'false')
  const [showLibrary, setShowLibrary] = useState(() => localStorage.getItem('no-tie-library-visible') !== 'false')
  const [showChat, setShowChat] = useState(() => localStorage.getItem('no-tie-ollama-chat-open') === 'true')
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => localStorage.getItem('no-tie-ollama-url') || 'http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem('no-tie-ollama-model') || '')
  const [embeddingModel, setEmbeddingModel] = useState(() => localStorage.getItem('no-tie-embedding-model') || 'nomic-embed-text')
  const [showOllamaSettings, setShowOllamaSettings] = useState(false)
  const [ollamaDraftUrl, setOllamaDraftUrl] = useState('http://localhost:11434')
  const [ollamaDraftModel, setOllamaDraftModel] = useState('')
  const [embeddingDraftModel, setEmbeddingDraftModel] = useState(() => localStorage.getItem('no-tie-embedding-model') || 'nomic-embed-text')
  const [transcriptionUrl, setTranscriptionUrl] = useState(() => localStorage.getItem('no-tie-transcription-url') || 'http://localhost:8000/v1/audio/transcriptions')
  const [transcriptionDraftUrl, setTranscriptionDraftUrl] = useState(() => localStorage.getItem('no-tie-transcription-url') || 'http://localhost:8000/v1/audio/transcriptions')
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
    const detail = errorMessage(error, 'Spróbuj ponownie.')
    setToast(`Nie udało się zapisać zmian: ${detail}`)
    window.setTimeout(() => setToast(''), 5000)
  }

  useEffect(() => { localStorage.setItem('no-tie-feature-modules', JSON.stringify(featureFlags)) }, [featureFlags])

  function toggleFeature(id: FeatureId, enabled: boolean) {
    setFeatureFlags(current => ({ ...current, [id]: enabled }))
    if (id === 'bulkActions' && !enabled) { setBulkSelectMode(false); setBulkSelectedIds([]) }
    if (id === 'smartFolders' && !enabled && activeFilter.startsWith('smart:')) { setActiveFilter('all'); setQuery('') }
    if (!enabled) {
      if (id === 'duplicateManager') setShowDuplicateManager(false)
      if (id === 'attachmentManager') setShowAttachmentManager(false)
      if (id === 'noteBoard') setShowNoteBoard(false)
      if (id === 'projectDashboard') setShowProjectDashboard(false)
      if (id === 'noteReminders') setShowNoteReminder(false)
      if (id === 'audioNotes' && attachments.find(attachment => attachment.id === previewAttachmentId)?.mimeType.startsWith('audio/')) setPreviewAttachmentId('')
      if ((id === 'aiSummaries' && aiNoteTool === 'summary') || (id === 'aiTaskExtraction' && aiNoteTool === 'tasks') || (id === 'aiFlashcards' && (aiNoteTool === 'flashcards' || aiNoteTool === 'quiz'))) setAiNoteTool(null)
    }
    if (id === 'appLock') {
      if (!enabled) {
        localStorage.setItem('no-tie-app-locked', 'false')
        setAppLocked(false)
        setShowLockSetup(false)
      } else if (!hasLockPin) setShowLockSetup(true)
    }
  }

  async function configureAppLockPin(pin: string) {
    const salt = crypto.randomUUID()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`))
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('no-tie-app-lock-salt', salt)
    localStorage.setItem('no-tie-app-lock-hash', hash)
    localStorage.setItem('no-tie-app-locked', 'false')
    setHasLockPin(true)
    setAppLocked(false)
  }

  async function unlockApp(pin: string) {
    const salt = localStorage.getItem('no-tie-app-lock-salt')
    const expected = localStorage.getItem('no-tie-app-lock-hash')
    if (!salt || !expected) return false
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`))
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== expected) return false
    localStorage.setItem('no-tie-app-locked', 'false')
    setAppLocked(false)
    return true
  }

  function lockApp() {
    if (!featureFlags.appLock || !hasLockPin) return
    localStorage.setItem('no-tie-app-locked', 'true')
    setAppLocked(true)
  }

  useEffect(() => {
    if (!featureFlags.appLock || !hasLockPin || appLocked) return
    let timer = 0
    const armTimer = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lockApp, 5 * 60_000)
    }
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') lockApp(); else armTimer() }
    window.addEventListener('pointerdown', armTimer)
    window.addEventListener('keydown', armTimer)
    document.addEventListener('visibilitychange', onVisibilityChange)
    armTimer()
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', armTimer)
      window.removeEventListener('keydown', armTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [featureFlags.appLock, hasLockPin, appLocked])

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
        const storedTrash = await getTrashEntries()
        const storedFlashcards = await getFlashcards()
        const storedBackups = await getAutoBackups()
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
          setTrashEntries(storedTrash.filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000))
          setFlashcards(storedFlashcards.map(card => {
            const note = resolveWikiTarget(storedNotes, card.noteId)
            return note && note.id !== card.noteId ? { ...card, noteId: note.id } : card
          }))
          setAutoBackups(storedBackups)
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
          setLoadError(errorMessage(error, 'Nie udało się otworzyć plików notatek.'))
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
  useEffect(() => { if (ready) void saveFlashcards(flashcards).catch(reportDiskSaveError) }, [ready, flashcards])
  useEffect(() => { if (ready) void saveTrashEntries(trashEntries).catch(reportDiskSaveError) }, [ready, trashEntries])
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
  const showingReviewSessionsOverview = activeReviewSessionId === REVIEW_SESSIONS_OVERVIEW_ID
  const showingSavedSearchesPage = activeReviewSessionId === SAVED_SEARCHES_PAGE_ID
  const showingNoteTemplatesPage = activeReviewSessionId === NOTE_TEMPLATES_PAGE_ID
  const showingRecentNotesPage = activeReviewSessionId === RECENT_NOTES_PAGE_ID
  const showingFavoriteNotesPage = activeReviewSessionId === FAVORITE_NOTES_PAGE_ID
  const showingFlashcardsPage = activeReviewSessionId === FLASHCARDS_PAGE_ID
  const showingWorkspacePage = showingReviewSessionsOverview || showingSavedSearchesPage || showingNoteTemplatesPage || showingRecentNotesPage || showingFavoriteNotesPage || showingFlashcardsPage || Boolean(activeReviewSession)
  const activeSmartFolder = featureFlags.smartFolders && activeFilter.startsWith('smart:') ? savedSearches.find(search => search.id === activeFilter.slice('smart:'.length)) : undefined
  useEffect(() => {
    if (!selectedId || !notes.some(note => note.id === selectedId)) return
    setRecentNoteIds(current => {
      const next = [selectedId, ...current.filter(id => id !== selectedId)].slice(0, 60)
      if (JSON.stringify(next) === JSON.stringify(current)) return current
      localStorage.setItem('no-tie-recent-note-ids', JSON.stringify(next))
      return next
    })
  }, [selectedId, notes])
  const notesRef = useRef<Note[]>([])
  const backupSnapshotRef = useRef({ notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, trashEntries })
  useLayoutEffect(() => {
    notesRef.current = notes
    backupSnapshotRef.current = { notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, trashEntries }
  }, [notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, trashEntries])
  useLayoutEffect(() => {
    const note = notesRef.current.find(item => item.id === selectedId)
    if (!note) return
    historyNoteId.current = note.id
    noteHistory.current = [copyNote(note)]
    noteRedoHistory.current = []
  }, [selectedId])
  const tagOptions = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort((a, b) => a.localeCompare(b, 'pl')), [notes])
  const searchResults = useMemo(() => searchNotes(notes, { query: semanticSearchEnabled && featureFlags.semanticSearch ? '' : query, tag: searchTag, folder: searchFolder, attachments: attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined }), advanced: featureFlags.advancedQuery }), [notes, attachments, query, searchTag, searchFolder, semanticSearchEnabled, featureFlags.semanticSearch, featureFlags.audioNotes, featureFlags.attachmentIndex, featureFlags.advancedQuery])
  useEffect(() => {
    if (!featureFlags.semanticSearch || !semanticSearchEnabled || !query.trim()) {
      setSemanticScores({})
      setSemanticSearchError('')
      setSemanticSearchBusy(false)
      return
    }
    let cancelled = false
    setSemanticSearchBusy(true)
    setSemanticSearchError('')
    const timer = window.setTimeout(() => {
      const visibleAttachments = attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })
      const documents = notes.map(note => {
        const noteAttachments = visibleAttachments.filter(attachment => attachment.noteId === note.id)
        return `${note.title}\n${note.folder}\n${note.tags.join(' ')}\n${note.content}\n${noteAttachments.map(attachment => `${attachment.fileName}\n${attachment.transcript ?? ''}\n${attachment.extractedText ?? ''}`).join('\n')}`.slice(0, 6000)
      })
      void embedOllamaTexts(ollamaBaseUrl, embeddingModel, [query, ...documents]).then(vectors => {
        if (cancelled) return
        const queryVector = vectors[0]
        if (!queryVector) throw new Error('Model nie zwrócił embeddingu zapytania.')
        const cosine = (left: number[], right: number[]) => {
          let dot = 0; let leftNorm = 0; let rightNorm = 0
          for (let index = 0; index < Math.min(left.length, right.length); index += 1) { dot += left[index]! * right[index]!; leftNorm += left[index]! ** 2; rightNorm += right[index]! ** 2 }
          return dot / (Math.sqrt(leftNorm * rightNorm) || 1)
        }
        const scores = Object.fromEntries(notes.map((note, index) => [note.id, cosine(queryVector, vectors[index + 1] ?? [])]))
        setSemanticScores(scores)
        setSemanticSearchBusy(false)
      }).catch(error => {
        if (cancelled) return
        const detail = error instanceof Error ? error.message : 'Nie udało się obliczyć podobieństwa.'
        setSemanticSearchError(/model.*not found|model.*nie znaleziono/i.test(detail) ? 'Pobierz model embeddingów poleceniem: ollama pull nomic-embed-text' : detail)
        setSemanticSearchBusy(false)
      })
    }, 450)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [featureFlags.semanticSearch, featureFlags.audioNotes, featureFlags.attachmentIndex, semanticSearchEnabled, query, notes, attachments, ollamaBaseUrl, embeddingModel])
  const semanticResults = useMemo(() => {
    if (!featureFlags.semanticSearch || !semanticSearchEnabled || !Object.keys(semanticScores).length) return searchResults
    const order = new Map(Object.entries(semanticScores).sort((a, b) => b[1] - a[1]).map(([id], index) => [id, index]))
    return notes.filter(note => {
      if (searchTag && !note.tags.some(tag => tag.toLocaleLowerCase('pl') === searchTag.toLocaleLowerCase('pl'))) return false
      if (searchFolder === '__root__' && note.folder) return false
      if (searchFolder && searchFolder !== '__root__' && note.folder !== searchFolder && !note.folder.startsWith(`${searchFolder}/`)) return false
      return (semanticScores[note.id] ?? -1) >= .12
    }).sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }, [featureFlags.semanticSearch, semanticSearchEnabled, semanticScores, searchResults, notes, searchTag, searchFolder])
  const smartFolderResults = useMemo(() => activeSmartFolder ? searchNotes(notes, { query: activeSmartFolder.query, tag: activeSmartFolder.tag, folder: activeSmartFolder.folder, attachments: attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined }), advanced: featureFlags.advancedQuery }) : undefined, [activeSmartFolder, notes, attachments, featureFlags.advancedQuery, featureFlags.audioNotes, featureFlags.attachmentIndex])
  const visibleNotes = useMemo(() => {
    return (smartFolderResults ?? semanticResults).filter(note => {
      if (activeSmartFolder) return true
      if (activeFilter === 'favorites' && !note.favorite) return false
      if (activeFilter === 'root' && note.folder) return false
      if (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' && !activeFilter.startsWith('smart:') && note.folder !== activeFilter && !note.folder.startsWith(`${activeFilter}/`)) return false
      return true
    })
  }, [semanticResults, smartFolderResults, activeFilter, activeSmartFolder])
  const currentAssets = assets.filter(asset => asset.noteId === selectedId)
  const currentAttachments = attachments.filter(attachment => attachment.noteId === selectedId)
  const currentAttachmentsForUi = featureFlags.audioNotes ? currentAttachments : currentAttachments.filter(attachment => !attachment.mimeType.startsWith('audio/'))
  const parsedTasks = useMemo(() => parseTasks(notes), [notes])
  useEffect(() => {
    const notifyDueTasks = () => {
      const now = new Date()
      const localMinute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      parsedTasks.filter(task => !task.done && task.remindAt && task.remindAt <= localMinute).forEach(task => {
        const key = `no-tie-reminder:${task.id}:${task.remindAt}`
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, '1')
        if ('Notification' in window && Notification.permission === 'granted') new Notification(`Przypomnienie: ${task.text}`, { body: task.noteTitle || 'No-Tie' })
        else {
          setToast(`Przypomnienie: ${task.text}`)
          window.setTimeout(() => setToast(''), 5000)
        }
      })
    }
    notifyDueTasks()
    const timer = window.setInterval(notifyDueTasks, 30_000)
    return () => window.clearInterval(timer)
  }, [parsedTasks])
  useEffect(() => {
    if (!featureFlags.noteReminders) return
    const notifyNoteReminders = () => {
      const now = Date.now()
      notes.forEach(note => {
        const remindAt = note.properties?.['no-tie-remind-at']
        const dueAt = remindAt ? new Date(remindAt).getTime() : Number.NaN
        if (!remindAt || !Number.isFinite(dueAt) || dueAt > now) return
        const key = `no-tie-note-reminder:${note.id}:${remindAt}`
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, '1')
        if ('Notification' in window && Notification.permission === 'granted') new Notification(`Przypomnienie: ${note.title || 'Notatka'}`, { body: 'Otwórz No-Tie, aby wrócić do tej notatki.' })
        else {
          setToast(`Przypomnienie: ${note.title || 'Notatka'}`)
          window.setTimeout(() => setToast(''), 5000)
        }
      })
    }
    notifyNoteReminders()
    const timer = window.setInterval(notifyNoteReminders, 30_000)
    return () => window.clearInterval(timer)
  }, [featureFlags.noteReminders, notes])
  const documentCounts = selectedNote ? countMarkdownDocument(selectedNote.content) : { words: 0, characters: 0 }
  const selectionText = selectedNote && editorSelection.noteId === selectedNote.id && editorSelection.mode === editorMode ? editorSelection.text : ''
  const selectionCounts = countEditorText(selectionText)
  const markdownNoteActions = [
    { id: 'link', label: 'Połącz notatkę' },
    { id: 'embed', label: 'Osadź notatkę' },
    { id: 'edit-ai', label: 'Edytuj zaznaczenie z AI', disabled: !selectionText || !ollamaModel },
    ...(featureFlags.aiSummaries ? [{ id: 'summary', label: 'Podsumuj i stwórz konspekt' }] : []),
    ...(featureFlags.aiTaskExtraction ? [{ id: 'tasks', label: 'Wydobądź zadania' }] : []),
    ...(featureFlags.aiFlashcards ? [{ id: 'flashcards', label: 'Stwórz fiszki' }, { id: 'quiz', label: 'Stwórz quiz' }] : []),
  ]

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

  function patchNote(id: string, patch: Partial<Note>, recordPersistentHistory = true) {
    const existing = notes.find(note => note.id === id)
    if (existing && Object.entries(patch).every(([key, value]) => JSON.stringify(existing[key as keyof Note]) === JSON.stringify(value))) return
    setSaved(false)
    const updatedAt = currentTimestamp()
    const updated = existing ? { ...existing, ...patch, updatedAt } : undefined
    if (existing && updated && recordPersistentHistory) scheduleNoteVersion(updated, existing)
    setNotes(current => current.map(note => {
      if (note.id !== id) return note
      const next = { ...note, ...patch, updatedAt }
      if (id === selectedId) recordNoteHistory(next)
      return next
    }))
  }

  function setNoteReminder(noteId: string, value: string) {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    const properties = { ...(note.properties ?? {}) }
    if (value) properties['no-tie-remind-at'] = value
    else delete properties['no-tie-remind-at']
    patchNote(noteId, { properties })
  }

  function setNoteWorkflowStatus(noteId: string, status: NoteWorkflowStatus) {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    patchNote(noteId, { properties: { ...(note.properties ?? {}), 'no-tie-status': status } })
  }

  function updateSelectedNotesBulk(update: (note: Note) => Note) {
    const selected = new Set(bulkSelectedIds)
    const updatedAt = currentTimestamp()
    for (const note of notes) {
      if (!selected.has(note.id)) continue
      const next = { ...update(note), updatedAt }
      scheduleNoteVersion(next, note)
      if (note.id === selectedId) recordNoteHistory(next)
    }
    setSaved(false)
    setNotes(current => current.map(note => selected.has(note.id) ? { ...update(note), updatedAt } : note))
  }

  function moveSelectedNotesBulk() {
    if (!bulkSelectedIds.length) return
    updateSelectedNotesBulk(note => ({ ...note, folder: bulkTargetFolder }))
    if (bulkTargetFolder) setFolderRegistry(current => [...new Set([...current, ...folderParents(bulkTargetFolder)])])
    setBulkSelectedIds([])
    setBulkSelectMode(false)
  }

  function applyBulkTag() {
    const value = bulkTagDraft.trim()
    if (!value || !bulkSelectedIds.length) return
    const allHaveTag = notes.filter(note => bulkSelectedIds.includes(note.id)).every(note => note.tags.some(tag => tag.toLocaleLowerCase('pl') === value.toLocaleLowerCase('pl')))
    updateSelectedNotesBulk(note => ({ ...note, tags: allHaveTag ? note.tags.filter(tag => tag.toLocaleLowerCase('pl') !== value.toLocaleLowerCase('pl')) : [...new Set([...note.tags, value])] }))
    setBulkTagDraft('')
  }

  async function deleteSelectedNotesBulk() {
    const ids = new Set(bulkSelectedIds)
    if (!ids.size) return
    try {
      const nextTrash = [...trashNoteData(ids), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
      await saveTrashEntries(nextTrash)
      await Promise.all([...ids].map(async id => { await removeAssetsForNote(id); await removeAttachmentsForNote(id); await removeNote(id) }))
      setTrashEntries(nextTrash)
      setAssets(current => current.filter(asset => !ids.has(asset.noteId)))
      setAttachments(current => current.filter(attachment => !ids.has(attachment.noteId)))
      setFlashcards(current => current.filter(card => !ids.has(card.noteId)))
      setNotes(current => current.filter(note => !ids.has(note.id)))
      removeNotesFromReviewSessions(ids)
      if (ids.has(selectedId)) selectNote(notes.find(note => !ids.has(note.id))?.id ?? '')
      setBulkSelectedIds([])
      setBulkSelectMode(false)
      setToast(`Przeniesiono ${ids.size} notatek do kosza`)
    } catch (error) { setToast(errorMessage(error, 'Nie udało się przenieść notatek do kosza.')) }
    window.setTimeout(() => setToast(''), 3500)
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
    const note = resolveWikiTarget(notes, target)
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
    setShowLibrary(true)
    localStorage.setItem('no-tie-library-visible', 'true')
    setMobileDrawer('none')
  }

  function updateTask(task: ParsedTask, patch: TaskPatch) {
    const note = notes.find(item => item.id === task.noteId)
    if (!note) return
    const completing = patch.done === true || patch.status === 'done'
    const blocker = completing && task.dependency ? parsedTasks.find(item => item.id === task.dependency && !item.done) : undefined
    if (blocker) {
      setToast(`Najpierw ukończ zadanie: ${blocker.text}`)
      window.setTimeout(() => setToast(''), 3000)
      return
    }
    let content = updateTaskLine(note.content, task, patch)
    if (completing && !task.done && task.repeat) {
      const nextDate = nextTaskDate(task.dueDate, task.repeat)
      const repeatId = crypto.randomUUID()
      const reminderTime = task.remindAt ? task.remindAt.slice(11, 16) : ''
      const nextReminder = reminderTime ? ` remind=${encodeURIComponent(`${nextDate}T${reminderTime}`)}` : ''
      content += `${content.endsWith('\n') ? '' : '\n'}- [ ] ${task.text} <!-- no-tie-task id=${repeatId} due=${nextDate} priority=${task.priority} repeat=${task.repeat}${nextReminder} -->\n`
    }
    patchNote(note.id, { content })
  }

  function createTask(noteId: string, title: string, dueDate: string, priority: ParsedTask['priority'], repeat: ParsedTask['repeat'] = '', remindAt = '', dependency = '') {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    const fields = [`id=${crypto.randomUUID()}`, dueDate ? `due=${dueDate}` : '', priority !== 'normal' ? `priority=${priority}` : '', repeat ? `repeat=${repeat}` : '', remindAt ? `remind=${encodeURIComponent(remindAt)}` : '', dependency ? `depends=${encodeURIComponent(dependency)}` : ''].filter(Boolean)
    const metadata = ` <!-- no-tie-task ${fields.join(' ')} -->`
    const separator = note.content.endsWith('\n') ? '' : '\n'
    patchNote(noteId, { content: `${note.content}${separator}- [ ] ${title}${metadata}\n` })
  }

  async function addAttachments(files: File[]): Promise<NoteAttachment[]> {
    if (!selectedNote) return []
    const note = selectedNote
    await saveNoteVersion(note)
    const additions: NoteAttachment[] = []
    const usedNames = new Set([...attachments.filter(attachment => attachment.noteId === note.id), ...assets.filter(asset => asset.noteId === note.id)].map(item => item.fileName.toLocaleLowerCase('pl')))
    let content = note.content
    for (const file of files) {
      const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
      const mimeType = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', '3gp': 'audio/3gpp', amr: 'audio/amr' } as Record<string, string>)[extension] || ''
      if (!mimeType || (file.type && file.type !== mimeType && !file.type.startsWith(`${mimeType};`))) { setToast(`Typ pliku „${file.name}” nie jest obsługiwany.`); window.setTimeout(() => setToast(''), 3000); continue }
      if (file.size > 15 * 1024 * 1024) { setToast(`Plik „${file.name}” przekracza limit 15 MB.`); window.setTimeout(() => setToast(''), 3000); continue }
      const fileName = uniqueAttachmentName(safeAttachmentName(file.name), usedNames)
      const payload = await dataUrlFromFile(file, mimeType)
      const attachment: NoteAttachment = { id: `${note.id}:${crypto.randomUUID()}`, noteId: note.id, fileName, mimeType, ...payload, size: file.size }
      await saveAttachment(attachment)
      additions.push(attachment)
      if (mimeType.startsWith('image/')) content += `\n\n![${fileName}](./assets/${encodeURIComponent(fileName)})`
    }
    if (additions.length) {
      setAttachments(current => [...current, ...additions])
      patchNote(note.id, { content }, false)
      await saveNoteVersion({ ...note, content, updatedAt: currentTimestamp() })
      setEditorRevision(value => value + 1)
      setToast(`Dodano ${additions.length} ${additions.length === 1 ? 'załącznik' : 'załączniki'}.`)
      window.setTimeout(() => setToast(''), 2500)
    }
    return additions
  }

  function insertTextIntoNote(text: string) {
    if (!selectedNote || !text.trim()) return
    const separator = selectedNote.content.endsWith('\n') ? '\n' : '\n\n'
    patchNote(selectedNote.id, { content: `${selectedNote.content}${separator}${text.trim()}\n` })
    setEditorRevision(value => value + 1)
  }

  function saveAttachmentTranscript(attachment: NoteAttachment, transcript: string) {
    const updated = { ...attachment, transcript }
    setAttachments(current => current.some(item => item.id === attachment.id)
      ? current.map(item => item.id === attachment.id ? updated : item)
      : [...current, updated])
    void persistAttachmentTranscript(updated, transcript).catch(reportDiskSaveError)
  }

  function savePdfAnnotations(attachment: NoteAttachment, pdfAnnotations: NonNullable<NoteAttachment['pdfAnnotations']>) {
    const updated = { ...attachment, pdfAnnotations }
    setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
    void saveAttachmentMetadata(updated, { pdfAnnotations }).catch(reportDiskSaveError)
  }

  async function transcribeAudioAttachment(attachment: NoteAttachment): Promise<string> {
    if (!featureFlags.audioNotes) throw new Error('Moduł notatek audio jest wyłączony.')
    const endpoint = transcriptionUrl.trim()
    if (!endpoint) throw new Error('Ustaw lokalny adres usługi transkrypcji w ustawieniach Ollama.')
    const payload = await transcribeLocalAudio(endpoint, attachment.fileName, attachment.mimeType, attachment.dataUrl)
    if (!payload || typeof payload !== 'object') throw new Error('Usługa transkrypcji zwróciła nieprawidłową odpowiedź.')
    const result = payload as { text?: unknown; segments?: unknown }
    const transcript = typeof result.text === 'string' ? result.text.trim() : ''
    if (!transcript) throw new Error('Nie rozpoznano mowy w tym nagraniu.')
    const transcriptSegments = Array.isArray(result.segments) ? result.segments.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return []
      const segment = entry as Record<string, unknown>
      const text = typeof segment.text === 'string' ? segment.text.trim() : ''
      if (!text) return []
      const start = typeof segment.start === 'number' ? segment.start : index
      const end = typeof segment.end === 'number' ? segment.end : undefined
      const speakerValue = segment.speaker_id ?? segment.speaker
      const speaker = typeof speakerValue === 'number' ? `Mówca ${speakerValue + 1}` : typeof speakerValue === 'string' ? `Mówca ${speakerValue.replace(/^speaker[_ -]?/i, '')}` : undefined
      return [{ startMs: Math.max(0, Math.round(start * 1000)), endMs: end === undefined ? undefined : Math.max(0, Math.round(end * 1000)), text, speaker }]
    }) : []
    const updated = { ...attachment, transcript, transcriptSegments: transcriptSegments.length ? transcriptSegments : undefined }
    setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
    await persistAttachmentTranscript(updated, transcript)
    await saveAttachmentMetadata(updated, { transcriptSegments: updated.transcriptSegments })
    return transcript
  }

  function openCitation(noteTitle: string, fileName?: string, page?: number, folder?: string) {
    const expectedFolder = folder?.trim().toLocaleLowerCase('pl') === 'bez folderu' ? '' : folder?.trim().toLocaleLowerCase('pl')
    const note = notes.find(item => item.title.trim().toLocaleLowerCase('pl') === noteTitle.trim().toLocaleLowerCase('pl') && (!expectedFolder || item.folder.trim().toLocaleLowerCase('pl') === expectedFolder))
    if (!note) {
      setToast(`Nie znaleziono źródła „${noteTitle}”.`)
      window.setTimeout(() => setToast(''), 3000)
      return
    }
    openLinkedNote(note.id)
    const attachment = attachments.find(item => item.noteId === note.id && item.fileName.toLocaleLowerCase('pl') === fileName?.trim().toLocaleLowerCase('pl'))
    if (attachment && (!attachment.mimeType.startsWith('audio/') || featureFlags.audioNotes)) {
      setPreviewAttachmentPage(page || 1)
      setPreviewAttachmentId(attachment.id)
    }
  }

  function appendAiTextToNote(value: string, kind: AiNoteTool) {
    if (!selectedNote) return
    const heading = kind === 'summary' ? 'Podsumowanie AI' : kind === 'tasks' ? 'Zadania z AI' : 'Quiz AI'
    const separator = selectedNote.content.trimEnd() ? '\n\n' : ''
    const content = `${selectedNote.content.trimEnd()}${separator}## ${heading}\n\n${value.trim()}\n`
    patchNote(selectedNote.id, { content })
    setEditorRevision(revision => revision + 1)
    setToast(kind === 'summary' ? 'Dodano podsumowanie do notatki.' : kind === 'tasks' ? 'Dodano zadania do notatki.' : 'Dodano quiz do notatki.')
    window.setTimeout(() => setToast(''), 3000)
  }

  function insertAttachmentLink(attachment: NoteAttachment) {
    insertTextIntoNote(`[${attachment.fileName}](./assets/${encodeURIComponent(attachment.fileName)})`)
  }

  function openAttachment(fileName: string) {
    const attachment = attachments.find(item => item.noteId === selectedId && item.fileName === fileName)
    if (attachment && (!attachment.mimeType.startsWith('audio/') || featureFlags.audioNotes)) setPreviewAttachmentId(attachment.id)
  }

  async function recognizeAttachmentText(attachment: NoteAttachment): Promise<string> {
    if (!ollamaModel.trim()) throw new Error('Ustaw model obsługujący obrazy w ustawieniach Ollama.')
    if (attachment.mimeType === 'application/pdf') {
      const { pdfAttachmentToVisionPages } = await import('./pdfVision')
      let pageStart = 1
      let pageCount = 0
      const sections: string[] = []
      while (true) {
        const pdf = await pdfAttachmentToVisionPages(attachment.dataUrl, 8, pageStart)
        if (!pdf.pages.length) break
        let batchResult = ''
        const firstPage = pdf.pages[0]!.pageNumber
        const lastPage = pdf.pages.at(-1)!.pageNumber
        await streamOllamaMessage(ollamaBaseUrl, ollamaModel, [{ role: 'user', content: `Odczytaj dokładnie cały widoczny tekst z załączonych stron PDF ${firstPage}–${lastPage} z ${pdf.totalPages}. Zachowaj kolejność, podziały na akapity i tabelaryczny układ w Markdown. Zwróć wyłącznie rozpoznany tekst.`, images: pdf.pages.map(page => page.base64) }], chunk => { batchResult += chunk })
        sections.push(batchResult.trim())
        pageCount = pdf.totalPages
        pageStart = lastPage + 1
      }
      if (!pageCount) throw new Error('Nie udało się wczytać stron dokumentu.')
      const text = sections.filter(Boolean).join('\n\n')
      if (!text) throw new Error('Model nie rozpoznał tekstu.')
      return text
    }
    const images = [await imageAttachmentToPngBase64(attachment.dataUrl)]
    let result = ''
    await streamOllamaMessage(ollamaBaseUrl, ollamaModel, [{ role: 'user', content: 'Odczytaj dokładnie cały widoczny tekst z załączonego obrazu. Zachowaj kolejność, podziały na akapity i tabelaryczny układ w Markdown. Zwróć wyłącznie rozpoznany tekst.', images }], chunk => { result += chunk })
    if (!result.trim()) throw new Error('Model nie rozpoznał tekstu.')
    return result.trim()
  }

  async function indexAttachment(attachment: NoteAttachment) {
    setAttachmentIndexing(attachment.id)
    try {
      const extractedText = await recognizeAttachmentText(attachment)
      const updated = { ...attachment, extractedText }
      await saveAttachmentMetadata(updated, { extractedText })
      setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
      setToast(`Zaindeksowano tekst: ${attachment.fileName}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nie udało się zaindeksować załącznika.')
    } finally {
      setAttachmentIndexing('')
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  async function mergeDuplicateNotes(targetId: string, sourceId: string) {
    if (targetId === sourceId) return
    const target = notes.find(note => note.id === targetId)
    const source = notes.find(note => note.id === sourceId)
    if (!target || !source) return
    const sourceAssets = assets.filter(asset => asset.noteId === sourceId)
    const sourceAttachments = attachments.filter(attachment => attachment.noteId === sourceId)
    const usedNames = new Set([...assets.filter(asset => asset.noteId === targetId), ...attachments.filter(attachment => attachment.noteId === targetId)].map(item => item.fileName.toLocaleLowerCase('pl')))
    const renamedAssets = sourceAssets.map(asset => {
      const fileName = uniqueAttachmentName(asset.fileName, usedNames)
      return { ...asset, id: `${targetId}:${fileName}`, noteId: targetId, fileName }
    })
    const renamedAttachments = sourceAttachments.map(attachment => {
      const fileName = uniqueAttachmentName(attachment.fileName, usedNames)
      return { ...attachment, id: `${targetId}:${fileName}`, noteId: targetId, fileName }
    })
    const remappedNames = new Map<string, string>()
    sourceAssets.forEach((asset, index) => remappedNames.set(asset.fileName, renamedAssets[index]!.fileName))
    sourceAttachments.forEach((attachment, index) => remappedNames.set(attachment.fileName, renamedAttachments[index]!.fileName))
    let sourceContent = source.content
    for (const [oldName, newName] of remappedNames) {
      sourceContent = sourceContent.replaceAll(`./assets/${encodeURIComponent(oldName)}`, `./assets/${encodeURIComponent(newName)}`).replaceAll(`./assets/${oldName}`, `./assets/${encodeURIComponent(newName)}`)
    }
    const divider = target.content.trim() ? '\n\n' : ''
    const merged: Note = { ...target, content: `${target.content.trimEnd()}${divider}## Połączono z: ${source.title || 'Bez tytułu'}\n\n${sourceContent}`.trim(), aliases: [...new Set([...(target.aliases ?? []), source.title, ...(source.aliases ?? [])].filter(Boolean))], updatedAt: currentTimestamp() }
    try {
      await saveNote(merged)
      await Promise.all(renamedAssets.map(saveAsset))
      await Promise.all(renamedAttachments.map(saveAttachment))
      await saveNoteVersion(merged)
      const nextTrash = [...trashNoteData(new Set([sourceId])), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
      await saveTrashEntries(nextTrash)
      await removeAssetsForNote(sourceId)
      await removeAttachmentsForNote(sourceId)
      await removeNote(sourceId)
      setTrashEntries(nextTrash)
      setAssets(current => [...current.filter(asset => asset.noteId !== sourceId), ...renamedAssets])
      setAttachments(current => [...current.filter(attachment => attachment.noteId !== sourceId), ...renamedAttachments])
      setFlashcards(current => current.map(card => card.noteId === sourceId ? { ...card, noteId: targetId } : card))
      setNotes(current => current.filter(note => note.id !== sourceId).map(note => note.id === targetId ? merged : note))
      if (selectedId === targetId) { recordNoteHistory(merged); setEditorRevision(value => value + 1) }
      removeNotesFromReviewSessions(new Set([sourceId]))
      setToast(`Scalono „${source.title || 'Bez tytułu'}” z „${target.title || 'Bez tytułu'}”`)
    } catch (error) { setToast(errorMessage(error, 'Nie udało się scalić notatek.')) }
    window.setTimeout(() => setToast(''), 4000)
  }

  function exportCurrentAsHtml(renderedReady = false) {
    if (!selectedNote) return
    if (!renderedReady && editorMode === 'source') {
      setEditorMode('rendered')
      const deadline = Date.now() + 3000
      const waitForEditor = () => {
        if (document.querySelector('.note-editor .markdown-editor .milkdown') || Date.now() >= deadline) {
          exportCurrentAsHtml(true)
          setEditorMode('source')
        } else window.setTimeout(waitForEditor, 50)
      }
      window.setTimeout(waitForEditor, 50)
      return
    }
    const safeTitle = selectedNote.title.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
    const rendered = document.querySelector('.note-editor .markdown-editor .milkdown')
    let body = rendered?.innerHTML ?? `<pre>${selectedNote.content.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)}</pre>`
    const template = document.createElement('template')
    template.innerHTML = body
    template.content.querySelectorAll('script, iframe, object, embed').forEach(node => node.remove())
    template.content.querySelectorAll('*').forEach(element => {
      for (const attribute of [...element.attributes]) if (attribute.name.toLowerCase().startsWith('on') || /javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name)
    })
    body = template.innerHTML
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{max-width:850px;margin:48px auto;padding:0 24px;color:#273047;font:16px/1.7 system-ui,sans-serif}h1,h2,h3{line-height:1.25}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9deea;padding:7px 10px}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #8391df;color:#626d83}pre{overflow:auto;padding:12px;background:#f4f5f8;border-radius:8px}code{font-family:ui-monospace,monospace}.note-embed-card{margin:18px 0;border-left:3px solid #7586df;padding:8px 14px;background:#fafbff}.note-embed-card header{font-weight:bold;color:#596998}.note-embed-card pre{white-space:pre-wrap}</style></head><body><h1>${safeTitle}</h1>${body}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${safeAttachmentName(selectedNote.title || 'notatka')}.html`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function exportCurrentAsPdf() {
    if (!selectedNote) return
    const previousTitle = document.title
    document.title = selectedNote.title || 'Notatka'
    const print = () => {
      let restored = false
      const restore = () => {
        if (restored) return
        restored = true
        document.title = previousTitle
        if (editorMode === 'source') setEditorMode('source')
      }
      window.addEventListener('afterprint', restore, { once: true })
      window.print()
      window.setTimeout(restore, 3000)
    }
    if (editorMode === 'source') {
      setEditorMode('rendered')
      const deadline = Date.now() + 3000
      const waitForEditor = () => document.querySelector('.note-editor .markdown-editor .milkdown') || Date.now() >= deadline
        ? print()
        : window.setTimeout(waitForEditor, 50)
      window.setTimeout(waitForEditor, 50)
    } else print()
  }

  async function deleteAttachment(attachment: NoteAttachment) {
    const note = notes.find(item => item.id === attachment.noteId)
    if (note) await saveNoteVersion(note)
    await archiveAttachment(attachment)
    await removeAttachment(attachment)
    setAttachments(current => current.filter(item => item.id !== attachment.id))
    let content = note?.content
    if (note) {
      const paths = [...new Set([`./assets/${attachment.fileName}`, `./assets/${encodeURIComponent(attachment.fileName)}`])].map(escapeRegExp)
      content = paths.reduce((value, path) => value.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${path}(?:\\s+"[^"]*")?\\)`, 'g'), ''), note.content).replace(/\n{3,}/g, '\n\n')
      if (content !== note.content) patchNote(note.id, { content }, false)
      await saveNoteVersion({ ...note, content, updatedAt: currentTimestamp() })
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

  async function restoreNoteVersion(version: NoteVersion, fields: ('content' | 'title' | 'folder' | 'tags' | 'aliases' | 'properties')[] = ['content', 'title', 'folder', 'tags', 'aliases', 'properties']) {
    if (!selectedNote || selectedNote.id !== version.noteId) return
    const snapshot = version.note
    await saveNoteVersion(selectedNote)
    if (!fields.includes('content')) {
      const restoredNote = {
        ...selectedNote,
        ...(fields.includes('title') ? { title: snapshot.title } : {}),
        ...(fields.includes('folder') ? { folder: snapshot.folder } : {}),
        ...(fields.includes('tags') ? { tags: [...snapshot.tags] } : {}),
        ...(fields.includes('aliases') ? { aliases: [...(snapshot.aliases ?? [])] } : {}),
        ...(fields.includes('properties') ? { properties: { ...(snapshot.properties ?? {}) } } : {}),
        updatedAt: currentTimestamp(),
      }
      patchNote(selectedNote.id, restoredNote, false)
      await saveNoteVersion(restoredNote)
      setToast('Przywrócono wybrane właściwości notatki.')
      window.setTimeout(() => setToast(''), 2800)
      return
    }
    const currentAttachments = attachments.filter(attachment => attachment.noteId === version.noteId)
    const historicalAttachments = await getAttachmentHistory(version.noteId)
    const legacyNames = version.attachments === undefined
      ? [...snapshot.content.matchAll(/\]\(\.\/assets\/([^\s)]+)\)/g)].map(match => match[1]).filter(fileName => !fileName.toLowerCase().endsWith('.svg'))
      : []
    const references = version.attachments ?? [...new Map(legacyNames.flatMap(fileName => {
      const attachment = currentAttachments.find(item => item.fileName === fileName)
        ?? historicalAttachments.find(item => item.fileName === fileName)
      return attachment ? [[attachment.fileName, attachmentReference(attachment)]] : []
    })).values()]
    const missingFileNames = new Set<string>()
    let restoredAttachments = [...currentAttachments]

    if (version.attachments !== undefined) {
      const keep = currentAttachments.filter(attachment => references.some(reference => sameAttachmentReference(attachment, reference)))
      const remove = currentAttachments.filter(attachment => !keep.includes(attachment))
      for (const attachment of remove) {
        await archiveAttachment(attachment)
        await removeAttachment(attachment)
      }
      restoredAttachments = keep
    }

    for (const reference of references) {
      if (restoredAttachments.some(attachment => sameAttachmentReference(attachment, reference))) continue
      const restored = await restoreArchivedAttachment(version.noteId, reference)
      if (restored) restoredAttachments.push(restored)
      else missingFileNames.add(reference.fileName)
    }

    for (const fileName of legacyNames) {
      if (restoredAttachments.some(attachment => attachment.fileName === fileName)) continue
      const archived = historicalAttachments.find(attachment => attachment.fileName === fileName)
      if (!archived) { missingFileNames.add(fileName); continue }
      const restored = await restoreArchivedAttachment(version.noteId, attachmentReference(archived))
      if (restored) restoredAttachments.push(restored)
      else missingFileNames.add(fileName)
    }

    if (version.attachments !== undefined) {
      const keepIds = new Set(restoredAttachments.map(attachment => attachment.id))
      setAttachments(current => [...current.filter(attachment => attachment.noteId !== version.noteId), ...restoredAttachments.filter(attachment => keepIds.has(attachment.id))])
    } else if (restoredAttachments.length !== currentAttachments.length) {
      const restoredIds = new Set(restoredAttachments.map(attachment => attachment.id))
      setAttachments(current => [...current.filter(attachment => attachment.noteId !== version.noteId), ...restoredAttachments.filter(attachment => restoredIds.has(attachment.id))])
    }

    let restoredContent = snapshot.content
    for (const fileName of missingFileNames) {
      const path = escapeRegExp(`./assets/${fileName}`)
      restoredContent = restoredContent.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${path}\\)`, 'g'), '')
    }
    const restoredNote = {
      ...selectedNote,
      title: fields.includes('title') ? snapshot.title : selectedNote.title,
      content: restoredContent,
      folder: fields.includes('folder') ? snapshot.folder : selectedNote.folder,
      color: selectedNote.color,
      tags: fields.includes('tags') ? [...snapshot.tags] : selectedNote.tags,
      aliases: fields.includes('aliases') ? [...(snapshot.aliases ?? [])] : selectedNote.aliases,
      properties: fields.includes('properties') ? { ...(snapshot.properties ?? {}) } : selectedNote.properties,
      favorite: selectedNote.favorite,
      updatedAt: currentTimestamp(),
    }
    patchNote(selectedNote.id, restoredNote, false)
    await saveNoteVersion(restoredNote)
    setEditorRevision(value => value + 1)
    setToast(missingFileNames.size
      ? `Przywrócono wersję. ${missingFileNames.size} brakujących załączników nie udało się odzyskać.`
      : 'Przywrócono wybraną wersję notatki wraz z jej załącznikami.')
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
    setShowCreateNoteDialog(false)
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

  const openCreateNote = useCallback(() => {
    setActiveReviewSessionId('')
    setShowCreateNoteDialog(true)
    setMobileDrawer('none')
  }, [])

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

  function removeNotesFromReviewSessions(noteIdsToRemove: Set<string>) {
    if (!noteIdsToRemove.size) return
    const now = Date.now()
    setReviewSessions(current => current.map(session => {
      if (!session.noteIds.some(id => noteIdsToRemove.has(id))) return session
      const checkpointed = checkpointReviewSession(session, now)
      const noteIds = checkpointed.noteIds.filter(id => !noteIdsToRemove.has(id))
      const status = !noteIds.length && checkpointed.status === 'running' ? 'paused' : checkpointed.status
      const noteTimesMs = Object.fromEntries(Object.entries(checkpointed.noteTimesMs).filter(([id]) => noteIds.includes(id)))
      return {
        ...checkpointed,
        noteIds,
        noteTimesMs,
        activeNoteId: checkpointed.activeNoteId && noteIds.includes(checkpointed.activeNoteId) ? checkpointed.activeNoteId : noteIds[0] ?? null,
        status,
        runningSince: status === 'running' ? checkpointed.runningSince : undefined,
        updatedAt: now,
      }
    }))
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
      patchNote(renameTarget.id, { title: value, aliases: renamed && renamed.title !== value ? [...new Set([...(renamed.aliases ?? []), renamed.title].filter(Boolean))] : renamed?.aliases })
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
    const entries = trashNoteData(new Set([id]))
    const nextTrash = [...entries, ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
    await saveTrashEntries(nextTrash)
    setTrashEntries(nextTrash)
    await removeAssetsForNote(id)
    await removeAttachmentsForNote(id)
    await removeNote(id)
    setAssets(current => current.filter(asset => asset.noteId !== id))
    setAttachments(current => current.filter(attachment => attachment.noteId !== id))
    setNotes(current => current.filter(note => note.id !== id))
    setFlashcards(current => current.filter(card => card.noteId !== id))
    removeNotesFromReviewSessions(new Set([id]))
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
        const removedIdsForTrash = new Set(removedNotes.map(note => note.id))
        const nextTrash = [...trashNoteData(removedIdsForTrash), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
        await saveTrashEntries(nextTrash)
        setTrashEntries(nextTrash)
        await Promise.all(removedNotes.map(async note => {
          await removeAssetsForNote(note.id)
          await removeAttachmentsForNote(note.id)
          await removeNote(note.id)
        }))
        const removedIds = new Set(removedNotes.map(note => note.id))
        removeNotesFromReviewSessions(removedIds)
        setAssets(current => current.filter(asset => !removedIds.has(asset.noteId)))
        setAttachments(current => current.filter(attachment => !removedIds.has(attachment.noteId)))
        setNotes(current => current.filter(note => !removedIds.has(note.id)))
        setFlashcards(current => current.filter(card => !removedIds.has(card.noteId)))
        if (selectedId && removedIds.has(selectedId)) selectNote(notes.find(note => !removedIds.has(note.id))?.id ?? '')
        const nextFolders = folders.filter(folder => folder !== target.path && !folder.startsWith(`${target.path}/`))
        setFolderRegistry(nextFolders)
        setFolderColors(current => Object.fromEntries(Object.entries(current).filter(([folder]) => folder !== target.path && !folder.startsWith(`${target.path}/`))))
        await saveFolders(nextFolders)
        await removeFolderFromDisk(target.path)
        if (activeFilter === target.path || activeFilter.startsWith(`${target.path}/`)) setActiveFilter('all')
      }
      setDeleteTarget(null)
      setToast(`Przeniesiono „${target.label}” do kosza`)
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
          <button className={`nav-item folder-item ${activeFilter === folder && !showingWorkspacePage ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, target, label)} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); setActiveFilter(folder); setMobileDrawer('none') }} title={`Przeciągnij folder „${label}”, aby go przenieść`}><Folder size={16} /><span>{label}</span><span className="nav-count">{count}</span></button>
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

  function toggleMainSidebar() {
    setShowMainSidebar(current => {
      const next = !current
      localStorage.setItem('no-tie-main-sidebar-visible', String(next))
      return next
    })
  }

  function isPhoneLayout() {
    return window.matchMedia('(max-width: 700px)').matches
  }

  function toggleSidebarPanel() {
    if (isPhoneLayout()) {
      setMobileDrawer(current => current === 'sidebar' ? 'none' : 'sidebar')
      return
    }
    toggleMainSidebar()
  }

  function sidebarPanelIsVisible() {
    return isPhoneLayout() ? mobileDrawer === 'sidebar' : showMainSidebar
  }

  function toggleLibraryPanel() {
    if (isPhoneLayout()) {
      if (!showLibrary) {
        localStorage.setItem('no-tie-library-visible', 'true')
        setShowLibrary(true)
      }
      setMobileDrawer(current => current === 'notes' ? 'none' : 'notes')
      return
    }
    toggleLibrary()
  }

  function libraryPanelIsVisible() {
    return isPhoneLayout() ? mobileDrawer === 'notes' : showLibrary
  }

  function openOllamaSettings() {
    setOllamaDraftUrl(ollamaBaseUrl)
    setOllamaDraftModel(ollamaModel)
    setEmbeddingDraftModel(embeddingModel)
    setTranscriptionDraftUrl(transcriptionUrl)
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
    const nextEmbeddingModel = embeddingDraftModel.trim() || 'nomic-embed-text'
    setEmbeddingModel(nextEmbeddingModel)
    localStorage.setItem('no-tie-ollama-url', baseUrl)
    localStorage.setItem('no-tie-ollama-model', model)
    localStorage.setItem('no-tie-embedding-model', nextEmbeddingModel)
    const transcriptionEndpoint = transcriptionDraftUrl.trim()
    if (transcriptionEndpoint) {
      setTranscriptionUrl(transcriptionEndpoint)
      localStorage.setItem('no-tie-transcription-url', transcriptionEndpoint)
    }
    setShowOllamaSettings(false)
  }

  async function createAutomaticBackup(silent = true) {
    if (automaticBackupRunning.current) return
    const snapshot = backupSnapshotRef.current
    if (!snapshot.notes.length) return
    automaticBackupRunning.current = true
    setBackupBusy(true)
    try {
      await Promise.all(snapshot.notes.map(note => flushNoteVersion(note.id, note)))
      const versions = (await Promise.all(snapshot.notes.map(note => getNoteVersions(note.id)))).flat()
      const attachmentHistory = (await Promise.all(snapshot.notes.map(note => getAttachmentHistory(note.id)))).flat()
      const workspace = { reviewSessions: snapshot.reviewSessions, savedSearches: snapshot.savedSearches, noteTemplates: snapshot.templates, folderColors: snapshot.folderColors, flashcards: snapshot.flashcards, trash: snapshot.trashEntries }
      const info = await saveAutoBackup(buildArchive(snapshot.notes, snapshot.assets, versions, snapshot.attachments, workspace, attachmentHistory))
      localStorage.setItem('no-tie-last-automatic-backup', String(info.createdAt))
      setAutoBackups(await getAutoBackups())
      if (!silent) setToast(`Utworzono kopię zapasową: ${info.fileName}`)
    } catch (error) {
      reportDiskSaveError(error)
    } finally {
      automaticBackupRunning.current = false
      setBackupBusy(false)
    }
  }

  useEffect(() => {
    if (!ready) return
    const checkBackupSchedule = () => {
      const previous = Number(localStorage.getItem('no-tie-last-automatic-backup') ?? '0')
      if (Date.now() - previous >= 86_400_000) void createAutomaticBackup(true)
    }
    checkBackupSchedule()
    const interval = window.setInterval(checkBackupSchedule, 60 * 60_000)
    return () => window.clearInterval(interval)
  }, [ready])

  async function downloadAutomaticBackup(fileName: string) {
    try {
      const bytes = await readAutoBackup(fileName)
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { reportDiskSaveError(error) }
  }

  async function removeAutomaticBackup(fileName: string) {
    try { await deleteAutoBackup(fileName); setAutoBackups(await getAutoBackups()) } catch (error) { reportDiskSaveError(error) }
  }

  function createFlashcard(noteId: string, question: string, answer: string) {
    const now = Date.now()
    setFlashcards(current => [{ id: crypto.randomUUID(), noteId, question, answer, dueAt: now, intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0 }, ...current])
  }

  function rateFlashcard(id: string, grade: FlashcardGrade) {
    setFlashcards(current => current.map(card => card.id === id ? reviewFlashcard(card, grade) : card))
  }

  function trashNoteData(noteIds: Set<string>, batchId = crypto.randomUUID()) {
    const deletedAt = Date.now()
    return notes.filter(note => noteIds.has(note.id)).map(note => ({
      id: crypto.randomUUID(), batchId, deletedAt, note: copyNote(note),
      assets: assets.filter(asset => asset.noteId === note.id).map(asset => ({ ...asset })),
      attachments: attachments.filter(attachment => attachment.noteId === note.id).map(attachment => ({ ...attachment })),
    }))
  }

  async function restoreTrashEntry(entryId: string) {
    const entry = trashEntries.find(item => item.id === entryId)
    if (!entry) return
    const restoredNote = notes.some(note => note.id === entry.note.id) ? { ...entry.note, id: crypto.randomUUID() } : entry.note
    const restoredAssets = entry.assets.map(asset => ({ ...asset, id: `${restoredNote.id}:${asset.fileName}`, noteId: restoredNote.id }))
    const restoredAttachments = entry.attachments.map(attachment => ({ ...attachment, id: `${restoredNote.id}:${attachment.fileName}`, noteId: restoredNote.id }))
    try {
      await saveNote(restoredNote)
      await Promise.all(restoredAssets.map(saveAsset))
      await Promise.all(restoredAttachments.map(saveAttachment))
      const remainingTrash = trashEntries.filter(item => item.id !== entryId)
      await saveTrashEntries(remainingTrash)
      setTrashEntries(remainingTrash)
      setNotes(current => [restoredNote, ...current])
      setAssets(current => [...current.filter(asset => asset.noteId !== restoredNote.id), ...restoredAssets])
      setAttachments(current => [...current.filter(attachment => attachment.noteId !== restoredNote.id), ...restoredAttachments])
      setFolderRegistry(current => [...new Set([...current, ...folderParents(restoredNote.folder)])])
      selectNote(restoredNote.id)
      setShowBackupTrash(false)
    } catch (error) { reportDiskSaveError(error) }
  }

  async function deleteTrashEntry(entryId: string) {
    const remainingTrash = trashEntries.filter(item => item.id !== entryId)
    await saveTrashEntries(remainingTrash)
    setTrashEntries(remainingTrash)
  }

  async function emptyTrash() {
    await saveTrashEntries([])
    setTrashEntries([])
  }

  async function exportNotesArchive() {
    try {
      await Promise.all(notes.map(note => flushNoteVersion(note.id, note)))
      const versions = (await Promise.all(notes.map(note => getNoteVersions(note.id)))).flat()
      const attachmentHistory = (await Promise.all(notes.map(note => getAttachmentHistory(note.id)))).flat()
      const workspace = { reviewSessions, savedSearches, noteTemplates: templates, folderColors, flashcards, trash: trashEntries }
      const savedPath = await exportArchiveToFolder(notes, assets, versions, attachments, workspace, attachmentHistory)
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
        openCreateNote()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openCreateNote])

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
      const imported = file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown')
        ? (() => {
          const source = file
          return source.text().then(markdown => {
            const note = markdownToNote(markdown, crypto.randomUUID())
            const heading = note.content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
            if (!note.title || note.title === 'Importowana notatka') note.title = heading || source.name.replace(/\.(?:md|markdown)$/i, '').replace(/[-_]+/g, ' ')
            note.folder = 'Importowane'
            return { notes: [note], assets: [], versions: [], attachments: [], attachmentHistory: [] }
          })
        })()
        : parseArchive(new Uint8Array(await file.arrayBuffer()))
      const parsed = await imported
      await applyParsedArchive(parsed)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nie udało się zaimportować pliku.')
      window.setTimeout(() => setToast(''), 4000)
    }
    event.target.value = ''
  }

  async function applyParsedArchive(imported: ReturnType<typeof parseArchive>, replaceExisting = false) {
    setSaved(false)
    if (replaceExisting) {
      await Promise.all(notes.map(async note => {
        await removeAssetsForNote(note.id)
        await removeAttachmentsForNote(note.id)
        await removeNote(note.id)
      }))
    }
    await Promise.all(imported.notes.map(async note => {
      if (!replaceExisting && notes.some(existing => existing.id === note.id)) {
        await removeAssetsForNote(note.id)
        await removeAttachmentsForNote(note.id)
      }
      await saveNote(note)
      const versions = imported.versions.filter(version => version.noteId === note.id)
      await saveNoteVersions(note.id, versions)
      if (!versions.length) await saveNoteVersion(note)
    }))
    await Promise.all(imported.assets.map(saveAsset))
    await Promise.all(imported.attachments.map(saveAttachment))
    await Promise.all(imported.attachmentHistory.map(saveArchivedAttachment))
    const importedIds = new Set(imported.notes.map(note => note.id))
    const nextNotes = (replaceExisting ? imported.notes : [...notes.filter(note => !importedIds.has(note.id)), ...imported.notes]).sort((a, b) => b.updatedAt - a.updatedAt)
    setNotes(nextNotes)
    setAssets(current => [...(replaceExisting ? [] : current.filter(asset => !importedIds.has(asset.noteId))), ...imported.assets])
    setAttachments(current => [...(replaceExisting ? [] : current.filter(attachment => !importedIds.has(attachment.noteId))), ...imported.attachments])
    const nextFolders = [...new Set([...(!replaceExisting ? folders : []), ...imported.notes.flatMap(note => folderParents(note.folder))])]
    setFolderRegistry(nextFolders)
    if (imported.workspace) {
      const availableNoteIds = new Set(nextNotes.map(note => note.id))
      setReviewSessions(imported.workspace.reviewSessions.map(session => {
        const noteIds = session.noteIds.filter(id => availableNoteIds.has(id))
        const noteTimesMs = Object.fromEntries(Object.entries(session.noteTimesMs).filter(([id]) => noteIds.includes(id)))
        return { ...session, noteIds, noteTimesMs, activeNoteId: session.activeNoteId && noteIds.includes(session.activeNoteId) ? session.activeNoteId : noteIds[0] ?? null }
      }))
      setSavedSearches(imported.workspace.savedSearches)
      setTemplates(imported.workspace.noteTemplates.length ? imported.workspace.noteTemplates : defaultTemplates)
      setFolderColors(imported.workspace.folderColors)
      if (imported.workspace.flashcards) setFlashcards(imported.workspace.flashcards.filter(card => availableNoteIds.has(card.noteId)))
      if (imported.workspace.trash) setTrashEntries(imported.workspace.trash)
    }
    if (replaceExisting) setActiveFilter('all')
    if (imported.notes[0]) selectNote(imported.notes[0].id)
    setActiveReviewSessionId('')
    setEditorRevision(value => value + 1)
    setSaved(true)
    setToast(`${replaceExisting ? 'Przywrócono' : 'Zaimportowano'} ${imported.notes.length} notatek.`)
    window.setTimeout(() => setToast(''), 3000)
  }

  async function restoreAutomaticBackup(fileName: string) {
    setBackupBusy(true)
    try {
      const imported = parseArchive(await readAutoBackup(fileName))
      await applyParsedArchive(imported, true)
      setShowBackupTrash(false)
    } catch (error) { reportDiskSaveError(error) } finally { setBackupBusy(false) }
  }

  async function deleteSelected() {
    if (selectedNote) askDelete({ kind: 'note', id: selectedNote.id })
  }

  async function saveDrawing(svg: string) {
    if (!selectedNote) return
    const usedNames = new Set([...assets.filter(item => item.noteId === selectedNote.id), ...attachments.filter(item => item.noteId === selectedNote.id)].map(item => item.fileName.toLocaleLowerCase('pl')))
    const nextFileName = uniqueAttachmentName(`schemat-${assets.filter(item => item.noteId === selectedNote.id).length + 1}.svg`, usedNames)
    const asset: NoteAsset = editingAsset
      ? { ...editingAsset, svg }
      : { id: crypto.randomUUID(), noteId: selectedNote.id, fileName: nextFileName, svg }
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
    <main className={`app-shell ${mobileDrawer !== 'none' ? 'drawer-open' : ''} ${showChat ? 'with-ollama-chat' : ''} ${showLibrary ? '' : 'library-hidden'} ${showMainSidebar ? '' : 'sidebar-hidden'}`}>
      <aside className={`sidebar ${mobileDrawer === 'sidebar' ? 'mobile-visible' : ''}`}>
        <div className="sidebar-content">
          <div className="brand-row"><div className="brand-mark">N</div><span>No-Tie</span><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij menu"><X size={18} /></button></div>
          <button className="new-note-button" onClick={openCreateNote}><Plus size={17} /><span>Nowa notatka</span><kbd>N</kbd></button>
          <div className="sidebar-section">
            <span className="section-label">BIBLIOTEKA</span>
            <button className={`nav-item ${activeFilter === 'all' && !showingWorkspacePage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(''); setActiveFilter('all'); setMobileDrawer('none') }}><BookOpen size={17} /><span>Wszystkie notatki</span><span className="nav-count">{notes.length}</span></button>
            <button className={`nav-item ${showingFavoriteNotesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(FAVORITE_NOTES_PAGE_ID); setActiveFilter('all'); setMobileDrawer('none') }}><Heart size={17} /><span>Ulubione</span><span className="nav-count">{notes.filter(note => note.favorite).length}</span></button>
            <button className={`nav-item ${showingRecentNotesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(RECENT_NOTES_PAGE_ID); setActiveFilter('all'); setMobileDrawer('none') }}><Clock3 size={17} /><span>Ostatnie</span></button>
          </div>
          <div className="sidebar-section workspace-tools">
            <div className="section-heading"><span className="section-label">NARZĘDZIA</span></div>
            <button className="nav-item" onClick={() => setShowDailyNotes(true)}><CalendarDays size={16} /><span>Notatki dzienne</span></button>
            <button className="nav-item" onClick={() => setShowTaskManager(true)}><CheckSquare2 size={16} /><span>Zadania</span><span className="nav-count">{parsedTasks.filter(task => !task.done).length}</span></button>
            <button className={`nav-item ${showingFlashcardsPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(FLASHCARDS_PAGE_ID); setActiveFilter('all'); setMobileDrawer('none') }}><Brain size={16} /><span>Fiszki</span><span className="nav-count">{flashcards.filter(card => card.dueAt <= Date.now()).length}</span></button>
            <button className="nav-item" onClick={() => setShowBackupTrash(true)}><Archive size={16} /><span>Kopie i kosz</span><span className="nav-count">{trashEntries.length}</span></button>
            <button className="nav-item" onClick={() => setShowKnowledgeGraph(true)}><Network size={16} /><span>Mapa powiązań</span></button>
            <button className="nav-item" onClick={() => setShowFeatureManager(true)}><Puzzle size={16} /><span>Moduły aplikacji</span></button>
            {featureFlags.duplicateManager && <button className="nav-item" onClick={() => setShowDuplicateManager(true)}><Copy size={16} /><span>Duplikaty</span></button>}
            {featureFlags.attachmentManager && <button className="nav-item" onClick={() => setShowAttachmentManager(true)}><Paperclip size={16} /><span>Załączniki</span><span className="nav-count">{attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).length}</span></button>}
            {featureFlags.noteBoard && <button className="nav-item" onClick={() => setShowNoteBoard(true)}><Columns3 size={16} /><span>Statusy notatek</span></button>}
            {featureFlags.projectDashboard && <button className="nav-item" onClick={() => setShowProjectDashboard(true)}><BarChart3 size={16} /><span>Pulpit projektów</span></button>}
            <button className={`nav-item ${showingSavedSearchesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(SAVED_SEARCHES_PAGE_ID); setMobileDrawer('none') }}><BookmarkPlus size={16} /><span>Zapisane widoki</span><span className="nav-count">{savedSearches.length}</span></button>
            <button className={`nav-item ${showingNoteTemplatesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(NOTE_TEMPLATES_PAGE_ID); setMobileDrawer('none') }}><FilePlus2 size={16} /><span>Szablony</span><span className="nav-count">{templates.length}</span></button>
            <button className={`nav-item ${showingReviewSessionsOverview || activeReviewSession ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(REVIEW_SESSIONS_OVERVIEW_ID); setMobileDrawer('none') }}><Repeat2 size={16} /><span>Powtórki</span><span className="nav-count">{reviewSessions.length}</span></button>
          </div>
          {featureFlags.smartFolders && savedSearches.length > 0 && <div className="sidebar-section smart-folders-section"><div className="section-heading"><span className="section-label">INTELIGENTNE FOLDERY</span></div>{savedSearches.map(search => { const visibleAttachments = attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined }); const count = searchNotes(notes, { query: search.query, tag: search.tag, folder: search.folder, attachments: visibleAttachments, advanced: featureFlags.advancedQuery }).length; return <button type="button" className={`nav-item ${activeFilter === `smart:${search.id}` ? 'active' : ''}`} key={search.id} onClick={() => { setActiveReviewSessionId(''); setActiveFilter(`smart:${search.id}`); setQuery(''); setSearchTag(''); setSearchFolder(''); setMobileDrawer('none') }}><Search size={15} /><span>{search.name}</span><span className="nav-count">{count}</span></button> })}</div>}
          <div className="sidebar-section folders-section">
            <div className="section-heading"><span className="section-label">FOLDERY</span><button className="tiny-icon" title="Dodaj folder" aria-label="Dodaj folder" onClick={() => { setFolderDraft(''); setShowFolderDialog(true) }}><Plus size={15} /></button></div>
            <div className="folder-entries" data-drop-folder="">
              {notes.filter(note => !note.folder).map(note => renderNoteFile(note))}
              {renderFolderTree('')}
              {!folders.length && !notes.some(note => !note.folder) && <p className="empty-hint">Utwórz folder lub przeciągnij tu notatkę.</p>}
            </div>
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="offline-card"><span className="online-dot" /><div><strong>Dane lokalne</strong><span>{storageLocationLabel} · offline</span></div><Check size={15} /></div>
          <div className="user-row"><div className="avatar">N</div><div><strong>Moje notatki</strong><span>Przestrzeń prywatna</span></div>{featureFlags.appLock && hasLockPin && <button type="button" className="sidebar-help-button" onClick={lockApp} title="Zablokuj aplikację" aria-label="Zablokuj aplikację"><LockKeyhole size={17} /></button>}<button type="button" className="sidebar-help-button" onClick={() => setShowHelp(true)} title="Instrukcja obsługi" aria-label="Otwórz instrukcję obsługi"><CircleHelp size={19} /></button></div>
        </div>
      </aside>

      <section className={`notes-panel ${mobileDrawer === 'notes' ? 'mobile-visible' : ''}`} hidden={!showLibrary}>
        <div className="notes-panel-heading"><div><p className="eyebrow">TWOJA BIBLIOTEKA</p><h1>{activeFilter === 'all' ? 'Notatki' : activeFilter === 'favorites' ? 'Ulubione' : activeFilter === 'root' ? 'Poziom główny' : activeSmartFolder?.name ?? activeFilter.split('/').at(-1)}</h1></div><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij listę"><X size={18} /></button></div>
        <div className="search-controls">
          <label className="search-box"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setQuickSearchActiveIndex(0) }} placeholder="Szukaj notatek…" title="Szukaj także po treści, tagach i folderach. Obsługuje tag:, folder:, title: i content:." /><kbd>⌘/Ctrl K</kbd></label>
          <button className={`search-filter-button ${showSearchFilters ? 'active' : ''}`} type="button" aria-label="Filtry wyszukiwania" aria-expanded={showSearchFilters} title="Filtruj po tagu i folderze" onClick={() => setShowSearchFilters(value => !value)}><SlidersHorizontal size={16} /></button>
          <button className="search-quick-button" type="button" aria-label="Otwórz szybkie wyszukiwanie" title="Szybkie wyszukiwanie (Ctrl+K)" onClick={() => { setQuickSearchActiveIndex(0); setShowQuickSearch(true) }}><Search size={15} /><kbd>⌘K</kbd></button>
        </div>
        {showSearchFilters && <div className="search-filter-panel">
          <label><span>Tag</span><select value={searchTag} onChange={event => setSearchTag(event.target.value)} aria-label="Filtruj bibliotekę po tagu"><option value="">Wszystkie tagi</option>{tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
          <label><span>Folder</span><select value={searchFolder} onChange={event => setSearchFolder(event.target.value)} aria-label="Filtruj bibliotekę po folderze"><option value="">Wszystkie foldery</option><option value="__root__">Bez folderu</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select></label>
          {featureFlags.semanticSearch && <label className="semantic-search-toggle"><input type="checkbox" checked={semanticSearchEnabled} onChange={event => { setSemanticSearchEnabled(event.target.checked); localStorage.setItem('no-tie-semantic-search', String(event.target.checked)) }} />Szukaj semantycznie {semanticSearchBusy && <small>…</small>}</label>}
          {(searchTag || searchFolder) && <button type="button" className="link-button" onClick={() => { setSearchTag(''); setSearchFolder('') }}>Wyczyść</button>}
          {featureFlags.advancedQuery && <small>Zapytania: <code>tag:projekt</code>, <code>folder:Praca</code>, <code>title:spotkanie</code>, <code>content:ustalenia</code>, <code>after:2026-01-01</code>, <code>has:pdf</code>, <code>OR</code>, <code>NOT</code>.</small>}
          {semanticSearchError && <small className="semantic-search-error" role="status">{semanticSearchError}</small>}
        </div>}
        {featureFlags.bulkActions && <div className="bulk-note-toolbar"><button type="button" className={`button ${bulkSelectMode ? 'primary' : 'secondary'}`} onClick={() => { setBulkSelectMode(value => !value); setBulkSelectedIds([]) }}>{bulkSelectMode ? 'Zakończ zaznaczanie' : 'Zaznacz notatki'}</button>{bulkSelectMode && <><span>{bulkSelectedIds.length} zaznaczono</span><button type="button" className="link-button" onClick={() => setBulkSelectedIds(visibleNotes.map(note => note.id))}>Zaznacz widoczne</button><select aria-label="Przenieś zaznaczone notatki do folderu" value={bulkTargetFolder} onChange={event => setBulkTargetFolder(event.target.value)}><option value="">Poziom główny</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><button type="button" className="button secondary" disabled={!bulkSelectedIds.length} onClick={moveSelectedNotesBulk}>Przenieś</button><input aria-label="Tag dla zaznaczonych notatek" value={bulkTagDraft} onChange={event => setBulkTagDraft(event.target.value)} placeholder="Dodaj/usuń tag" /><button type="button" className="button secondary" disabled={!bulkTagDraft.trim() || !bulkSelectedIds.length} onClick={applyBulkTag}>Zastosuj tag</button><button type="button" className="button danger-button" disabled={!bulkSelectedIds.length} onClick={() => void deleteSelectedNotesBulk()}><Trash2 size={13} />Do kosza</button></>}</div>}
        <div className="list-toolbar"><span>{visibleNotes.length} NOTATKI</span><label className="list-view-select"><span>Widok</span><select value={noteDisplayMode} onChange={event => setDisplayMode(event.target.value as NoteDisplayMode)} aria-label="Sposób wyświetlania notatek"><option value="full">Treść i tagi</option><option value="names-tags">Nazwy i tagi</option><option value="names">Same nazwy</option></select></label></div>
        <div className="note-list">
          {visibleNotes.map(note => (
            <div className="note-card-select-row" key={note.id}>{bulkSelectMode && <input type="checkbox" className="note-bulk-checkbox" aria-label={`Zaznacz notatkę ${note.title || 'Bez tytułu'}`} checked={bulkSelectedIds.includes(note.id)} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={event => setBulkSelectedIds(current => event.target.checked ? [...new Set([...current, note.id])] : current.filter(id => id !== note.id))} />}<button className={`note-card view-${noteDisplayMode} ${selectedId === note.id ? 'selected' : ''} ${noteDisplayColor(note) ? 'has-entry-color' : ''}`} style={entryColorStyle(noteDisplayColor(note))} onPointerDown={event => startEntryPointerDrag(event, { kind: 'note', id: note.id }, note.title || 'Bez tytułu')} onClick={() => { if (ignoreClickAfterDrag() || bulkSelectMode) return; setActiveReviewSessionId(''); selectNote(note.id); setMobileDrawer('none') }}>
              {noteDisplayMode === 'full' && <div className="note-card-top"><span className="note-date">{dateLabel(note.updatedAt)}</span>{note.favorite && <Star size={14} className="favorite-mini" fill="currentColor" />}</div>}
              <strong>{note.title || 'Bez tytułu'}</strong>
              {noteDisplayMode === 'full' && <p>{excerpt(note.content) || 'Pusta notatka'}</p>}
              {noteDisplayMode !== 'names' && <div className="note-card-bottom">{noteDisplayMode === 'full' && note.folder && <span className="folder-pill"><Folder size={12} />{note.folder}</span>}{note.tags.map(cleanLibraryTag).filter(tag => tag && !/^[-:|\s]+$/.test(tag)).map((tag, index) => <span key={`${index}:${tag}`} className="tag-pill">{tag}</span>)}</div>}
            </button></div>
          ))}
          {!visibleNotes.length && <div className="empty-state compact"><div className="empty-illustration"><Search size={22} /></div><strong>Brak pasujących notatek</strong><span>Spróbuj zmienić wyszukiwanie albo utwórz nową notatkę.</span><button className="button secondary" onClick={openCreateNote}><Plus size={15} />Nowa notatka</button></div>}
        </div>
        <div className="notes-list-footer"><span><span className="online-dot" />{usesNativeFiles ? ' Pliki na tym urządzeniu' : ' Zapis na tym urządzeniu'}</span></div>
      </section>

      <section className="editor-panel">
        <header className="topbar">
          <div className="topbar-start">
            <div className="mobile-actions"><button className="icon-button" onClick={() => setMobileDrawer('sidebar')} aria-label="Otwórz menu folderów i narzędzi"><Menu size={19} /></button><button className="icon-button" onClick={() => { if (!showLibrary) { localStorage.setItem('no-tie-library-visible', 'true'); setShowLibrary(true) } setMobileDrawer('notes') }} aria-label={showLibrary ? 'Pokaż notatki' : 'Pokaż bibliotekę'}><PanelLeft size={18} /></button></div>
            <details className="topbar-dropdown topbar-dropdown-left" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open') }}>
              <summary className="topbar-dropdown-trigger" aria-label="Menu paneli i biblioteki"><MoreVertical size={16} /><span className="topbar-dropdown-label">Panele</span><ChevronDown size={13} /></summary>
              <div className="topbar-dropdown-menu" role="group" aria-label="Panele i biblioteka">
                <button type="button" onClick={event => { toggleSidebarPanel(); event.currentTarget.closest('details')?.removeAttribute('open') }}><PanelLeft size={15} /><span>{sidebarPanelIsVisible() ? 'Ukryj foldery i narzędzia' : 'Pokaż foldery i narzędzia'}</span>{sidebarPanelIsVisible() && <Check size={14} className="topbar-menu-check" />}</button>
                <button type="button" onClick={event => { toggleLibraryPanel(); event.currentTarget.closest('details')?.removeAttribute('open') }}><BookOpen size={15} /><span>{libraryPanelIsVisible() ? 'Ukryj Twoją bibliotekę' : 'Pokaż Twoją bibliotekę'}</span>{libraryPanelIsVisible() && <Check size={14} className="topbar-menu-check" />}</button>
              </div>
            </details>
          </div>
          <div className="breadcrumb"><span>{showingSavedSearchesPage || showingNoteTemplatesPage || showingReviewSessionsOverview || showingFlashcardsPage || activeReviewSession ? 'Narzędzia' : 'Notatki'}</span><span className="crumb-slash">/</span><span>{showingSavedSearchesPage ? 'Zapisane widoki' : showingNoteTemplatesPage ? 'Szablony' : showingReviewSessionsOverview ? 'Wszystkie powtórki' : showingFlashcardsPage ? 'Fiszki' : showingRecentNotesPage ? 'Ostatnie' : showingFavoriteNotesPage ? 'Ulubione' : activeReviewSession?.title ?? selectedNote?.folder ?? 'Osobiste'}</span></div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saved ? 'is-saved' : ''}`}><span className="save-dot" />{saved ? 'Zapisano' : 'Zapisywanie…'}</span>
            {selectedNote && featureFlags.noteReminders && <button type="button" className="icon-button note-history-button" onClick={() => setShowNoteReminder(true)} title="Ustaw przypomnienie o notatce" aria-label="Ustaw przypomnienie o notatce"><Bell size={16} /></button>}
            {selectedNote && <button className="icon-button note-history-button" onClick={() => void openNoteHistory()} title="Historia wersji notatki" aria-label="Historia wersji notatki"><History size={17} /></button>}
            <details className="topbar-dropdown topbar-dropdown-right" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open') }}>
              <summary className={`topbar-dropdown-trigger ollama-menu-trigger ${showChat ? 'active' : ''}`} aria-label="Menu Ollama" title="Ollama"><MessageCircle size={16} /><span className="topbar-dropdown-label">Ollama</span><ChevronDown size={13} /></summary>
              <div className="topbar-dropdown-menu" role="group" aria-label="Ollama i operacje na paczce">
                <button type="button" onClick={event => { toggleChat(); event.currentTarget.closest('details')?.removeAttribute('open') }}><MessageCircle size={15} /><span>{showChat ? 'Ukryj czat Ollama' : 'Pokaż czat Ollama'}</span>{showChat && <Check size={14} className="topbar-menu-check" />}</button>
                <button type="button" onClick={event => { openOllamaSettings(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Settings2 size={15} /><span>Ustawienia modelu</span></button>
                <div className="topbar-menu-separator" role="separator" />
                <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); exportNotesArchive() }}><Archive size={15} /><span>Eksportuj paczkę</span></button>
                <button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); importInput.current?.click() }}><Import size={15} /><span>Importuj paczkę</span></button>
              </div>
            </details>
            <input ref={importInput} type="file" accept=".zip,.md,.markdown,application/zip,text/markdown" hidden onChange={handleImport} />
          </div>
        </header>

        {showingSavedSearchesPage ? (
          <SavedSearchDialog
            searches={savedSearches}
            current={{ query, tag: searchTag, folder: searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : '') }}
            onSave={name => { const folder = searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : ''); setSavedSearches(current => [{ id: crypto.randomUUID(), name, query, tag: searchTag, folder }, ...current]) }}
            onApply={applySavedSearch}
            onDelete={id => setSavedSearches(current => current.filter(search => search.id !== id))}
            onClose={() => setActiveReviewSessionId('')}
          />
        ) : showingNoteTemplatesPage ? (
          <TemplateManagerDialog templates={templates} onSave={setTemplates} onClose={() => setActiveReviewSessionId('')} />
        ) : showingRecentNotesPage ? (
          <NoteCollectionPage kind="recent" notes={notes} recentIds={recentNoteIds} onOpen={openLinkedNote} />
        ) : showingFavoriteNotesPage ? (
          <NoteCollectionPage kind="favorites" notes={notes} recentIds={recentNoteIds} onOpen={openLinkedNote} />
        ) : showingFlashcardsPage ? (
          <FlashcardsPage cards={flashcards} notes={notes} onCreate={createFlashcard} onReview={rateFlashcard} onDelete={id => setFlashcards(current => current.filter(card => card.id !== id))} onOpenNote={noteId => { setActiveReviewSessionId(''); openLinkedNote(noteId) }} />
        ) : showingReviewSessionsOverview ? (
          <ReviewSessionsOverview
            sessions={reviewSessions}
            notes={notes}
            now={reviewClockNow}
            onOpen={sessionId => { setActiveReviewSessionId(sessionId); setMobileDrawer('none') }}
            onCreate={() => openReviewSessionEditor()}
            onEdit={openReviewSessionEditor}
          />
        ) : activeReviewSession ? (
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
              <NotePropertiesEditor key={`${selectedNote.id}:${(selectedNote.aliases ?? []).join('|')}`} note={selectedNote} onChange={patch => patchNote(selectedNote.id, patch)} />
              <div className="editor-tools-row">
                <div className="editor-tools-left"><div className="view-mode-toggle" role="group" aria-label="Widok notatki"><button className={`view-mode-button ${editorMode === 'rendered' ? 'active' : ''}`} title="Widok wizualny" aria-label="Widok wizualny" aria-pressed={editorMode === 'rendered'} onClick={() => setEditorMode('rendered')}><Eye size={16} /></button><button className={`view-mode-button ${editorMode === 'source' ? 'active' : ''}`} title="Surowy Markdown" aria-label="Surowy Markdown" aria-pressed={editorMode === 'source'} onClick={() => setEditorMode('source')}><Code2 size={16} /></button></div><span className="toolbar-separator" /><button className="inline-tool" onClick={() => { setEditingAsset(undefined); setShowDrawing(true) }}><Sparkles size={15} />Dodaj schemat</button>{currentAssets.map(asset => <button className="inline-tool asset-tool" key={asset.id} onClick={() => { setEditingAsset(asset); setShowDrawing(true) }}><Lightbulb size={14} />{asset.fileName}</button>)}</div>
                <div className="template-toolbar"><button type="button" className="icon-button template-manage-button" title="Eksportuj jako HTML" aria-label="Eksportuj jako HTML" onClick={() => exportCurrentAsHtml()}><FileText size={14} /></button><button type="button" className="icon-button template-manage-button" title="Drukuj / zapisz jako PDF" aria-label="Drukuj lub zapisz jako PDF" onClick={exportCurrentAsPdf}><Archive size={14} /></button></div>
              </div>
              {editorMode === 'source' ? <MarkdownSourceEditor noteId={selectedNote.id} markdown={selectedNote.content} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'source', text })} noteActions={markdownNoteActions} onNoteAction={action => { if (action === 'link') setShowNoteLinkDialog(true); else if (action === 'embed') setShowNoteEmbedDialog(true); else if (action === 'edit-ai') setShowAiEdit(true); else setAiNoteTool(action as AiNoteTool) }} /> : <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownEditor key={`${selectedNote.id}-${editorRevision}`} noteId={selectedNote.id} markdown={selectedNote.content} assets={currentAssets} attachments={currentAttachments} revision={editorRevision} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'rendered', text })} onOpenNote={openLinkedNote} onOpenAttachment={openAttachment} notes={notes} allAssets={assets} noteActions={markdownNoteActions} onNoteAction={action => { if (action === 'link') setShowNoteLinkDialog(true); else if (action === 'embed') setShowNoteEmbedDialog(true); else if (action === 'edit-ai') setShowAiEdit(true); else setAiNoteTool(action as AiNoteTool) }} /></Suspense>}
      <NoteConnections note={selectedNote} notes={notes} onOpen={note => openLinkedNote(note.id)} onShowGraph={() => setShowKnowledgeGraph(true)} />
              <NoteAttachmentsPanel attachments={currentAttachmentsForUi} audioEnabled={featureFlags.audioNotes} onAdd={addAttachments} onRemove={attachment => void deleteAttachment(attachment)} onOcr={featureFlags.attachmentIndex ? recognizeAttachmentText : undefined} onTranscribe={featureFlags.audioNotes ? transcribeAudioAttachment : undefined} onInsertText={insertTextIntoNote} onSaveTranscript={saveAttachmentTranscript} onInsertAttachmentLink={insertAttachmentLink} onPreview={attachment => setPreviewAttachmentId(attachment.id)} />
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
          <div className="empty-state editor-empty"><div className="empty-illustration"><FilePlus2 size={25} /></div><p className="eyebrow">TWOJA PRZESTRZEŃ</p><h2>Zapisz pierwszą myśl</h2><span>Twoje notatki będą dostępne lokalnie i offline.</span><button className="button primary" onClick={openCreateNote}><Plus size={16} />Nowa notatka</button></div>
        )}
      </section>
      <ChatPanel open={showChat} baseUrl={ollamaBaseUrl} model={ollamaModel} note={selectedNote} notes={notes} assets={assets} attachments={attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })} contextPickerEnabled={featureFlags.aiContextPicker} citationsEnabled={featureFlags.aiCitations} onOpenCitation={openCitation} onClose={closeChat} onOpenSettings={openOllamaSettings} />
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {attachments.find(attachment => attachment.id === previewAttachmentId && (!attachment.mimeType.startsWith('audio/') || featureFlags.audioNotes)) && <AttachmentPreviewDialog attachment={attachments.find(attachment => attachment.id === previewAttachmentId)!} annotationsEnabled={featureFlags.pdfAnnotations} transcriptTimestampsEnabled={featureFlags.transcriptTimestamps} initialPage={previewAttachmentPage} onSaveAnnotations={savePdfAnnotations} onClose={() => setPreviewAttachmentId('')} />}
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
      {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDeleteTarget(null) }}><section className="folder-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><div className="danger-mark"><Trash2 size={19} /></div><h2 id="delete-dialog-title">{deleteTarget.kind === 'folder' ? 'Usuń folder?' : 'Usuń notatkę?'}</h2><p>{deleteTarget.kind === 'folder' ? <>Folder <strong>„{deleteTarget.label}”</strong> zostanie usunięty. {deleteTarget.noteCount ? `${deleteTarget.noteCount} ${deleteTarget.noteCount === 1 ? 'notatka trafi' : 'notatki trafią'} do kosza i będzie można je odzyskać przez 30 dni.` : 'Folder jest pusty.'}</> : <>Notatka <strong>„{deleteTarget.label}”</strong>, jej schematy SVG i załączniki trafią do kosza. Możesz je odzyskać przez 30 dni.</>}</p><div className="folder-dialog-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>Anuluj</button><button className="button danger-button" onClick={() => void confirmDelete()}><Trash2 size={14} />Przenieś do kosza</button></div></section></div>}
      {colorTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setColorTarget(null) }}><section className="folder-dialog entry-color-dialog" role="dialog" aria-modal="true" aria-labelledby="entry-color-title"><div className="folder-dialog-mark"><Palette size={19} /></div><h2 id="entry-color-title">Ustaw kolor</h2><p>{colorTarget.kind === 'folder' ? <>Kolor folderu <strong>„{colorTarget.path.split('/').at(-1)}”</strong> będzie widoczny po lewej i na kartach jego notatek w bibliotece.</> : <>Kolor pliku <strong>„{notes.find(note => note.id === colorTarget.id)?.title ?? 'notatka'}”</strong> będzie widoczny po lewej i w bibliotece.</>}</p><div className="entry-color-grid">{entryColors.map(color => <button key={color.value} className="entry-color-option" type="button" aria-label={`Ustaw kolor: ${color.label}`} aria-pressed={(colorTarget.kind === 'note' ? notes.find(note => note.id === colorTarget.id)?.color : folderColors[colorTarget.path]) === color.value} onClick={() => applyEntryColor(color.value)}><span className="entry-color-swatch" style={{ backgroundColor: color.value }} /><span>{color.label}</span></button>)}</div><div className="folder-dialog-actions"><button className="button secondary" onClick={() => applyEntryColor(undefined)}>Domyślny / kolor folderu</button><button className="button secondary" onClick={() => setColorTarget(null)}>Zamknij</button></div></section></div>}
      {showOllamaSettings && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowOllamaSettings(false) }}><section className="folder-dialog ollama-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ollama-settings-title"><div className="folder-dialog-mark"><MessageCircle size={19} /></div><h2 id="ollama-settings-title">Lokalny model Ollama</h2><p>Podłącz uruchomiony serwer Ollama. Domyślny adres lokalny to <code>http://localhost:11434</code>.</p><form onSubmit={event => { event.preventDefault(); saveOllamaSettings() }}><label htmlFor="ollama-base-url">Adres serwera</label><input id="ollama-base-url" autoFocus type="url" value={ollamaDraftUrl} onChange={event => { setOllamaDraftUrl(event.target.value); setOllamaModels([]); setOllamaSettingsMessage('') }} placeholder="http://localhost:11434" /><div className="ollama-model-label"><label htmlFor="ollama-model-name">Model</label><button type="button" className="link-button" onClick={() => void discoverOllamaModels()} disabled={checkingOllama}><span>{checkingOllama ? 'Łączenie…' : 'Pobierz listę modeli'}</span></button></div><input id="ollama-model-name" list="ollama-model-options" value={ollamaDraftModel} onChange={event => setOllamaDraftModel(event.target.value)} placeholder="np. llama3.2" /><datalist id="ollama-model-options">{ollamaModels.map(model => <option key={model.name} value={model.name} />)}</datalist>{featureFlags.semanticSearch && <><label htmlFor="ollama-embedding-model">Model embeddingów do wyszukiwania semantycznego</label><input id="ollama-embedding-model" list="ollama-model-options" value={embeddingDraftModel} onChange={event => setEmbeddingDraftModel(event.target.value)} placeholder="nomic-embed-text" /></>}{featureFlags.audioNotes && <><label htmlFor="audio-transcription-url">Lokalny serwer transkrypcji audio</label><input id="audio-transcription-url" type="url" value={transcriptionDraftUrl} onChange={event => setTranscriptionDraftUrl(event.target.value)} placeholder="http://localhost:8000/v1/audio/transcriptions" /><small className="ollama-settings-help">Wskaż pełny adres endpointu zgodnego z OpenAI Whisper API, np. serwera faster-whisper-server. Odpowiedź powinna zawierać `text`; znaczniki i identyfikatory mówców są opcjonalne. Ollama samo nie transkrybuje plików audio.</small></>}{ollamaSettingsMessage && <p className="ollama-settings-status" role="status">{ollamaSettingsMessage}</p>}{ollamaSettingsError && <p className="ollama-settings-error" role="alert">{ollamaSettingsError}</p>}<p className="ollama-settings-help">Modele pobierzesz poleceniem <code>ollama pull llama3.2</code>. Rozmowy są obsługiwane przez lokalny serwer.</p><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={() => setShowOllamaSettings(false)}>Anuluj</button><button type="submit" className="button primary">Zapisz ustawienia</button></div></form></section></div>}
      {showDailyNotes && <DailyNotesDialog notes={notes} onSelect={openDailyNote} onClose={() => setShowDailyNotes(false)} />}
      {showTaskManager && <TaskManagerDialog notes={notes} tasks={parsedTasks} onUpdate={updateTask} onOpenNote={noteId => { setShowTaskManager(false); openLinkedNote(noteId) }} onCreate={createTask} onClose={() => setShowTaskManager(false)} />}
      {showBackupTrash && <BackupTrashDialog backups={autoBackups} trash={trashEntries} busy={backupBusy} onCreateBackup={() => void createAutomaticBackup(false)} onDownloadBackup={fileName => void downloadAutomaticBackup(fileName)} onRestoreBackup={fileName => void restoreAutomaticBackup(fileName)} onDeleteBackup={fileName => void removeAutomaticBackup(fileName)} onRestoreTrash={entryId => void restoreTrashEntry(entryId)} onDeleteTrash={entryId => void deleteTrashEntry(entryId)} onEmptyTrash={() => void emptyTrash()} onClose={() => setShowBackupTrash(false)} />}
      {showCreateNoteDialog && <CreateNoteDialog templates={templates} folders={folders} initialFolder={activeFilter === 'root' ? '' : activeFilter !== 'all' && activeFilter !== 'favorites' && !activeFilter.startsWith('smart:') ? activeFilter : 'Osobiste'} onCreate={(template, folder) => createNote(template, folder)} onClose={() => setShowCreateNoteDialog(false)} />}
      {showKnowledgeGraph && <KnowledgeGraphDialog notes={notes} onOpen={note => { setShowKnowledgeGraph(false); openLinkedNote(note.id) }} onClose={() => setShowKnowledgeGraph(false)} />}
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
      {showNoteEmbedDialog && selectedNote && <NoteLinkDialog notes={notes} currentNoteId={selectedNote.id} purpose="embed" onSelect={note => { dispatchWikiEmbedInsert({ noteId: selectedNote.id, target: note.title || note.id }); setShowNoteEmbedDialog(false) }} onClose={() => setShowNoteEmbedDialog(false)} />}
      {showAiEdit && selectedNote && <AiSelectionEditDialog selectedText={selectionText} model={ollamaModel} baseUrl={ollamaBaseUrl} onApply={replacement => dispatchAiReplaceSelection({ noteId: selectedNote.id, replacement })} onClose={() => setShowAiEdit(false)} />}
      {aiNoteTool && selectedNote && <AiNoteToolsDialog kind={aiNoteTool} note={selectedNote} attachments={currentAttachmentsForUi} baseUrl={ollamaBaseUrl} model={ollamaModel} onApply={value => appendAiTextToNote(value, aiNoteTool)} onCreateFlashcard={(noteId, question, answer) => createFlashcard(noteId, question, answer)} onClose={() => setAiNoteTool(null)} />}
      {showNoteHistory && selectedNote && historyDialogNoteId === selectedNote.id && <NoteHistoryDialog note={selectedNote} attachments={currentAttachments} versions={noteVersions} loading={noteVersionsLoading} onRestore={restoreNoteVersion} onClose={closeNoteHistory} />}
      {showFeatureManager && <FeatureManagerDialog features={featureFlags} onToggle={toggleFeature} onConfigureLock={() => setShowLockSetup(true)} onClose={() => setShowFeatureManager(false)} />}
      {showLockSetup && featureFlags.appLock && <AppLockDialog mode="setup" onSetPin={configureAppLockPin} onUnlock={async () => false} onClose={() => setShowLockSetup(false)} />}
      {appLocked && featureFlags.appLock && hasLockPin && <AppLockDialog mode="unlock" onSetPin={async () => {}} onUnlock={unlockApp} />}
      {showNoteReminder && selectedNote && featureFlags.noteReminders && <NoteReminderDialog note={selectedNote} onSave={value => setNoteReminder(selectedNote.id, value)} onClose={() => setShowNoteReminder(false)} />}
      {showNoteBoard && featureFlags.noteBoard && <NoteBoardDialog notes={notes} onSetStatus={setNoteWorkflowStatus} onOpen={id => { setShowNoteBoard(false); openLinkedNote(id) }} onClose={() => setShowNoteBoard(false)} />}
      {showProjectDashboard && featureFlags.projectDashboard && <ProjectDashboardDialog notes={notes} tasks={parsedTasks} onOpenNote={id => { setShowProjectDashboard(false); openLinkedNote(id) }} onClose={() => setShowProjectDashboard(false)} />}
      {showDuplicateManager && featureFlags.duplicateManager && <DuplicateManagerDialog notes={notes} onOpen={id => { setShowDuplicateManager(false); openLinkedNote(id) }} onMerge={(targetId, sourceId) => void mergeDuplicateNotes(targetId, sourceId)} onClose={() => setShowDuplicateManager(false)} />}
      {showAttachmentManager && featureFlags.attachmentManager && <AttachmentManagerDialog notes={notes} attachments={attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })} indexing={attachmentIndexing} onOpenNote={id => { setShowAttachmentManager(false); openLinkedNote(id) }} onPreview={attachment => setPreviewAttachmentId(attachment.id)} onDelete={attachment => void deleteAttachment(attachment)} onIndex={featureFlags.attachmentIndex ? attachment => void indexAttachment(attachment) : undefined} onClose={() => setShowAttachmentManager(false)} />}
      {toast && <div className="app-toast" role="status"><Check size={16} />{toast}</div>}
      {mobileDrawer !== 'none' && <button className="drawer-scrim" aria-label="Zamknij menu" onClick={() => setMobileDrawer('none')} />}
    </main>
  )
}

export default App
