import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Archive, ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, BookmarkPlus, Brain, CalendarDays, Check, CheckSquare2, ChevronDown, ChevronRight, ChevronUp, Clock3, Code2, Columns3, Command, Copy, Eye, FilePlus2, FileText, Folder, FolderHeart, Heart, History, Import, LayoutTemplate,
  CircleHelp, LockKeyhole, LoaderCircle, Menu, MessageCircle, MoreVertical, Network, Paperclip, Palette, PanelLeft, Pencil, Plus, Puzzle, Repeat2, Search, Settings2, SlidersHorizontal, Sparkles, Star, Tag, ThumbsDown, ThumbsUp, Trash2, X,
} from 'lucide-react'
import type { ArchiveTransferProgress, ParsedArchive } from './archive'
import { markdownToNote, starterAssets, starterNotes } from './content'
import { AppLockDialog } from './AppLockDialog'
import type { AllNotesPreset } from './AllNotesPage'
import type { NoteWorkflowStatus } from './NoteBoardDialog'
import type { FlashcardAiAction, FlashcardAiTaskNotice } from './FlashcardsPage'
import type { AiNoteTool } from './AiNoteToolsDialog'
import type { AiTaskQueueItem } from './AiTaskQueueDialog'
import type { PaletteCommand } from './CommandPaletteDialog'
import { normalizeSearchText, searchNotes, searchQueryNeedsContent } from './noteSearch'
import { nextTaskDate, parseTasks, updateTaskLine, type ParsedTask, type TaskPatch } from './knowledge'
import { resolveWikiTarget, wikiTargets } from './knowledge'
import { embedOllamaTexts, imageAttachmentToPngBase64, listOllamaModels, streamOllamaMessageWithFallback, transcribeLocalAudio, type OllamaModel } from './ollama'
import { checkpointReviewSession } from './reviews'
import { archiveAttachment, deleteAutoBackup, getAssets, getAttachmentHistory, getAttachments, getAutoBackups, getFlashcards, getFlashcardTrash, getFolderColors, getFolders, getNoteHeaders, getNoteTemplates, getNoteVersions, getNotes, getOrganizationSettings, getReviewSessions, getSavedSearches, getTrashEntries, hasInitialized, loadNoteContent, markInitialized, readAutoBackup, removeAssetsForNote, removeAttachmentsForNote, removeAttachment, removeFolderFromDisk, removeNote, restoreArchivedAttachment, saveArchivedAttachment, saveAsset, saveAttachment, saveAttachmentMetadata, saveAttachmentTranscript as persistAttachmentTranscript, saveAutoBackup, saveFlashcardsAndTrash, saveFolderColors, saveFolders, saveNote, saveNoteTemplates, saveNoteVersion, saveNoteVersions, saveOrganizationSettings, saveReviewSessions, saveSavedSearches, saveTrashEntries, storageLocationLabel, usesNativeFiles } from './storage'
import type { AutoBackupInfo } from './storage'
import { DEFAULT_AI_PREFERENCES, type AiDiagnostic, type AiOutputRating, type AiPreferences, type AiTaskType, type Flashcard, type FlashcardImageOcclusion, type FlashcardKind, type FlashcardTrashEntry, type Note, type NoteAsset, type NoteAttachment, type NoteAttachmentHistory, type NoteAttachmentReference, type NoteTemplate, type NoteVersion, type OrganizationSettings, type ReviewSession, type SavedSearch, type SavedWorkspaceLayout, type TrashEntry } from './types'
import { readFeatureFlags, type FeatureFlags, type FeatureId } from './features'
import { dispatchAiReplaceSelection, dispatchWikiEmbedInsert, dispatchWikiLinkInsert, replaceWikiLinkTarget } from './wikiLinks'
import { fileFingerprint } from './fileFingerprint'
import { reviewFlashcard, type FlashcardGrade, type FlashcardReviewMeta } from './flashcards'
import { VirtualizedList } from './VirtualizedList'
import './App.css'

type Filter = 'all' | 'favorites' | string
type NoteDisplayMode = 'full' | 'names-tags' | 'names'
type EntryTarget = { kind: 'folder'; path: string } | { kind: 'note'; id: string }
type FolderPanelEntry = { kind: 'folder'; path: string; depth: number } | { kind: 'note'; note: Note; depth: number } | { kind: 'more'; folder: string; depth: number; remaining: number }

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
async function processBatches<T>(items: T[], run: (item: T) => Promise<unknown>, onBatch?: (completed: number, current: T) => void, batchSize = 6): Promise<void> {
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize)
    await Promise.all(batch.map(run))
    onBatch?.(offset + batch.length, batch[batch.length - 1])
    if (offset + batch.length < items.length) await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  }
}
function normalizeAiText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').trim()
}
type DeleteTarget = EntryTarget & { label: string; noteCount: number }
type EntryColor = { value: string; label: string }
type EntryPointerDrag = { target: EntryTarget; label: string; pointerId: number; startX: number; startY: number; started: boolean }
type EntryDropDestination = { kind: 'folder'; path: string } | { kind: 'grid-slot'; noteId: string }

type AiQueueJob = { id: string; label: string; run: (signal: AbortSignal) => Promise<unknown>; controller?: AbortController; resolve: (value: unknown) => void; reject: (error: Error) => void; cancelled?: boolean }
type EntryDragVisual = { target: EntryTarget; label: string; x: number; y: number; dropFolder: string | null; gridSlotId: string | null; canDropToGrid: boolean }
type FlashcardGenerationScope = { kind: 'selection'; noteId: string; text: string; label: string } | { kind: 'pdf-page'; noteId: string; attachmentId: string; page: number; label: string }
type NoteRecoveryDraft = { note: Note; capturedAt: number }
type ArchiveTaskState = { id: number; action: 'import' | 'export'; title: string; phase: string; percent: number; completed: number; total: number; current: string; counterLabel: string; expanded: boolean; state: 'running' | 'done' | 'error'; detail: string }
type ArchiveApplyProgress = { phase: string; completed: number; total: number; current: string }
type SemanticDocumentCacheEntry = { model: string; title: string; folder: string; content: string; tags: string[]; attachments: NoteAttachment[]; text: string; vector?: number[] }
const EMPTY_NOTE_ASSETS: NoteAsset[] = []
const EMPTY_NOTE_ATTACHMENTS: NoteAttachment[] = []

const REVIEW_SESSIONS_OVERVIEW_ID = '__no_tie_review_sessions_overview__'
const SAVED_SEARCHES_PAGE_ID = '__no_tie_saved_searches_page__'
const NOTE_TEMPLATES_PAGE_ID = '__no_tie_note_templates_page__'
const ALL_NOTES_PAGE_ID = '__no_tie_all_notes_page__'
const FLASHCARDS_PAGE_ID = '__no_tie_flashcards_page__'
const TASKS_PAGE_ID = '__no_tie_tasks_page__'
const PROJECTS_PAGE_ID = '__no_tie_projects_page__'
const ATTACHMENTS_PAGE_ID = '__no_tie_attachments_page__'
const NOTE_BOARD_PAGE_ID = '__no_tie_note_board_page__'
const LINK_AUDIT_PAGE_ID = '__no_tie_link_audit_page__'
const COLLECTIONS_PAGE_ID = '__no_tie_collections_page__'
const MAX_NOTE_GRID_SIZE = 4
const NOTE_RECOVERY_DRAFT_KEY = 'no-tie-recovery-draft'

type NavigationSnapshot = {
  selectedId: string; activeFilter: Filter; activeReviewSessionId: string; showCreateNotePage: boolean
  createNoteInitialFolder: string; allNotesPreset: AllNotesPreset; allNotesFolderPreset: string
  noteGridEnabled: boolean; noteGridIds: string[]; editorMode: 'rendered' | 'source'
  showLibrary: boolean; showMainSidebar: boolean; showFoldersPanel: boolean; showChat: boolean
}

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
const FlashcardsPage = lazy(() => import('./FlashcardsPage').then(module => ({ default: module.FlashcardsPage })))
const FlashcardAiTaskResultContent = lazy(() => import('./FlashcardsPage').then(module => ({ default: module.FlashcardAiTaskResultContent })))
const ChatPanel = lazy(() => import('./ChatPanel').then(module => ({ default: module.ChatPanel })))
const TaskManagerPage = lazy(() => import('./TaskManagerDialog').then(module => ({ default: module.TaskManagerPage })))
const SavedSearchDialog = lazy(() => import('./SavedSearchDialog').then(module => ({ default: module.SavedSearchDialog })))
const TemplateManagerDialog = lazy(() => import('./TemplateManagerDialog').then(module => ({ default: module.TemplateManagerDialog })))
const CreateNotePage = lazy(() => import('./CreateNotePage').then(module => ({ default: module.CreateNotePage })))
const AllNotesPage = lazy(() => import('./AllNotesPage').then(module => ({ default: module.AllNotesPage })))
const CollectionsPage = lazy(() => import('./CollectionsPage').then(module => ({ default: module.CollectionsPage })))
const NoteLinkAuditPage = lazy(() => import('./NoteLinkAuditPage').then(module => ({ default: module.NoteLinkAuditPage })))
const NoteGridView = lazy(() => import('./NoteGridView').then(module => ({ default: module.NoteGridView })))
const AttachmentManagerPage = lazy(() => import('./AttachmentManagerDialog').then(module => ({ default: module.AttachmentManagerPage })))
const NoteBoardPage = lazy(() => import('./NoteBoardDialog').then(module => ({ default: module.NoteBoardPage })))
const ProjectDashboardPage = lazy(() => import('./ProjectDashboardDialog').then(module => ({ default: module.ProjectDashboardPage })))
const ReviewSessionView = lazy(() => import('./ReviewSessionView').then(module => ({ default: module.ReviewSessionView })))
const ReviewSessionsOverview = lazy(() => import('./ReviewSessionsOverview').then(module => ({ default: module.ReviewSessionsOverview })))
const ReviewSessionDialog = lazy(() => import('./ReviewSessionDialog').then(module => ({ default: module.ReviewSessionDialog })))
const NotePropertiesEditor = lazy(() => import('./NotePropertiesEditor').then(module => ({ default: module.NotePropertiesEditor })))
const MarkdownSourceEditor = lazy(() => import('./MarkdownSourceEditor').then(module => ({ default: module.MarkdownSourceEditor })))
const NoteConnections = lazy(() => import('./NoteConnections').then(module => ({ default: module.NoteConnections })))
const NoteAttachmentsPanel = lazy(() => import('./NoteAttachmentsPanel').then(module => ({ default: module.NoteAttachmentsPanel })))
const NoteHistoryDialog = lazy(() => import('./NoteHistoryDialog').then(module => ({ default: module.NoteHistoryDialog })))
const NoteLinkDialog = lazy(() => import('./NoteLinkDialog').then(module => ({ default: module.NoteLinkDialog })))
const NoteSearchDialog = lazy(() => import('./NoteSearchDialog').then(module => ({ default: module.NoteSearchDialog })))
const KnowledgeGraphDialog = lazy(() => import('./KnowledgeGraphDialog').then(module => ({ default: module.KnowledgeGraphDialog })))
const DailyNotesDialog = lazy(() => import('./DailyNotesDialog').then(module => ({ default: module.DailyNotesDialog })))
const AttachmentPreviewDialog = lazy(() => import('./AttachmentPreviewDialog').then(module => ({ default: module.AttachmentPreviewDialog })))
const HelpDialog = lazy(() => import('./HelpDialog').then(module => ({ default: module.HelpDialog })))
const BackupTrashDialog = lazy(() => import('./BackupTrashDialog').then(module => ({ default: module.BackupTrashDialog })))
const SelectedTextFlashcardDialog = lazy(() => import('./SelectedTextFlashcardDialog').then(module => ({ default: module.SelectedTextFlashcardDialog })))
const CommandPaletteDialog = lazy(() => import('./CommandPaletteDialog').then(module => ({ default: module.CommandPaletteDialog })))
const WorkspaceLayoutsDialog = lazy(() => import('./WorkspaceLayoutsDialog').then(module => ({ default: module.WorkspaceLayoutsDialog })))
const AiSelectionEditDialog = lazy(() => import('./AiSelectionEditDialog').then(module => ({ default: module.AiSelectionEditDialog })))
const FeatureManagerDialog = lazy(() => import('./FeatureManagerDialog').then(module => ({ default: module.FeatureManagerDialog })))
const DuplicateManagerDialog = lazy(() => import('./DuplicateManagerDialog').then(module => ({ default: module.DuplicateManagerDialog })))
const NoteReminderDialog = lazy(() => import('./NoteReminderDialog').then(module => ({ default: module.NoteReminderDialog })))
const AiNoteToolsDialog = lazy(() => import('./AiNoteToolsDialog').then(module => ({ default: module.AiNoteToolsDialog })))
const AiWorkspaceDialog = lazy(() => import('./AiWorkspaceDialog').then(module => ({ default: module.AiWorkspaceDialog })))
const AiTaskQueueDialog = lazy(() => import('./AiTaskQueueDialog').then(module => ({ default: module.AiTaskQueueDialog })))

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

const noteExcerptCache = new WeakMap<Note, string>()

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

function cachedNoteExcerpt(note: Note) {
  const cached = noteExcerptCache.get(note)
  if (cached !== undefined) return cached
  const value = excerpt(note.content)
  noteExcerptCache.set(note, value)
  return value
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
function formatFlashcardAiDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')
  const hours = Math.floor(totalSeconds / 3600)
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

function FlashcardAiTaskDuration({ startedAt, finishedAt }: { startedAt: number; finishedAt?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (finishedAt !== undefined) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [finishedAt])
  return <>{formatFlashcardAiDuration((finishedAt ?? now) - startedAt)}</>
}
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
  const hydratedNoteCache = useRef(new Map<string, { header: Note; content: string; note: Note }>())
  const [taskReminderTasksByNote, setTaskReminderTasksByNote] = useState<Map<string, ParsedTask[]>>(() => new Map())
  const taskReminderTasksRef = useRef(taskReminderTasksByNote)
  const [taskReminderIndexReady, setTaskReminderIndexReady] = useState(false)
  const [noteBodies, setNoteBodies] = useState<Map<string, string>>(() => new Map())
  const noteBodiesRef = useRef(noteBodies)
  const noteBodyLoads = useRef(new Map<string, Promise<string>>())
  const pendingContentPatches = useRef(new Map<string, Note>())
  const pendingContentPreviousBodies = useRef(new Map<string, string>())
  const contentPatchTimers = useRef(new Map<string, number>())
  const seenNoteObjects = useRef(new Map<string, Note>())
  const pendingNoteSaves = useRef(new Map<string, Note>())
  const noteSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const organizationIndexSnapshot = useRef<{ noteFolders: Map<string, string>; folderRegistry: string[] | null }>({ noteFolders: new Map(), folderRegistry: null })
  const noteHistory = useRef<Note[]>([])
  const noteRedoHistory = useRef<Note[]>([])
  const historyNoteId = useRef('')
  const undoNoteAction = useRef<() => void>(() => {})
  const redoNoteAction = useRef<() => void>(() => {})
  const [assets, setAssets] = useState<NoteAsset[]>([])
  const [attachments, setAttachments] = useState<NoteAttachment[]>([])
  const [previewAttachmentId, setPreviewAttachmentId] = useState('')
  const [previewAttachmentPage, setPreviewAttachmentPage] = useState(1)
  const [previewAttachmentFragment, setPreviewAttachmentFragment] = useState('')
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [templates, setTemplates] = useState<NoteTemplate[]>(defaultTemplates)
  const [showDailyNotes, setShowDailyNotes] = useState(false)
  const [showAiEdit, setShowAiEdit] = useState(false)
  const [aiNoteTool, setAiNoteTool] = useState<AiNoteTool | null>(null)
  const [aiNoteGeneratorMinimized, setAiNoteGeneratorMinimized] = useState(false)
  const [flashcardGenerationScope, setFlashcardGenerationScope] = useState<FlashcardGenerationScope | null>(null)
  const [selectedTextFlashcard, setSelectedTextFlashcard] = useState<{ noteId: string; text: string } | null>(null)
  const [showKnowledgeGraph, setShowKnowledgeGraph] = useState(false)
  const [noteConnectionsOpen, setNoteConnectionsOpen] = useState(false)
  const [showDuplicateManager, setShowDuplicateManager] = useState(false)
  const [showNoteReminder, setShowNoteReminder] = useState(false)
  const [attachmentIndexing, setAttachmentIndexing] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(() => readFeatureFlags())
  const [showFeatureManager, setShowFeatureManager] = useState(false)
  const [showLockSetup, setShowLockSetup] = useState(false)
  const [hasLockPin, setHasLockPin] = useState(() => Boolean(localStorage.getItem('no-tie-app-lock-hash')))
  const [appLocked, setAppLocked] = useState(() => Boolean(localStorage.getItem('no-tie-app-lock-hash') && localStorage.getItem('no-tie-app-locked') === 'true'))
  const [selectedId, setSelectedId] = useState('')
  const [noteGridEnabled, setNoteGridEnabled] = useState(false)
  const [noteGridIds, setNoteGridIds] = useState<string[]>([])
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [allNotesPreset, setAllNotesPreset] = useState<AllNotesPreset>('all')
  const [allNotesPresetRevision, setAllNotesPresetRevision] = useState(0)
  const [allNotesFolderPreset, setAllNotesFolderPreset] = useState('')
  const [query, setQuery] = useState('')
  const [allNotesSearchNeedsContent, setAllNotesSearchNeedsContent] = useState(false)
  const [searchContentByNote, setSearchContentByNote] = useState<Map<string, string>>(() => new Map())
  const [searchNormalizedContentByNote, setSearchNormalizedContentByNote] = useState<Map<string, string>>(() => new Map())
  const [searchIndexProgress, setSearchIndexProgress] = useState<{ done: number; total: number } | null>(null)
  const [searchTag, setSearchTag] = useState('')
  const [searchFolder, setSearchFolder] = useState('')
  const [showSearchFilters, setShowSearchFilters] = useState(false)
  const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(() => localStorage.getItem('no-tie-semantic-search') === 'true')
  const [semanticScores, setSemanticScores] = useState<Record<string, number>>({})
  const [semanticSearchBusy, setSemanticSearchBusy] = useState(false)
  const [semanticSearchError, setSemanticSearchError] = useState('')
  const semanticDocumentCache = useRef(new Map<string, SemanticDocumentCacheEntry>())
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([])
  const [noteListLimit, setNoteListLimit] = useState(100)
  const [folderNoteLimits, setFolderNoteLimits] = useState<Record<string, number>>({})
  const [bulkTargetFolder, setBulkTargetFolder] = useState('')
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [showQuickSearch, setShowQuickSearch] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showWorkspaceLayouts, setShowWorkspaceLayouts] = useState(false)
  const [collectionFocusId, setCollectionFocusId] = useState('')
  const [quickSearchActiveIndex, setQuickSearchActiveIndex] = useState(0)
  const [showNoteLinkDialog, setShowNoteLinkDialog] = useState(false)
  const [showNoteEmbedDialog, setShowNoteEmbedDialog] = useState(false)
  const [noteActionTargetId, setNoteActionTargetId] = useState('')
  const [aiEditTarget, setAiEditTarget] = useState<{ noteId: string; text: string } | null>(null)
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
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'notes' | 'sidebar' | 'folders'>('none')
  useEffect(() => {
    const closeCompactDrawerOnDesktop = () => {
      if (window.innerWidth > 1024) setMobileDrawer('none')
    }
    window.addEventListener('resize', closeCompactDrawerOnDesktop)
    return () => window.removeEventListener('resize', closeCompactDrawerOnDesktop)
  }, [])
  const [tagInput, setTagInput] = useState('')
  const [folderRegistry, setFolderRegistry] = useState<string[]>([])
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings>({ noteOrder: [], folderOrder: [], folderTemplateDefaults: {}, workspaces: [], collections: [], aiPreferences: DEFAULT_AI_PREFERENCES })
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set())
  const [folderColors, setFolderColors] = useState<Record<string, string>>({})
  const [reviewSessions, setReviewSessions] = useState<ReviewSession[]>([])
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([])
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [flashcardTrash, setFlashcardTrash] = useState<FlashcardTrashEntry[]>([])
  const [flashcardAiTasks, setFlashcardAiTasks] = useState<FlashcardAiTaskNotice[]>([])
  const [flashcardAiRatingDrafts, setFlashcardAiRatingDrafts] = useState<Record<number, string>>({})
  const [flashcardAiRatedTasks, setFlashcardAiRatedTasks] = useState<Record<number, boolean>>({})
  const showingFlashcardsPageRef = useRef(false)
  const nextFlashcardAiTaskId = useRef(0)
  const [autoBackups, setAutoBackups] = useState<AutoBackupInfo[]>([])
  const [showBackupTrash, setShowBackupTrash] = useState(false)
  const [recoveryDraft, setRecoveryDraft] = useState<NoteRecoveryDraft | null>(null)
  const [showCreateNotePage, setShowCreateNotePage] = useState(false)
  const [createNoteInitialFolder, setCreateNoteInitialFolder] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [libraryPayloadsReady, setLibraryPayloadsReady] = useState(false)
  const automaticBackupRunning = useRef(false)
  const [activeReviewSessionId, setActiveReviewSessionId] = useState('')
  const [showReviewSessionDialog, setShowReviewSessionDialog] = useState(false)
  const [editingReviewSessionId, setEditingReviewSessionId] = useState('')
  const [editorSelection, setEditorSelection] = useState({ noteId: '', mode: 'rendered' as 'rendered' | 'source', text: '' })
  const [entryDragVisual, setEntryDragVisual] = useState<EntryDragVisual | null>(null)
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  const [toast, setToast] = useState('')
  const [archiveTask, setArchiveTask] = useState<ArchiveTaskState | null>(null)
  const archiveTaskSequence = useRef(0)
  const [showMainSidebar, setShowMainSidebar] = useState(() => localStorage.getItem('no-tie-main-sidebar-visible') !== 'false')
  const [showFoldersPanel, setShowFoldersPanel] = useState(() => localStorage.getItem('no-tie-folders-panel-visible') !== 'false')
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
  const [showAiWorkspace, setShowAiWorkspace] = useState(false)
  const [showAiTaskQueue, setShowAiTaskQueue] = useState(false)
  const [aiTaskQueue, setAiTaskQueue] = useState<AiTaskQueueItem[]>([])
  const aiTaskJobs = useRef<AiQueueJob[]>([])
  const aiQueueRunning = useRef(false)
  const activeAiTaskJob = useRef<AiQueueJob | null>(null)
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
  const navigationStack = useRef<NavigationSnapshot[]>([])
  const navigationIndex = useRef(-1)
  const navigationRestorePending = useRef(false)
  const [navigationPosition, setNavigationPosition] = useState(-1)
  const persistentVersionTimers = useRef(new Map<string, number>())
  const historyDialogNoteIdRef = useRef('')
  const entryPointerDrag = useRef<EntryPointerDrag | null>(null)
  const entryDropTarget = useRef<HTMLElement | null>(null)
  const suppressEntryClick = useRef(false)
  const entryDropAction = useRef<(target: EntryTarget, destination: EntryDropDestination) => void>(() => {})
  const entryDragRenderFrame = useRef<number | null>(null)
  const nextEntryDragVisual = useRef<EntryDragVisual | null>(null)

  const aiPreferences = organizationSettings.aiPreferences ?? DEFAULT_AI_PREFERENCES
  function updateAiPreferences(preferences: AiPreferences) {
    setOrganizationSettings(current => ({ ...current, aiPreferences: preferences }))
  }
  function aiCanAccessNote(note: Note) {
    if (!aiPreferences.folderAccessRestricted) return true
    return aiPreferences.allowedFolders.some(folder => folder === note.folder || (folder !== '' && note.folder.startsWith(`${folder}/`)))
  }
  const aiAccessibleNoteIds = useMemo(() => new Set(notes.filter(aiCanAccessNote).map(note => note.id)), [notes, aiPreferences.folderAccessRestricted, aiPreferences.allowedFolders])

  function updateAiTask(id: string, update: Partial<AiTaskQueueItem>) {
    setAiTaskQueue(current => current.map(task => task.id === id ? { ...task, ...update } : task))
  }

  async function drainAiTaskQueue() {
    if (aiQueueRunning.current) return
    aiQueueRunning.current = true
    while (aiTaskJobs.current.length) {
      const job = aiTaskJobs.current.shift()!
      if (job.cancelled) continue
      activeAiTaskJob.current = job
      const controller = new AbortController()
      job.controller = controller
      const startedAt = Date.now()
      updateAiTask(job.id, { status: 'running', startedAt })
      try {
        const result = await job.run(controller.signal)
        updateAiTask(job.id, { status: job.cancelled ? 'cancelled' : 'completed', finishedAt: Date.now() })
        job.resolve(result)
      } catch (error) {
        const detail = errorMessage(error, 'Zadanie AI nie powiodło się.')
        updateAiTask(job.id, { status: job.cancelled || controller.signal.aborted ? 'cancelled' : 'failed', finishedAt: Date.now(), error: job.cancelled || controller.signal.aborted ? undefined : detail })
        job.reject(new Error(job.cancelled || controller.signal.aborted ? 'Zadanie AI anulowano.' : detail))
      }
      activeAiTaskJob.current = null
    }
    aiQueueRunning.current = false
  }

  function runAiTask<T = void>(label: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const id = crypto.randomUUID()
    setAiTaskQueue(current => [...current, { id, label, status: 'queued' as const, createdAt: Date.now() }].slice(-40))
    return new Promise<T>((resolve, reject) => {
      aiTaskJobs.current.push({ id, label, run: async signal => run(signal), resolve: value => resolve(value as T), reject })
      void drainAiTaskQueue()
    })
  }

  function moveAiTask(id: string, direction: -1 | 1) {
    const jobs = aiTaskJobs.current
    const index = jobs.findIndex(job => job.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= jobs.length) return
    ;[jobs[index], jobs[target]] = [jobs[target]!, jobs[index]!]
    const queueIndex = new Map(jobs.map((job, jobIndex) => [job.id, jobIndex]))
    setAiTaskQueue(current => [...current].sort((a, b) => {
      const aQueued = queueIndex.get(a.id)
      const bQueued = queueIndex.get(b.id)
      if (aQueued !== undefined && bQueued !== undefined) return aQueued - bQueued
      if (a.status === 'running') return -1
      if (b.status === 'running') return 1
      if (aQueued !== undefined) return -1
      if (bQueued !== undefined) return 1
      return b.createdAt - a.createdAt
    }))
  }

  function cancelAiTask(id: string) {
    const running = aiTaskQueue.find(task => task.id === id && task.status === 'running')
    if (running) {
      const job = activeAiTaskJob.current?.id === id ? activeAiTaskJob.current : undefined
      if (job) { job.cancelled = true; job.controller?.abort() }
      return
    }
    const index = aiTaskJobs.current.findIndex(job => job.id === id)
    if (index < 0) return
    const [job] = aiTaskJobs.current.splice(index, 1)
    if (job) { job.cancelled = true; job.reject(new Error('Zadanie AI anulowano.')) }
    updateAiTask(id, { status: 'cancelled', finishedAt: Date.now() })
  }

  function saveAiDiagnostic(diagnostic: AiDiagnostic) {
    updateAiPreferences({ ...aiPreferences, lastDiagnostic: diagnostic })
  }

  function rateAiOutput(task: AiOutputRating['task'], rating: AiOutputRating['rating'], comment: string) {
    updateAiPreferences({ ...aiPreferences, ratings: [...aiPreferences.ratings, { task, rating, comment: comment.trim().slice(0, 1_000), createdAt: Date.now() }].slice(-100) })
  }

  function reportDiskSaveError(error: unknown) {
    setSaved(false)
    const detail = errorMessage(error, 'Spróbuj ponownie.')
    setToast(`Nie udało się zapisać zmian: ${detail}`)
    window.setTimeout(() => setToast(''), 5000)
  }

  useEffect(() => { localStorage.setItem('no-tie-feature-modules', JSON.stringify(featureFlags)) }, [featureFlags])
  useEffect(() => { if (aiNoteTool !== 'flashcards') setAiNoteGeneratorMinimized(false) }, [aiNoteTool])

  function toggleFeature(id: FeatureId, enabled: boolean) {
    setFeatureFlags(current => ({ ...current, [id]: enabled }))
    if (id === 'bulkActions' && !enabled) { setBulkSelectMode(false); setBulkSelectedIds([]) }
    if (id === 'smartFolders' && !enabled && activeFilter.startsWith('smart:')) { setActiveFilter('all'); setQuery('') }
    if (!enabled) {
      if (id === 'duplicateManager') setShowDuplicateManager(false)
      if ((id === 'attachmentManager' && activeReviewSessionId === ATTACHMENTS_PAGE_ID) || (id === 'noteBoard' && activeReviewSessionId === NOTE_BOARD_PAGE_ID) || (id === 'projectDashboard' && activeReviewSessionId === PROJECTS_PAGE_ID)) setActiveReviewSessionId('')
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
        let storedNotes = await getNoteHeaders()
        const [storedSearches, storedTemplates, storedOrganization, loadedFolders, storedFolderColors, storedReviewSessions, storedTrash, storedFlashcards, storedFlashcardTrash] = await Promise.all([
          getSavedSearches(), getNoteTemplates(), getOrganizationSettings(), getFolders(), getFolderColors(), getReviewSessions(), getTrashEntries(), getFlashcards(), getFlashcardTrash(),
        ])
        let initialAssets: NoteAsset[] = []
        let storedFolders = loadedFolders
        if (!await hasInitialized()) {
          if (!storedNotes.length) {
            await Promise.all(starterNotes.map(saveNote))
            await Promise.all(starterAssets.map(saveAsset))
            storedNotes = starterNotes
            initialAssets = starterAssets
          }
          await markInitialized()
        }
        let pendingRecovery: NoteRecoveryDraft | null = null
        try {
          const storedDraft = localStorage.getItem(NOTE_RECOVERY_DRAFT_KEY)
          if (storedDraft) {
            const candidate = JSON.parse(storedDraft) as NoteRecoveryDraft
            const savedNote = storedNotes.find(note => note.id === candidate.note?.id)
            const validDraft = candidate.note && typeof candidate.note.id === 'string' && typeof candidate.note.content === 'string' && typeof candidate.note.updatedAt === 'number' && Number.isFinite(candidate.capturedAt)
            if (validDraft && savedNote && candidate.note.updatedAt > savedNote.updatedAt) pendingRecovery = candidate
            else if (!savedNote) localStorage.removeItem(NOTE_RECOVERY_DRAFT_KEY)
          }
        } catch {
          try { localStorage.removeItem(NOTE_RECOVERY_DRAFT_KEY) } catch { /* Browser storage may be disabled. */ }
        }
        if (!cancelled) {
          storedFolders = [...new Set(storedFolders)]
          setFolderRegistry(storedFolders)
          setFolderColors(storedFolderColors)
          setReviewSessions(storedReviewSessions)
          setTrashEntries(storedTrash.filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000))
          setFlashcards(storedFlashcards.map(card => {
            const note = resolveWikiTarget(storedNotes, card.noteId)
            return note && note.id !== card.noteId ? { ...card, noteId: note.id } : card
          }))
          setFlashcardTrash(storedFlashcardTrash)
          setAttachments([])
          setSavedSearches(storedSearches)
          setTemplates(storedTemplates.length ? storedTemplates : defaultTemplates)
          setOrganizationSettings(storedOrganization)
          storedNotes.sort((a, b) => b.updatedAt - a.updatedAt)
          notesRef.current = storedNotes
          backupSnapshotRef.current = { ...backupSnapshotRef.current, notes: storedNotes, assets: initialAssets, attachments: [] }
          historyNoteId.current = storedNotes[0]?.id ?? ''
          noteHistory.current = storedNotes[0] ? [copyNote(storedNotes[0])] : []
          seenNoteObjects.current = new Map(storedNotes.map(note => [note.id, note]))
          setNotes(storedNotes)
          setAssets(initialAssets)
          setSelectedId(storedNotes[0]?.id ?? '')
          setRecoveryDraft(pendingRecovery)
          setReady(true)
          void Promise.all([getAssets(), getAttachments()]).then(([loadedAssets, loadedAttachments]) => {
            if (cancelled) return
            const activeNoteIds = new Set(notesRef.current.map(note => note.id))
            const mergeActiveItems = <T extends { id: string; noteId: string }>(loaded: T[], current: T[]) => {
              const merged = new Map<string, T>()
              for (const item of loaded) if (activeNoteIds.has(item.noteId)) merged.set(item.id, item)
              for (const item of current) if (activeNoteIds.has(item.noteId)) merged.set(item.id, item)
              return [...merged.values()]
            }
            const currentSnapshot = backupSnapshotRef.current
            const nextAssets = mergeActiveItems(loadedAssets, [...initialAssets, ...currentSnapshot.assets])
            const nextAttachments = mergeActiveItems(loadedAttachments, currentSnapshot.attachments)
            backupSnapshotRef.current = { ...currentSnapshot, assets: nextAssets, attachments: nextAttachments }
            setAssets(nextAssets)
            setAttachments(nextAttachments)
            setLibraryPayloadsReady(true)
          }).catch(error => {
            if (!cancelled) {
              setLibraryPayloadsReady(true)
              reportDiskSaveError(error)
            }
          })
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
    if (!showBackupTrash) return
    let cancelled = false
    setBackupsLoading(true)
    void getAutoBackups().then(backups => {
      if (!cancelled) setAutoBackups(backups)
    }).catch(reportDiskSaveError).finally(() => {
      if (!cancelled) setBackupsLoading(false)
    })
    return () => { cancelled = true }
  }, [showBackupTrash])

  useEffect(() => {
    if (!ready || !notes.length) return
    const currentIds = new Set(notes.map(note => note.id))
    for (const id of seenNoteObjects.current.keys()) {
      if (currentIds.has(id)) continue
      seenNoteObjects.current.delete(id)
      pendingNoteSaves.current.delete(id)
    }
    for (const note of notes) {
      if (seenNoteObjects.current.get(note.id) === note) continue
      seenNoteObjects.current.set(note.id, note)
      const body = noteBodiesRef.current.get(note.id)
      pendingNoteSaves.current.set(note.id, note.contentLoaded === false && body !== undefined ? { ...note, content: body, contentLoaded: true } : note)
    }
    if (!pendingNoteSaves.current.size) return
    const timeout = window.setTimeout(() => {
      const batch = [...pendingNoteSaves.current.values()]
      pendingNoteSaves.current.clear()
      noteSaveQueue.current = noteSaveQueue.current.catch(() => {}).then(async () => {
        for (let offset = 0; offset < batch.length; offset += 12) {
          await Promise.all(batch.slice(offset, offset + 12).map(saveNote))
          if (offset + 12 < batch.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        }
        if (!pendingNoteSaves.current.size) setSaved(true)
      }).catch(reportDiskSaveError)
    }, 650)
    return () => window.clearTimeout(timeout)
  }, [notes, ready])

  const folders = useMemo(() => {
    const order = new Map(organizationSettings.folderOrder.map((folder, index) => [folder, index]))
    return [...new Set([...folderRegistry, ...notes.flatMap(note => folderParents(note.folder))])].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b, 'pl'))
  }, [folderRegistry, notes, organizationSettings.folderOrder])
  const foldersByParent = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const folder of folders) {
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
      const children = groups.get(parent)
      if (children) children.push(folder)
      else groups.set(parent, [folder])
    }
    return groups
  }, [folders])
  const folderSiblingIndexes = useMemo(() => {
    const indexes = new Map<string, number>()
    for (const siblings of foldersByParent.values()) siblings.forEach((folder, index) => indexes.set(folder, index))
    return indexes
  }, [foldersByParent])
  const noteOrderIndex = useMemo(() => new Map(organizationSettings.noteOrder.map((id, index) => [id, index])), [organizationSettings.noteOrder])
  const notesByFolder = useMemo(() => {
    const groups = new Map<string, Note[]>()
    for (const note of notes) {
      const group = groups.get(note.folder)
      if (group) group.push(note)
      else groups.set(note.folder, [note])
    }
    for (const group of groups.values()) group.sort((a, b) => (noteOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (noteOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'pl'))
    return groups
  }, [notes, noteOrderIndex])
  const folderNoteCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of notes) for (const folder of folderParents(note.folder)) counts.set(folder, (counts.get(folder) ?? 0) + 1)
    return counts
  }, [notes])
  const effectiveFolderColors = useMemo(() => {
    const colors = new Map<string, string | undefined>()
    for (const folder of folders) {
      const parents = folderParents(folder)
      let color: string | undefined
      for (let index = parents.length - 1; index >= 0 && !color; index -= 1) color = folderColors[parents[index]!]
      colors.set(folder, color)
    }
    return colors
  }, [folders, folderColors])
  const folderPanelEntries = useMemo<FolderPanelEntry[]>(() => {
    const entries: FolderPanelEntry[] = []
    const addNotes = (folder: string, depth: number) => {
      const directNotes = notesByFolder.get(folder) ?? []
      const limit = folderNoteLimits[folder] ?? 60
      directNotes.slice(0, limit).forEach(note => entries.push({ kind: 'note', note, depth }))
      if (directNotes.length > limit) entries.push({ kind: 'more', folder, depth, remaining: directNotes.length - limit })
    }
    const addFolders = (parent: string, depth: number) => {
      for (const path of foldersByParent.get(parent) ?? []) {
        entries.push({ kind: 'folder', path, depth })
        if (collapsedFolders.has(path)) continue
        addNotes(path, depth)
        addFolders(path, depth + 1)
      }
    }
    addNotes('', 0)
    addFolders('', 0)
    return entries
  }, [notesByFolder, folderNoteLimits, foldersByParent, collapsedFolders])
  const rootNotes = notesByFolder.get('') ?? []
  const folderKey = folderRegistry.join('\u0000')
  useEffect(() => {
    if (ready) void saveFolders(folderKey ? folderKey.split('\u0000') : []).catch(reportDiskSaveError)
  }, [folderKey, ready])
  useEffect(() => {
    if (ready) void saveFolderColors(folderColors).catch(reportDiskSaveError)
  }, [folderColors, ready])
  useEffect(() => {
    if (ready) void saveReviewSessions(reviewSessions).catch(reportDiskSaveError)
  }, [ready, reviewSessions])
  useEffect(() => { if (ready) void saveFlashcardsAndTrash(flashcards, flashcardTrash).catch(reportDiskSaveError) }, [ready, flashcards, flashcardTrash])
  useEffect(() => { if (ready) void saveTrashEntries(trashEntries).catch(reportDiskSaveError) }, [ready, trashEntries])
  useEffect(() => { if (ready) void saveSavedSearches(savedSearches).catch(reportDiskSaveError) }, [ready, savedSearches])
  useEffect(() => { if (ready) void saveNoteTemplates(templates).catch(reportDiskSaveError) }, [ready, templates])
  useEffect(() => { if (ready) void saveOrganizationSettings(organizationSettings).catch(reportDiskSaveError) }, [ready, organizationSettings])
  useEffect(() => {
    if (!ready) return
    const previous = organizationIndexSnapshot.current
    const noteFolders = new Map(notes.map(note => [note.id, note.folder]))
    const idsChanged = noteFolders.size !== previous.noteFolders.size || [...noteFolders.keys()].some(id => !previous.noteFolders.has(id))
    const noteFoldersChanged = idsChanged || [...noteFolders].some(([id, folder]) => previous.noteFolders.get(id) !== folder)
    const folderRegistryChanged = previous.folderRegistry !== folderRegistry
    if (!idsChanged && !noteFoldersChanged && !folderRegistryChanged) return
    organizationIndexSnapshot.current = { noteFolders, folderRegistry }
    const noteIds = idsChanged ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt).map(note => note.id) : []
    const folderIds = [...new Set([...folderRegistry, ...notes.flatMap(note => folderParents(note.folder))])]
    const folderIdSet = new Set(folderIds)
    const validNoteIds = idsChanged ? new Set(noteIds) : undefined
    setOrganizationSettings(current => {
      const currentNoteOrder = new Set(current.noteOrder)
      const currentFolderOrder = new Set(current.folderOrder)
      const nextNotes = noteIds ? [...current.noteOrder.filter(id => validNoteIds!.has(id)), ...noteIds.filter(id => !currentNoteOrder.has(id))] : current.noteOrder
      const nextFolders = [...current.folderOrder.filter(folder => folderIdSet.has(folder)), ...folderIds.filter(folder => !currentFolderOrder.has(folder))]
      const nextCollections = validNoteIds ? current.collections.map(collection => ({ ...collection, noteIds: collection.noteIds.filter(id => validNoteIds.has(id)) })) : current.collections
      const nextWorkspaces = validNoteIds ? current.workspaces.map(workspace => ({ ...workspace, selectedNoteId: validNoteIds.has(workspace.selectedNoteId) ? workspace.selectedNoteId : '', noteGridIds: workspace.noteGridIds.filter(id => validNoteIds.has(id)) })) : current.workspaces
      const sameArray = (left: string[], right: string[]) => left.length === right.length && left.every((value, index) => value === right[index])
      const unchanged = sameArray(nextNotes, current.noteOrder) && sameArray(nextFolders, current.folderOrder)
        && nextCollections.every((collection, index) => sameArray(collection.noteIds, current.collections[index]?.noteIds ?? []))
        && nextWorkspaces.every((workspace, index) => workspace.selectedNoteId === current.workspaces[index]?.selectedNoteId && sameArray(workspace.noteGridIds, current.workspaces[index]?.noteGridIds ?? []))
      return unchanged ? current : { ...current, noteOrder: nextNotes, folderOrder: nextFolders, collections: nextCollections, workspaces: nextWorkspaces }
    })
  }, [ready, notes, folderRegistry])
  const hasRunningReview = reviewSessions.some(session => session.status === 'running')
  useEffect(() => {
    if (!hasRunningReview) return
    const interval = window.setInterval(() => {
      const now = Date.now()
      setReviewSessions(current => {
        let changed = false
        const next = current.map(session => {
          if (session.status !== 'running') return session
          changed = true
          return checkpointReviewSession(session, now)
        })
        return changed ? next : current
      })
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [hasRunningReview])
  useEffect(() => {
    function clearPointerDrag() {
      entryPointerDrag.current = null
      document.querySelector('.app-shell')?.classList.remove('entry-dragging')
      entryDropTarget.current?.classList.remove('drop-target-active', 'grid-drop-target-active')
      entryDropTarget.current = null
      if (entryDragRenderFrame.current !== null) window.cancelAnimationFrame(entryDragRenderFrame.current)
      entryDragRenderFrame.current = null
      nextEntryDragVisual.current = null
      setEntryDragVisual(null)
    }

    function findDropTarget(x: number, y: number, source: EntryTarget): HTMLElement | null {
      const hit = document.elementFromPoint(x, y)
      if (source.kind === 'note') {
        const gridSlot = hit?.closest<HTMLElement>('[data-note-grid-slot]')
        if (gridSlot) return gridSlot
      }
      return hit?.closest<HTMLElement>('[data-drop-folder]') ?? null
    }

    function onPointerMove(event: PointerEvent) {
      const drag = entryPointerDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      if (event.cancelable) event.preventDefault()
      drag.started = true
      document.querySelector('.app-shell')?.classList.add('entry-dragging')
      const targetElement = findDropTarget(event.clientX, event.clientY, drag.target)
      if (entryDropTarget.current !== targetElement) {
        entryDropTarget.current?.classList.remove('drop-target-active', 'grid-drop-target-active')
        targetElement?.classList.add(targetElement.hasAttribute('data-note-grid-slot') ? 'grid-drop-target-active' : 'drop-target-active')
        entryDropTarget.current = targetElement
      }
      nextEntryDragVisual.current = {
        target: drag.target,
        label: drag.label,
        x: event.clientX,
        y: event.clientY,
        dropFolder: targetElement ? targetElement.dataset.dropFolder ?? '' : null,
        gridSlotId: targetElement?.dataset.noteGridSlot ?? null,
        canDropToGrid: drag.target.kind === 'note' && Boolean(document.querySelector('.note-grid-view')),
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
        const targetElement = findDropTarget(event.clientX, event.clientY, drag.target)
        if (targetElement?.dataset.noteGridSlot && drag.target.kind === 'note') {
          entryDropAction.current(drag.target, { kind: 'grid-slot', noteId: targetElement.dataset.noteGridSlot })
        } else if (targetElement?.hasAttribute('data-drop-folder')) {
          entryDropAction.current(drag.target, { kind: 'folder', path: targetElement.dataset.dropFolder ?? '' })
        }
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
  const selectedNoteHeader = notes.find(note => note.id === selectedId)
  const selectedNote = selectedNoteHeader ? {
    ...selectedNoteHeader,
    content: noteBodies.get(selectedNoteHeader.id) ?? selectedNoteHeader.content,
    contentLoaded: noteBodies.has(selectedNoteHeader.id) || selectedNoteHeader.contentLoaded !== false,
  } : undefined
  const noteIdsSignature = useMemo(() => notes.map(note => note.id).join('\u0000'), [notes])

  function cacheNoteBody(noteId: string, content: string) {
    const next = new Map(noteBodiesRef.current)
    next.delete(noteId)
    next.set(noteId, content)
    const pinned = new Set([selectedId, ...noteGridIds])
    while (next.size > 120) {
      const evict = [...next.keys()].find(id => !pinned.has(id))
      if (!evict) break
      next.delete(evict)
    }
    noteBodiesRef.current = next
    setNoteBodies(next)
  }

  function getNoteBody(noteId: string): Promise<string> {
    const pendingPatch = pendingContentPatches.current.get(noteId)
    if (pendingPatch) return Promise.resolve(pendingPatch.content)
    const cached = noteBodiesRef.current.get(noteId)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = noteBodyLoads.current.get(noteId)
    if (pending) return pending
    const request = loadNoteContent(noteId).finally(() => noteBodyLoads.current.delete(noteId))
    noteBodyLoads.current.set(noteId, request)
    return request
  }

  async function ensureNoteBodies(noteIds: string[]) {
    const ids = [...new Set(noteIds)].filter(id => !noteBodiesRef.current.has(id))
    if (!ids.length) return
    const loaded = await Promise.all(ids.map(async id => [id, await getNoteBody(id)] as const))
    const next = new Map(noteBodiesRef.current)
    const pinned = new Set([selectedId, ...noteGridIds])
    for (const [id, content] of loaded) {
      next.delete(id)
      next.set(id, content)
      if (historyNoteId.current === id) {
        const header = notesRef.current.find(note => note.id === id)
        if (header && noteHistory.current.length <= 1) noteHistory.current = [copyNote({ ...header, content, contentLoaded: true })]
      }
    }
    while (next.size > 120) {
      const evict = [...next.keys()].find(id => !pinned.has(id))
      if (!evict) break
      next.delete(evict)
    }
    noteBodiesRef.current = next
    setNoteBodies(next)
  }

  function ensureNoteBody(noteId: string): Promise<string> {
    return ensureNoteBodies([noteId]).then(() => noteBodiesRef.current.get(noteId) ?? getNoteBody(noteId))
  }

  function publishTaskReminderIndex(next: Map<string, ParsedTask[]>) {
    taskReminderTasksRef.current = next
    setTaskReminderTasksByNote(next)
  }

  function updateTaskReminderIndexForNote(note: Note) {
    const current = taskReminderTasksRef.current
    if (!current.has(note.id)) return
    const next = new Map(current)
    next.set(note.id, parseTasks([{ ...note, contentLoaded: true }]))
    publishTaskReminderIndex(next)
  }

  function updateTaskReminderTitle(noteId: string, title: string) {
    const current = taskReminderTasksRef.current
    const tasks = current.get(noteId)
    if (!tasks) return
    const next = new Map(current)
    next.set(noteId, tasks.map(task => task.noteTitle === title ? task : { ...task, noteTitle: title }))
    publishTaskReminderIndex(next)
  }

  const activeSmartQuery = featureFlags.smartFolders ? savedSearches.find(search => activeFilter === `smart:${search.id}`)?.query ?? '' : ''
  const bodyHeavyView = [LINK_AUDIT_PAGE_ID, COLLECTIONS_PAGE_ID, TASKS_PAGE_ID, PROJECTS_PAGE_ID, NOTE_BOARD_PAGE_ID].includes(activeReviewSessionId)
    || showKnowledgeGraph || showDuplicateManager || showChat || showDailyNotes || noteConnectionsOpen
  const searchNeedsContent = searchQueryNeedsContent(query, featureFlags.advancedQuery)
    || searchQueryNeedsContent(activeSmartQuery, featureFlags.advancedQuery)
    || allNotesSearchNeedsContent
    || bodyHeavyView
    || (featureFlags.semanticSearch && semanticSearchEnabled && Boolean(query.trim()))
  useEffect(() => {
    if (!ready || !searchNeedsContent) {
      setSearchContentByNote(current => current.size ? new Map() : current)
      setSearchNormalizedContentByNote(current => current.size ? new Map() : current)
      setSearchIndexProgress(null)
      return
    }
    let cancelled = false
    const orderedNotes = notesRef.current
    const total = orderedNotes.length
    const indexed = new Map<string, string>()
    const normalized = new Map<string, string>()
    setSearchIndexProgress({ done: 0, total })
    void (async () => {
      for (let offset = 0; offset < orderedNotes.length; offset += 24) {
        const batch = orderedNotes.slice(offset, offset + 24)
        const contents = await Promise.all(batch.map(async note => {
          const pending = pendingContentPatches.current.get(note.id)
          const cached = noteBodiesRef.current.get(note.id)
          return pending?.content ?? cached ?? await getNoteBody(note.id)
        }))
        if (cancelled) return
        batch.forEach((note, index) => {
          const content = contents[index] ?? ''
          indexed.set(note.id, content)
          normalized.set(note.id, normalizeSearchText(content))
        })
        if (offset % 96 === 72 || offset + batch.length === total) setSearchIndexProgress({ done: indexed.size, total })
        if (offset + batch.length < total) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      }
      if (!cancelled) {
        // A note can be edited while the background index is reading later batches.
        // Prefer its latest draft/cache value before publishing the completed index.
        for (const note of orderedNotes) {
          const latestContent = pendingContentPatches.current.get(note.id)?.content ?? noteBodiesRef.current.get(note.id)
          if (latestContent === undefined) continue
          indexed.set(note.id, latestContent)
          normalized.set(note.id, normalizeSearchText(latestContent))
        }
        setSearchContentByNote(indexed)
        setSearchNormalizedContentByNote(normalized)
        setSearchIndexProgress(null)
      }
    })().catch(error => {
      if (!cancelled) {
        setSearchIndexProgress(null)
        reportDiskSaveError(error)
      }
    })
    return () => { cancelled = true }
  }, [ready, searchNeedsContent, noteIdsSignature])

  const [loadingSelectedNote, setLoadingSelectedNote] = useState(false)
  const noteGridSignature = noteGridIds.join('\u0000')
  useEffect(() => {
    if (!ready || !noteGridEnabled) return
    void ensureNoteBodies(noteGridIds).catch(reportDiskSaveError)
  }, [ready, noteGridEnabled, noteGridSignature])
  useEffect(() => {
    if (!ready || !selectedNoteHeader || selectedNoteHeader.contentLoaded !== false || noteBodiesRef.current.has(selectedNoteHeader.id)) return
    let cancelled = false
    setLoadingSelectedNote(true)
    void ensureNoteBody(selectedNoteHeader.id).catch(reportDiskSaveError).finally(() => {
      if (!cancelled) setLoadingSelectedNote(false)
    })
    return () => { cancelled = true }
  }, [ready, selectedNoteHeader?.id])

  const navigationSnapshot = useMemo<NavigationSnapshot>(() => ({ selectedId, activeFilter, activeReviewSessionId, showCreateNotePage, createNoteInitialFolder, allNotesPreset, allNotesFolderPreset, noteGridEnabled, noteGridIds, editorMode, showLibrary, showMainSidebar, showFoldersPanel, showChat }), [selectedId, activeFilter, activeReviewSessionId, showCreateNotePage, createNoteInitialFolder, allNotesPreset, allNotesFolderPreset, noteGridEnabled, noteGridIds, editorMode, showLibrary, showMainSidebar, showFoldersPanel, showChat])
  useEffect(() => {
    if (!ready) return
    if (navigationRestorePending.current) { navigationRestorePending.current = false; return }
    const stack = navigationStack.current
    const current = stack[navigationIndex.current]
    if (current && JSON.stringify(current) === JSON.stringify(navigationSnapshot)) return
    stack.splice(navigationIndex.current + 1)
    stack.push(navigationSnapshot)
    if (stack.length > 80) stack.shift()
    navigationIndex.current = stack.length - 1
    setNavigationPosition(navigationIndex.current)
  }, [ready, navigationSnapshot])

  function applyNavigationSnapshot(snapshot: NavigationSnapshot) {
    navigationRestorePending.current = true
    setSelectedId(snapshot.selectedId)
    setActiveFilter(snapshot.activeFilter)
    setActiveReviewSessionId(snapshot.activeReviewSessionId)
    setShowCreateNotePage(snapshot.showCreateNotePage)
    setCreateNoteInitialFolder(snapshot.createNoteInitialFolder)
    setAllNotesPreset(snapshot.allNotesPreset)
    setAllNotesFolderPreset(snapshot.allNotesFolderPreset)
    setNoteGridEnabled(snapshot.noteGridEnabled)
    setNoteGridIds(snapshot.noteGridIds.filter(id => notes.some(note => note.id === id)))
    setEditorMode(snapshot.editorMode)
    setShowLibrary(snapshot.showLibrary)
    setShowMainSidebar(snapshot.showMainSidebar)
    setShowFoldersPanel(snapshot.showFoldersPanel)
    localStorage.setItem('no-tie-folders-panel-visible', String(snapshot.showFoldersPanel))
    setShowChat(snapshot.showChat)
    setMobileDrawer('none')
  }

  function moveNavigationHistory(direction: -1 | 1) {
    const next = navigationIndex.current + direction
    const snapshot = navigationStack.current[next]
    if (!snapshot) return
    navigationIndex.current = next
    setNavigationPosition(next)
    applyNavigationSnapshot(snapshot)
  }

  function saveWorkspaceLayout(name: string) {
    const workspace: SavedWorkspaceLayout = {
      id: crypto.randomUUID(), name, selectedNoteId: selectedId,
      activeFilter, activeReviewSessionId, allNotesPreset, allNotesFolderPreset,
      noteGridEnabled, noteGridIds: [...noteGridIds].slice(0, MAX_NOTE_GRID_SIZE), editorMode,
      showLibrary, showMainSidebar, showFoldersPanel, showChat, createdAt: Date.now(),
    }
    setOrganizationSettings(current => ({ ...current, workspaces: [workspace, ...current.workspaces] }))
  }

  function applyWorkspaceLayout(workspace: SavedWorkspaceLayout) {
    const noteIds = workspace.noteGridIds.filter(id => notes.some(note => note.id === id)).slice(0, MAX_NOTE_GRID_SIZE)
    const sessionPage = [REVIEW_SESSIONS_OVERVIEW_ID, SAVED_SEARCHES_PAGE_ID, NOTE_TEMPLATES_PAGE_ID, ALL_NOTES_PAGE_ID, FLASHCARDS_PAGE_ID, TASKS_PAGE_ID, PROJECTS_PAGE_ID, ATTACHMENTS_PAGE_ID, NOTE_BOARD_PAGE_ID, LINK_AUDIT_PAGE_ID, COLLECTIONS_PAGE_ID]
    const savedRouteExists = sessionPage.includes(workspace.activeReviewSessionId) || reviewSessions.some(session => session.id === workspace.activeReviewSessionId)
    setSelectedId(notes.some(note => note.id === workspace.selectedNoteId) ? workspace.selectedNoteId : noteIds[0] ?? notes[0]?.id ?? '')
    setActiveFilter(workspace.activeFilter as Filter)
    setActiveReviewSessionId(savedRouteExists ? workspace.activeReviewSessionId : '')
    setShowCreateNotePage(false)
    setAllNotesPreset(workspace.allNotesPreset)
    setAllNotesFolderPreset(folders.includes(workspace.allNotesFolderPreset) ? workspace.allNotesFolderPreset : '')
    setNoteGridIds(noteIds)
    setNoteGridEnabled(workspace.noteGridEnabled && noteIds.length > 0)
    setEditorMode(workspace.editorMode)
    setShowLibrary(workspace.showLibrary)
    setShowMainSidebar(workspace.showMainSidebar)
    const foldersVisible = workspace.showFoldersPanel ?? true
    setShowFoldersPanel(foldersVisible)
    setShowChat(workspace.showChat)
    localStorage.setItem('no-tie-library-visible', String(workspace.showLibrary))
    localStorage.setItem('no-tie-main-sidebar-visible', String(workspace.showMainSidebar))
    localStorage.setItem('no-tie-folders-panel-visible', String(foldersVisible))
    localStorage.setItem('no-tie-ollama-chat-open', String(workspace.showChat))
  }

  function reorderNotes(sourceId: string, targetId: string) {
    if (sourceId === targetId) return
    setOrganizationSettings(current => {
      const ids = [...current.noteOrder]
      for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt)) if (!ids.includes(note.id)) ids.push(note.id)
      const sourceIndex = ids.indexOf(sourceId)
      const targetIndex = ids.indexOf(targetId)
      if (sourceIndex < 0 || targetIndex < 0) return current
      ids.splice(sourceIndex, 1)
      ids.splice(targetIndex, 0, sourceId)
      return { ...current, noteOrder: ids }
    })
  }

  function reorderFolder(folder: string, direction: -1 | 1) {
    const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    const siblings = folders.filter(item => (item.includes('/') ? item.slice(0, item.lastIndexOf('/')) : '') === parent)
    const index = siblings.indexOf(folder)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return
    const currentOrder = [...organizationSettings.folderOrder]
    const visualOrder = [...folders]
    const order = currentOrder.length ? currentOrder : visualOrder
    const a = order.indexOf(siblings[index]!)
    const b = order.indexOf(siblings[targetIndex]!)
    if (a < 0 || b < 0) return
    ;[order[a], order[b]] = [order[b]!, order[a]!]
    setOrganizationSettings(current => ({ ...current, folderOrder: order }))
  }

  function setFolderTemplateDefault(folder: string, templateId: string | undefined) {
    setOrganizationSettings(current => {
      const defaults = { ...current.folderTemplateDefaults }
      if (templateId) defaults[folder] = templateId
      else delete defaults[folder]
      return { ...current, folderTemplateDefaults: defaults }
    })
  }
  useEffect(() => {
    const validIds = new Set(notes.map(note => note.id))
    setNoteGridIds(current => {
      const next = current.filter(id => validIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [notes])
  useEffect(() => {
    if (!noteGridEnabled) return
    const visibleIds = noteGridIds.filter(id => notes.some(note => note.id === id))
    if (!visibleIds.length) setNoteGridEnabled(false)
    else if (!visibleIds.includes(selectedId)) setSelectedId(visibleIds[0]!)
  }, [noteGridEnabled, noteGridIds, notes, selectedId])
  const activeReviewSession = reviewSessions.find(session => session.id === activeReviewSessionId)
  const showingReviewSessionsOverview = activeReviewSessionId === REVIEW_SESSIONS_OVERVIEW_ID
  const showingSavedSearchesPage = activeReviewSessionId === SAVED_SEARCHES_PAGE_ID
  const showingNoteTemplatesPage = activeReviewSessionId === NOTE_TEMPLATES_PAGE_ID
  const showingLinkAuditPage = activeReviewSessionId === LINK_AUDIT_PAGE_ID
  const showingCollectionsPage = activeReviewSessionId === COLLECTIONS_PAGE_ID
  const showingAllNotesPage = activeReviewSessionId === ALL_NOTES_PAGE_ID
  const showingFlashcardsPage = activeReviewSessionId === FLASHCARDS_PAGE_ID
  const showingTaskManagerPage = activeReviewSessionId === TASKS_PAGE_ID
  const showingProjectDashboardPage = activeReviewSessionId === PROJECTS_PAGE_ID
  const showingAttachmentManagerPage = activeReviewSessionId === ATTACHMENTS_PAGE_ID
  const showingNoteBoardPage = activeReviewSessionId === NOTE_BOARD_PAGE_ID
  const showingWorkspacePage = showingReviewSessionsOverview || showingSavedSearchesPage || showingNoteTemplatesPage || showingLinkAuditPage || showingCollectionsPage || showingAllNotesPage || showingFlashcardsPage || showingTaskManagerPage || showingProjectDashboardPage || showingAttachmentManagerPage || showingNoteBoardPage || showCreateNotePage || Boolean(activeReviewSession)
  useLayoutEffect(() => { showingFlashcardsPageRef.current = showingFlashcardsPage }, [showingFlashcardsPage])
  const activeSmartFolder = featureFlags.smartFolders && activeFilter.startsWith('smart:') ? savedSearches.find(search => search.id === activeFilter.slice('smart:'.length)) : undefined
  const breadcrumbFolderPath = showingAllNotesPage
    ? allNotesFolderPreset
    : noteGridEnabled
      ? selectedNote?.folder || '__root__'
    : activeFilter === 'root'
      ? '__root__'
      : activeFilter !== 'all' && activeFilter !== 'favorites' && !activeFilter.startsWith('smart:')
        ? activeFilter
        : selectedNote?.folder || '__root__'
  const breadcrumbFolders = breadcrumbFolderPath === '__root__'
    ? [{ path: '__root__', label: 'Poziom główny' }]
    : folderParents(breadcrumbFolderPath).map(path => ({ path, label: path.split('/').at(-1) ?? path }))
  const showingToolsBreadcrumb = showingSavedSearchesPage || showingNoteTemplatesPage || showingLinkAuditPage || showingCollectionsPage || showingReviewSessionsOverview || showingFlashcardsPage || showingTaskManagerPage || showingProjectDashboardPage || showingAttachmentManagerPage || showingNoteBoardPage || Boolean(activeReviewSession)
  const toolsBreadcrumbTitle = showingSavedSearchesPage ? 'Zapisane widoki' : showingNoteTemplatesPage ? 'Szablony' : showingLinkAuditPage ? 'Kontrola powiązań' : showingCollectionsPage ? 'Kolekcje' : showingReviewSessionsOverview ? 'Wszystkie powtórki' : showingFlashcardsPage ? 'Fiszki' : showingTaskManagerPage ? 'Zadania' : showingProjectDashboardPage ? 'Pulpit projektów' : showingAttachmentManagerPage ? 'Załączniki' : showingNoteBoardPage ? 'Statusy notatek' : activeReviewSession?.title ?? ''
  const notesRef = useRef<Note[]>([])
  const backupSnapshotRef = useRef({ notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, flashcardTrash, trashEntries, organizationSettings })
  useLayoutEffect(() => {
    notesRef.current = notes
    backupSnapshotRef.current = { notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, flashcardTrash, trashEntries, organizationSettings }
  }, [notes, assets, attachments, reviewSessions, savedSearches, templates, folderColors, flashcards, flashcardTrash, trashEntries, organizationSettings])
  useLayoutEffect(() => {
    const note = notesRef.current.find(item => item.id === selectedId)
    if (!note) return
    historyNoteId.current = note.id
    noteHistory.current = [copyNote(note)]
    noteRedoHistory.current = []
  }, [selectedId])
  const tagOptions = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort((a, b) => a.localeCompare(b, 'pl')), [notes])
  const favoriteNoteCount = useMemo(() => notes.reduce((count, note) => count + Number(note.favorite), 0), [notes])
  const searchableAttachments = useMemo(() => attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined }), [attachments, featureFlags.audioNotes, featureFlags.attachmentIndex])
  const searchableAttachmentsByNote = useMemo(() => {
    const grouped = new Map<string, NoteAttachment[]>()
    for (const attachment of searchableAttachments) {
      const items = grouped.get(attachment.noteId) ?? []
      items.push(attachment)
      grouped.set(attachment.noteId, items)
    }
    return grouped
  }, [searchableAttachments])
  const visibleAttachmentCount = searchableAttachments.length
  const deferredSearchQuery = useDeferredValue(query)
  const searchResults = useMemo(() => searchNotes(notes, { query: semanticSearchEnabled && featureFlags.semanticSearch ? '' : deferredSearchQuery, tag: searchTag, folder: searchFolder, attachments: searchableAttachments, contentByNote: searchContentByNote, normalizedContentByNote: searchNormalizedContentByNote, advanced: featureFlags.advancedQuery }), [notes, searchableAttachments, deferredSearchQuery, searchTag, searchFolder, searchContentByNote, searchNormalizedContentByNote, semanticSearchEnabled, featureFlags.semanticSearch, featureFlags.advancedQuery])
  const notesWithAvailableContent = useMemo(() => {
    const noteIds = new Set(notes.map(note => note.id))
    for (const id of hydratedNoteCache.current.keys()) {
      if (!noteIds.has(id) || (!searchContentByNote.has(id) && !noteBodies.has(id))) hydratedNoteCache.current.delete(id)
    }
    return notes.map(note => {
      const content = searchContentByNote.get(note.id) ?? noteBodies.get(note.id)
      if (content === undefined) return note
      const cached = hydratedNoteCache.current.get(note.id)
      if (cached?.header === note && cached.content === content) return cached.note
      const hydrated = { ...note, content, contentLoaded: true }
      hydratedNoteCache.current.set(note.id, { header: note, content, note: hydrated })
      return hydrated
    })
  }, [notes, searchContentByNote, noteBodies])
  const aiAccessibleNotes = useMemo(() => showChat ? notesWithAvailableContent.filter(aiCanAccessNote) : [], [showChat, notesWithAvailableContent, aiPreferences.folderAccessRestricted, aiPreferences.allowedFolders])
  useEffect(() => {
    if (!featureFlags.semanticSearch || !semanticSearchEnabled || !query.trim()) {
      setSemanticScores({})
      setSemanticSearchError('')
      setSemanticSearchBusy(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setSemanticSearchBusy(true)
    setSemanticSearchError('')
    const timer = window.setTimeout(() => {
      void (async () => {
        const cache = semanticDocumentCache.current
        const noteIds = new Set(notesWithAvailableContent.map(note => note.id))
        for (const id of cache.keys()) if (!noteIds.has(id)) cache.delete(id)
        const pending: SemanticDocumentCacheEntry[] = []
        const sameReferences = (left: NoteAttachment[], right: NoteAttachment[]) => left.length === right.length && left.every((item, index) => item === right[index])
        for (const note of notesWithAvailableContent) {
          const noteAttachments = searchableAttachmentsByNote.get(note.id) ?? []
          const previous = cache.get(note.id)
          const content = searchContentByNote.get(note.id) ?? note.content
          if (previous && previous.model === embeddingModel && previous.title === note.title && previous.folder === note.folder && previous.content === content
            && previous.tags.length === note.tags.length && previous.tags.every((tag, index) => tag === note.tags[index])
            && sameReferences(previous.attachments, noteAttachments)) {
            if (!previous.vector) pending.push(previous)
            continue
          }
          const entry: SemanticDocumentCacheEntry = {
            model: embeddingModel,
            title: note.title,
            folder: note.folder,
            content,
            tags: [...note.tags],
            attachments: [...noteAttachments],
            text: `${note.title}\n${note.folder}\n${note.tags.join(' ')}\n${content}\n${noteAttachments.map(attachment => `${attachment.fileName}\n${attachment.transcript ?? ''}\n${attachment.extractedText ?? ''}`).join('\n')}`.slice(0, 6000),
          }
          cache.set(note.id, entry)
          pending.push(entry)
        }
        let queryVector: number[] | undefined
        for (let offset = 0; offset < Math.max(1, pending.length); offset += 32) {
          if (cancelled || controller.signal.aborted) return
          const documentBatch = pending.slice(offset, offset + 32)
          const input = offset === 0 ? [query, ...documentBatch.map(entry => entry.text)] : documentBatch.map(entry => entry.text)
          const vectors = await embedOllamaTexts(ollamaBaseUrl, embeddingModel, input, controller.signal)
          if (offset === 0) queryVector = vectors.shift()
          if (documentBatch.length !== vectors.length) throw new Error('Model nie zwrócił wszystkich wektorów semantycznych.')
          documentBatch.forEach((entry, index) => { entry.vector = vectors[index] })
          if (offset + 32 < pending.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        }
        if (cancelled || controller.signal.aborted) return
        if (!queryVector) throw new Error('Model nie zwrócił embeddingu zapytania.')
        const cosine = (left: number[], right: number[]) => {
          let dot = 0; let leftNorm = 0; let rightNorm = 0
          for (let index = 0; index < Math.min(left.length, right.length); index += 1) { dot += left[index]! * right[index]!; leftNorm += left[index]! ** 2; rightNorm += right[index]! ** 2 }
          return dot / (Math.sqrt(leftNorm * rightNorm) || 1)
        }
        const scores = Object.fromEntries(notesWithAvailableContent.map(note => [note.id, cosine(queryVector!, cache.get(note.id)?.vector ?? [])]))
        setSemanticScores(scores)
        setSemanticSearchBusy(false)
      })().catch(error => {
        if (cancelled) return
        const detail = error instanceof Error ? error.message : 'Nie udało się obliczyć podobieństwa.'
        setSemanticSearchError(/model.*not found|model.*nie znaleziono/i.test(detail) ? 'Pobierz model embeddingów poleceniem: ollama pull nomic-embed-text' : detail)
        setSemanticSearchBusy(false)
      })
    }, 450)
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer) }
  }, [featureFlags.semanticSearch, semanticSearchEnabled, query, notesWithAvailableContent, searchContentByNote, searchableAttachmentsByNote, ollamaBaseUrl, embeddingModel])
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
  const smartFolderResults = useMemo(() => activeSmartFolder ? searchNotes(notes, { query: activeSmartFolder.query, tag: activeSmartFolder.tag, folder: activeSmartFolder.folder, attachments: searchableAttachments, contentByNote: searchContentByNote, normalizedContentByNote: searchNormalizedContentByNote, advanced: featureFlags.advancedQuery }) : undefined, [activeSmartFolder, notes, searchableAttachments, searchContentByNote, searchNormalizedContentByNote, featureFlags.advancedQuery])
  const visibleNotes = useMemo(() => {
    return (smartFolderResults ?? semanticResults).filter(note => {
      if (activeSmartFolder) return true
      if (activeFilter === 'favorites' && !note.favorite) return false
      if (activeFilter === 'root' && note.folder) return false
      if (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' && !activeFilter.startsWith('smart:') && note.folder !== activeFilter && !note.folder.startsWith(`${activeFilter}/`)) return false
      return true
    })
  }, [semanticResults, smartFolderResults, activeFilter, activeSmartFolder])
  const noteListItems = useMemo(() => visibleNotes.slice(0, noteListLimit), [visibleNotes, noteListLimit])
  useEffect(() => { setNoteListLimit(100) }, [activeFilter, query, searchTag, searchFolder, activeSmartFolder?.id])
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
  const currentAssets = assetsByNote.get(selectedId) ?? EMPTY_NOTE_ASSETS
  const currentAttachments = attachmentsByNote.get(selectedId) ?? EMPTY_NOTE_ATTACHMENTS
  const currentAttachmentsForUi = useMemo(() => featureFlags.audioNotes ? currentAttachments : currentAttachments.filter(attachment => !attachment.mimeType.startsWith('audio/')), [featureFlags.audioNotes, currentAttachments])
  const parsedTasks = useMemo(() => parseTasks(notesWithAvailableContent), [notesWithAvailableContent])
  const reminderTasks = useMemo(() => taskReminderIndexReady ? [...taskReminderTasksByNote.values()].flat() : parsedTasks, [taskReminderIndexReady, taskReminderTasksByNote, parsedTasks])
  const incompleteTaskCount = useMemo(() => reminderTasks.reduce((count, task) => count + Number(!task.done), 0), [reminderTasks])
  const dueFlashcardCount = useMemo(() => flashcards.reduce((count, card) => count + Number(!card.suspended && card.dueAt <= Date.now()), 0), [flashcards])
  const bulkSelectedIdSet = useMemo(() => new Set(bulkSelectedIds), [bulkSelectedIds])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const currentNotes = notesRef.current
    const validIds = new Set(currentNotes.map(note => note.id))
    let base = taskReminderTasksRef.current
    if ([...base.keys()].some(id => !validIds.has(id))) {
      base = new Map([...base].filter(([id]) => validIds.has(id)))
      publishTaskReminderIndex(base)
    }
    const missing = currentNotes.filter(note => !base.has(note.id))
    if (!missing.length) {
      setTaskReminderIndexReady(true)
      return
    }
    setTaskReminderIndexReady(false)
    const scannedUpdatedAt = new Map(currentNotes.map(note => [note.id, note.updatedAt]))
    void (async () => {
      let next = new Map(taskReminderTasksRef.current)
      for (let offset = 0; offset < missing.length; offset += 12) {
        const batch = missing.slice(offset, offset + 12)
        const contents = await Promise.all(batch.map(note => getNoteBody(note.id)))
        if (cancelled) return
        batch.forEach((note, index) => next.set(note.id, parseTasks([{ ...note, content: contents[index] ?? '', contentLoaded: true }])))
        taskReminderTasksRef.current = next
        if (offset % 48 === 36) setTaskReminderTasksByNote(new Map(next))
        if (offset + batch.length < missing.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      }
      const latestNotes = notesRef.current
      const latestIds = new Set(latestNotes.map(note => note.id))
      const missingIds = new Set(missing.map(note => note.id))
      next = new Map([...taskReminderTasksRef.current].filter(([id]) => latestIds.has(id)))
      for (const note of latestNotes) {
        if (!missingIds.has(note.id) && scannedUpdatedAt.get(note.id) === note.updatedAt) continue
        const pending = pendingContentPatches.current.get(note.id)?.content
        const cached = noteBodiesRef.current.get(note.id)
        const content = pending ?? cached ?? await getNoteBody(note.id)
        if (cancelled) return
        next.set(note.id, parseTasks([{ ...note, content, contentLoaded: true }]))
      }
      if (cancelled) return
      taskReminderTasksRef.current = next
      setTaskReminderTasksByNote(next)
      setTaskReminderIndexReady(latestNotes.every(note => next.has(note.id)))
    })().catch(error => {
      if (!cancelled) reportDiskSaveError(error)
    })
    return () => { cancelled = true }
  }, [ready, noteIdsSignature])
  useEffect(() => {
    const notifyDueTasks = () => {
      const now = new Date()
      const localMinute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      reminderTasks.filter(task => !task.done && task.remindAt && task.remindAt <= localMinute && (!task.snoozedUntil || task.snoozedUntil <= localMinute)).forEach(task => {
        const key = `no-tie-reminder:${task.id}:${task.remindAt}:${task.snoozedUntil}`
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
  }, [reminderTasks])
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
  useEffect(() => {
    const notifyDueFlashcards = () => {
      let settings: { enabled?: boolean; time?: string; lastNotifiedDate?: string }
      try { settings = JSON.parse(localStorage.getItem('no-tie-flashcard-reminder') ?? '{}') as typeof settings } catch { return }
      const configuredTime = settings.time
      if (!settings.enabled || typeof configuredTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime)) return
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (time < configuredTime || settings.lastNotifiedDate === date) return
      const dueCount = flashcards.filter(card => !card.suspended && card.dueAt <= now.getTime()).length
      if (!dueCount) return
      localStorage.setItem('no-tie-flashcard-reminder', JSON.stringify({ ...settings, lastNotifiedDate: date }))
      const dueMessage = dueCount === 1 ? '1 fiszka czeka na powtórkę.' : dueCount >= 2 && dueCount <= 4 ? `${dueCount} fiszki czekają na powtórkę.` : `${dueCount} fiszek czeka na powtórkę.`
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Czas na powtórkę fiszek', { body: dueMessage })
      else {
        setToast(dueMessage)
        window.setTimeout(() => setToast(''), 5000)
      }
    }
    notifyDueFlashcards()
    const timer = window.setInterval(notifyDueFlashcards, 30_000)
    return () => window.clearInterval(timer)
  }, [flashcards])
  const documentCounts = selectedNote ? countMarkdownDocument(selectedNote.content) : { words: 0, characters: 0 }
  const selectionText = selectedNote && editorSelection.noteId === selectedNote.id && editorSelection.mode === editorMode ? editorSelection.text : ''
  const selectionCounts = countEditorText(selectionText)
  const aiDialogNote = flashcardGenerationScope
    ? notesWithAvailableContent.find(note => note.id === flashcardGenerationScope.noteId)
    : notesWithAvailableContent.find(note => note.id === (noteActionTargetId || selectedId))
  useEffect(() => {
    if (!aiNoteTool || !aiDialogNote || aiDialogNote.contentLoaded !== false || noteBodiesRef.current.has(aiDialogNote.id)) return
    void ensureNoteBody(aiDialogNote.id).catch(reportDiskSaveError)
  }, [aiNoteTool, aiDialogNote?.id])

  function selectionForNote(noteId: string, mode: 'rendered' | 'source') {
    return editorSelection.noteId === noteId && editorSelection.mode === mode ? editorSelection.text : ''
  }

  function markdownActionsFor(noteId: string, mode: 'rendered' | 'source') {
    const noteSelection = selectionForNote(noteId, mode)
    const targetNote = notes.find(note => note.id === noteId)
    const aiAllowed = targetNote ? aiCanAccessNote(targetNote) : false
    return [
      { id: 'link', label: 'Połącz notatkę' },
      { id: 'embed', label: 'Osadź notatkę' },
      ...(aiAllowed ? [{ id: 'edit-ai', label: 'Edytuj zaznaczenie z AI', disabled: !noteSelection || !ollamaModel }] : []),
      ...(noteSelection.trim() ? [{ id: 'create-flashcard-selection', label: 'Utwórz fiszkę z zaznaczenia' }] : []),
      ...(noteSelection.trim() && featureFlags.aiFlashcards && aiAllowed ? [{ id: 'generate-flashcards-selection', label: 'Generuj fiszki z zaznaczenia', disabled: !ollamaModel }] : []),
      ...(featureFlags.aiSummaries && aiAllowed ? [{ id: 'summary', label: 'Podsumuj i stwórz konspekt' }] : []),
      ...(featureFlags.aiTaskExtraction && aiAllowed ? [{ id: 'tasks', label: 'Wydobądź zadania' }] : []),
      ...(featureFlags.aiFlashcards && aiAllowed ? [{ id: 'flashcards', label: 'Stwórz fiszki' }, { id: 'quiz', label: 'Stwórz quiz' }] : []),
      ...(aiAllowed ? [{ id: 'metadata', label: 'Zaproponuj tagi i właściwości' }] : []),
    ]
  }

  const markdownNoteActions = markdownActionsFor(selectedId, editorMode)

  const linkedNoteBodyIds = useMemo(() => selectedNote
    ? [...new Set(wikiTargets(selectedNote.content).map(target => resolveWikiTarget(notes, target)?.id).filter((id): id is string => Boolean(id && id !== selectedNote.id)))]
    : [], [selectedNote?.id, selectedNote?.content, notes])
  useEffect(() => {
    if (!ready || !selectedNote?.contentLoaded || !linkedNoteBodyIds.length) return
    void ensureNoteBodies(linkedNoteBodyIds).catch(reportDiskSaveError)
  }, [ready, selectedNote?.id, selectedNote?.content, selectedNote?.contentLoaded, linkedNoteBodyIds.join('\u0000')])

  function handleMarkdownNoteAction(action: string, noteId = selectedId, mode = editorMode) {
    const note = notes.find(item => item.id === noteId)
    if (!note) return
    if (['edit-ai', 'summary', 'tasks', 'flashcards', 'quiz', 'metadata'].includes(action) && note.contentLoaded === false && !noteBodiesRef.current.has(noteId)) {
      void ensureNoteBody(noteId).then(() => handleMarkdownNoteAction(action, noteId, mode)).catch(reportDiskSaveError)
      return
    }
    if (['edit-ai', 'generate-flashcards-selection', 'summary', 'tasks', 'flashcards', 'quiz', 'metadata'].includes(action) && !aiCanAccessNote(note)) {
      setToast('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.')
      window.setTimeout(() => setToast(''), 3000)
      return
    }
    const noteSelection = selectionForNote(noteId, mode).trim()
    setNoteActionTargetId(noteId)
    if (action === 'link') setShowNoteLinkDialog(true)
    else if (action === 'embed') setShowNoteEmbedDialog(true)
    else if (action === 'edit-ai') {
      if (noteSelection) {
        setAiEditTarget({ noteId, text: noteSelection })
        setShowAiEdit(true)
      }
    } else if (action === 'create-flashcard-selection') {
      if (noteSelection) setSelectedTextFlashcard({ noteId, text: noteSelection })
    } else if (action === 'generate-flashcards-selection') {
      if (!noteSelection) return
      setFlashcardGenerationScope({ kind: 'selection', noteId, text: noteSelection, label: 'Zaznaczony fragment notatki' })
      setAiNoteTool('flashcards')
    } else {
      setFlashcardGenerationScope(null)
      setAiNoteTool(action as AiNoteTool)
    }
  }

  function scheduleNoteVersion(note: Note, previous: Note) {
    if (!persistentVersionTimers.current.has(note.id)) {
      const previousBody = pendingContentPatches.current.get(previous.id)?.content ?? noteBodiesRef.current.get(previous.id)
      const snapshot = previous.contentLoaded === false
        ? getNoteBody(previous.id).then(content => ({ ...previous, content: previousBody ?? content, contentLoaded: true }))
        : Promise.resolve(previous)
      void snapshot.then(saveNoteVersion).catch(reportDiskSaveError)
    }
    const existingTimer = persistentVersionTimers.current.get(note.id)
    if (existingTimer !== undefined) window.clearTimeout(existingTimer)
    const timer = window.setTimeout(() => {
      persistentVersionTimers.current.delete(note.id)
      const latest = notesRef.current.find(item => item.id === note.id)
      if (!latest) return
      const body = pendingContentPatches.current.get(note.id)?.content ?? noteBodiesRef.current.get(note.id)
      const snapshot = latest.contentLoaded === false
        ? getNoteBody(note.id).then(content => ({ ...latest, content: body ?? content, contentLoaded: true }))
        : Promise.resolve(latest)
      void snapshot.then(saveNoteVersion).then(async () => {
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
    const latest = fallback?.contentLoaded === true ? fallback : notesRef.current.find(item => item.id === noteId) ?? fallback
    if (latest) {
      const body = latest.contentLoaded === true ? latest.content : noteBodiesRef.current.get(noteId) ?? (latest.contentLoaded === false ? await getNoteBody(noteId) : latest.content)
      await saveNoteVersion({ ...latest, content: body, contentLoaded: true })
    }
  }

  function commitContentPatch(noteId: string, recordPersistentHistory = true) {
    const timer = contentPatchTimers.current.get(noteId)
    if (timer !== undefined) window.clearTimeout(timer)
    contentPatchTimers.current.delete(noteId)
    const updated = pendingContentPatches.current.get(noteId)
    if (!updated) return
    pendingContentPatches.current.delete(noteId)
    const previousHeader = notesRef.current.find(note => note.id === noteId)
    const previousBody = pendingContentPreviousBodies.current.get(noteId) ?? noteBodiesRef.current.get(noteId) ?? previousHeader?.content ?? ''
    pendingContentPreviousBodies.current.delete(noteId)
    const previous = previousHeader ? { ...previousHeader, content: previousBody, contentLoaded: true } : undefined
    const header = { ...updated, content: '', contentLoaded: false }
    cacheNoteBody(noteId, updated.content)
    updateTaskReminderIndexForNote(updated)
    setSearchContentByNote(current => {
      if (!current.has(noteId)) return current
      const next = new Map(current)
      next.set(noteId, updated.content)
      return next
    })
    setSearchNormalizedContentByNote(current => {
      if (!current.has(noteId)) return current
      const next = new Map(current)
      next.set(noteId, normalizeSearchText(updated.content))
      return next
    })
    setNotes(current => current.map(note => note.id === noteId ? header : note))
    if (noteId === selectedId) recordNoteHistory(updated)
    if (previous && recordPersistentHistory) scheduleNoteVersion(updated, previous)
    try { localStorage.setItem(NOTE_RECOVERY_DRAFT_KEY, JSON.stringify({ note: updated, capturedAt: Date.now() } satisfies NoteRecoveryDraft)) }
    catch { /* Recovery is best-effort when the browser storage quota is full. */ }
  }

  function patchNote(id: string, patch: Partial<Note>, recordPersistentHistory = true) {
    const storedExisting = notesRef.current.find(note => note.id === id)
    const pending = pendingContentPatches.current.get(id)
    const cachedBody = noteBodiesRef.current.get(id)
    const existing = storedExisting ? {
      ...storedExisting,
      content: pending?.content ?? cachedBody ?? storedExisting.content,
      contentLoaded: pending !== undefined || cachedBody !== undefined || storedExisting.contentLoaded !== false,
    } : undefined
    if (existing && Object.entries(patch).every(([key, value]) => JSON.stringify(existing[key as keyof Note]) === JSON.stringify(value))) return
    setSaved(false)
    const updatedAt = Math.max(currentTimestamp(), (existing?.updatedAt ?? 0) + 1)
    const updated = existing ? { ...existing, ...patch, updatedAt } : undefined
    if (updated && typeof patch.title === 'string') updateTaskReminderTitle(id, updated.title)
    if (existing && updated && Object.keys(patch).length === 1 && typeof patch.content === 'string') {
      pendingContentPatches.current.set(id, { ...updated, contentLoaded: true })
      const currentTimer = contentPatchTimers.current.get(id)
      if (currentTimer !== undefined) window.clearTimeout(currentTimer)
      contentPatchTimers.current.set(id, window.setTimeout(() => commitContentPatch(id, recordPersistentHistory), 320))
      return
    }
    if (updated) {
      try { localStorage.setItem(NOTE_RECOVERY_DRAFT_KEY, JSON.stringify({ note: updated, capturedAt: Date.now() } satisfies NoteRecoveryDraft)) }
      catch { /* Recovery is best-effort when the browser storage quota is full. */ }
    }
    if (existing && updated && recordPersistentHistory) scheduleNoteVersion(updated, existing)
    if (existing && typeof patch.content === 'string') cacheNoteBody(id, patch.content)
    setNotes(current => current.map(note => {
      if (note.id !== id) return note
      const keepBodyInCache = noteBodiesRef.current.has(id) || note.contentLoaded === false
      const next = keepBodyInCache
        ? { ...note, ...patch, content: '', contentLoaded: false, updatedAt }
        : { ...note, ...patch, contentLoaded: true, updatedAt }
      if (id === selectedId) recordNoteHistory(updated ? { ...next, content: updated.content, contentLoaded: true } : next)
      return next
    }))
  }

  async function restoreRecoveryDraft() {
    const draft = recoveryDraft?.note
    if (!draft) return
    const existing = notesRef.current.find(note => note.id === draft.id)
    try {
      if (existing) await saveNoteVersion(existing)
      setNotes(current => current.map(note => note.id === draft.id ? draft : note))
      setSelectedId(draft.id)
      recordNoteHistory(draft)
      await saveNote(draft)
      await saveNoteVersion(draft)
      setSaved(true)
      try { localStorage.removeItem(NOTE_RECOVERY_DRAFT_KEY) } catch { /* The restored note is already saved. */ }
      setRecoveryDraft(null)
    } catch (error) {
      reportDiskSaveError(error)
    }
  }

  function discardRecoveryDraft() {
    try { localStorage.removeItem(NOTE_RECOVERY_DRAFT_KEY) } catch { /* Browser storage may be disabled. */ }
    setRecoveryDraft(null)
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
      clearRecoveryDraftForNotes(ids)
      const nextTrash = [...await trashNoteData(ids), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
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
    commitContentPatch(selectedId)
    setShowCreateNotePage(false)
    setEditorSelection({ noteId: id, mode: editorMode, text: '' })
    if (noteGridEnabled && id && !noteGridIds.includes(id)) {
      setNoteGridIds(current => {
        if (current.includes(id)) return current
        const focusedIndex = current.indexOf(selectedId)
        if (current.length < MAX_NOTE_GRID_SIZE) return [...current, id]
        const next = [...current]
        next[focusedIndex >= 0 ? focusedIndex : 0] = id
        return next
      })
    }
    setSelectedId(id)
  }

  function focusGridNote(id: string) {
    if (!notes.some(note => note.id === id)) return
    commitContentPatch(selectedId)
    setShowCreateNotePage(false)
    setSelectedId(id)
  }

  function toggleNoteGrid() {
    if (noteGridEnabled) {
      setNoteGridEnabled(false)
      return
    }
    const initialId = notes.some(note => note.id === selectedId) ? selectedId : notes[0]?.id ?? ''
    setNoteGridIds(initialId ? [initialId] : [])
    setNoteGridEnabled(true)
  }

  function addNoteToGrid(id: string) {
    if (noteGridIds.includes(id)) return focusGridNote(id)
    if (noteGridIds.length >= MAX_NOTE_GRID_SIZE) {
      setToast('Siatka mieści najwyżej 4 notatki. Usuń jedną kartę, aby dodać kolejną.')
      window.setTimeout(() => setToast(''), 3000)
      return
    }
    setNoteGridIds(current => current.includes(id) || current.length >= MAX_NOTE_GRID_SIZE ? current : [...current, id])
    focusGridNote(id)
  }

  function openNoteInGridSlot(noteId: string, slotId: string) {
    if (!noteGridEnabled || !notes.some(note => note.id === noteId)) return
    setMobileDrawer('none')
    if (noteGridIds.includes(noteId)) {
      focusGridNote(noteId)
      return
    }
    setNoteGridIds(current => {
      if (current.includes(noteId)) return current
      const slotIndex = current.indexOf(slotId)
      if (slotIndex < 0) return current.length < MAX_NOTE_GRID_SIZE ? [...current, noteId] : current
      const next = [...current]
      next[slotIndex] = noteId
      return next
    })
    focusGridNote(noteId)
  }

  function removeNoteFromGrid(id: string) {
    const next = noteGridIds.filter(noteId => noteId !== id)
    setNoteGridIds(next)
    if (selectedId === id) setSelectedId(next.at(-1) ?? id)
    if (!next.length) setNoteGridEnabled(false)
  }

  function openAllNotesFolder(folder: string) {
    setShowCreateNotePage(false)
    setActiveReviewSessionId(ALL_NOTES_PAGE_ID)
    setAllNotesPreset('all')
    setAllNotesFolderPreset(folder)
    setAllNotesPresetRevision(value => value + 1)
    setActiveFilter('all')
    setMobileDrawer('none')
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
    const note = notesWithAvailableContent.find(item => item.id === task.noteId)
    if (!note) return
    const completing = patch.done === true || patch.status === 'done'
    const starting = patch.status === 'doing'
    const blocker = (completing || starting) && task.dependency ? parsedTasks.find(item => item.id === task.dependency && !item.done) : undefined
    if (blocker) {
      setToast(`Najpierw ukończ zadanie „${blocker.text}”, aby odblokować to zadanie.`)
      window.setTimeout(() => setToast(''), 3000)
      return
    }
    let content = updateTaskLine(note.content, task, patch)
    if (completing && !task.done && task.repeat) {
      const nextDate = nextTaskDate(task.dueDate, task.repeat)
      const repeatId = crypto.randomUUID()
      const reminderTime = task.remindAt ? task.remindAt.slice(11, 16) : ''
      const nextReminder = reminderTime ? `remind=${encodeURIComponent(`${nextDate}T${reminderTime}`)}` : ''
      const fields = [
        `id=${repeatId}`, `due=${nextDate}`, `priority=${encodeURIComponent(task.priority)}`, `repeat=${task.repeat}`,
        nextReminder, task.dependency ? `depends=${encodeURIComponent(task.dependency)}` : '',
        task.relatedNoteIds.length ? `notes=${encodeURIComponent(JSON.stringify(task.relatedNoteIds))}` : '',
        task.attachmentIds.length ? `attachments=${encodeURIComponent(JSON.stringify(task.attachmentIds))}` : '',
        task.estimateMinutes ? `estimate=${task.estimateMinutes}` : '', task.milestone ? 'milestone=1' : '',
      ].filter(Boolean)
      content += `${content.endsWith('\n') ? '' : '\n'}- [ ] ${task.text} <!-- no-tie-task ${fields.join(' ')} -->\n`
    }
    patchNote(note.id, { content })
  }

  function createTask(noteId: string, title: string, dueDate: string, priority: ParsedTask['priority'], repeat: ParsedTask['repeat'] = '', remindAt = '', dependency = '', extra: TaskPatch = {}) {
    const note = notesWithAvailableContent.find(item => item.id === noteId)
    if (!note) return
    const fields = [
      `id=${crypto.randomUUID()}`, dueDate ? `due=${dueDate}` : '', priority !== 'normal' ? `priority=${encodeURIComponent(priority)}` : '', repeat ? `repeat=${repeat}` : '',
      remindAt ? `remind=${encodeURIComponent(remindAt)}` : '', dependency ? `depends=${encodeURIComponent(dependency)}` : '',
      extra.relatedNoteIds?.length ? `notes=${encodeURIComponent(JSON.stringify(extra.relatedNoteIds))}` : '',
      extra.attachmentIds?.length ? `attachments=${encodeURIComponent(JSON.stringify(extra.attachmentIds))}` : '',
      extra.estimateMinutes ? `estimate=${extra.estimateMinutes}` : '', extra.milestone ? 'milestone=1' : '',
    ].filter(Boolean)
    const metadata = ` <!-- no-tie-task ${fields.join(' ')} -->`
    const separator = note.content.endsWith('\n') ? '' : '\n'
    patchNote(noteId, { content: `${note.content}${separator}- [ ] ${title}${metadata}\n` })
  }

  function createProjectTasks(noteId: string, additions: { title: string; extra?: TaskPatch }[]) {
    const note = notesWithAvailableContent.find(item => item.id === noteId)
    if (!note || !additions.length) return
    const lines = additions.map(({ title, extra = {} }) => {
      const fields = [
        `id=${crypto.randomUUID()}`,
        extra.relatedNoteIds?.length ? `notes=${encodeURIComponent(JSON.stringify(extra.relatedNoteIds))}` : '',
        extra.attachmentIds?.length ? `attachments=${encodeURIComponent(JSON.stringify(extra.attachmentIds))}` : '',
        extra.estimateMinutes ? `estimate=${extra.estimateMinutes}` : '', extra.milestone ? 'milestone=1' : '',
      ].filter(Boolean)
      return `- [ ] ${title.replace(/[\r\n]+/g, ' ').trim()} <!-- no-tie-task ${fields.join(' ')} -->`
    })
    const separator = note.content.endsWith('\n') || !note.content ? '' : '\n'
    patchNote(noteId, { content: `${note.content}${separator}${lines.join('\n')}\n` })
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
      const mimeType = file.type.startsWith('video/') ? file.type : ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', '3gp': 'audio/3gpp', amr: 'audio/amr', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg' } as Record<string, string>)[extension] || ''
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

  function insertTextIntoNote(text: string, noteId = selectedId) {
    const targetNote = notes.find(note => note.id === noteId)
    if (!targetNote || !text.trim()) return
    const append = (note: Note) => {
      const separator = note.content.endsWith('\n') ? '\n' : '\n\n'
      patchNote(note.id, { content: `${note.content}${separator}${text.trim()}\n` })
      setEditorRevision(value => value + 1)
    }
    const loadedContent = pendingContentPatches.current.get(noteId)?.content ?? noteBodiesRef.current.get(noteId)
    if (loadedContent !== undefined || targetNote.contentLoaded !== false) append({ ...targetNote, content: loadedContent ?? targetNote.content, contentLoaded: true })
    else void ensureNoteBody(noteId).then(content => append({ ...targetNote, content, contentLoaded: true })).catch(reportDiskSaveError)
  }

  function saveAttachmentTranscript(attachment: NoteAttachment, transcript: string, transcriptSegments?: NoteAttachment['transcriptSegments']) {
    const segments = transcriptSegments ?? (transcript.trim() === attachment.transcript?.trim() ? attachment.transcriptSegments : undefined)
    const updated = { ...attachment, transcript, transcriptSegments: segments }
    setAttachments(current => current.some(item => item.id === attachment.id)
      ? current.map(item => item.id === attachment.id ? updated : item)
      : [...current, updated])
    void persistAttachmentTranscript(updated, transcript).catch(reportDiskSaveError)
    void saveAttachmentMetadata(updated, { transcriptSegments: segments }).catch(reportDiskSaveError)
  }

  function saveAttachmentMetadataFields(attachment: NoteAttachment, fields: Pick<NoteAttachment, 'author' | 'documentDate' | 'description'>) {
    const updated = { ...attachment, ...fields }
    setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
    void saveAttachmentMetadata(updated, fields).catch(reportDiskSaveError)
  }

  async function saveAttachmentExtractedText(attachment: NoteAttachment, extractedText: string) {
    const updated = { ...attachment, extractedText }
    setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
    await saveAttachmentMetadata(updated, { extractedText })
  }

  function savePdfAnnotations(attachment: NoteAttachment, pdfAnnotations: NonNullable<NoteAttachment['pdfAnnotations']>) {
    const updated = { ...attachment, pdfAnnotations }
    setAttachments(current => current.map(item => item.id === attachment.id ? updated : item))
    void saveAttachmentMetadata(updated, { pdfAnnotations }).catch(reportDiskSaveError)
  }

  async function transcribeAudioAttachment(attachment: NoteAttachment): Promise<string> {
    if (!featureFlags.audioNotes) throw new Error('Moduł notatek audio jest wyłączony.')
    const sourceNote = notes.find(note => note.id === attachment.noteId)
    if (sourceNote && !aiCanAccessNote(sourceNote)) throw new Error('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.')
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
      const startMs = typeof segment.start_ms === 'number' ? segment.start_ms : typeof segment.startMs === 'number' ? segment.startMs : typeof segment.start === 'number' ? segment.start * 1000 : index * 1000
      const endMs = typeof segment.end_ms === 'number' ? segment.end_ms : typeof segment.endMs === 'number' ? segment.endMs : typeof segment.end === 'number' ? segment.end * 1000 : undefined
      const speakerValue = segment.speaker_id ?? segment.speaker
      const speaker = typeof speakerValue === 'number' ? `Mówca ${speakerValue + 1}` : typeof speakerValue === 'string' ? `Mówca ${speakerValue.replace(/^speaker[_ -]?/i, '')}` : undefined
      return [{ startMs: Math.max(0, Math.round(startMs)), endMs: endMs === undefined ? undefined : Math.max(0, Math.round(endMs)), text, speaker }]
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
      setPreviewAttachmentFragment('')
      setPreviewAttachmentId(attachment.id)
    }
  }

  function appendAiTextToNote(value: string, kind: AiNoteTool, noteId = selectedId) {
    const note = notesWithAvailableContent.find(item => item.id === noteId)
    if (!note) return
    const heading = kind === 'summary' ? 'Podsumowanie AI' : kind === 'tasks' ? 'Zadania z AI' : kind === 'metadata' ? 'Sugestie metadanych AI' : 'Quiz AI'
    const separator = note.content.trimEnd() ? '\n\n' : ''
    const content = `${note.content.trimEnd()}${separator}## ${heading}\n\n${value.trim()}\n`
    patchNote(note.id, { content })
    setEditorRevision(revision => revision + 1)
    setToast(kind === 'summary' ? 'Dodano podsumowanie do notatki.' : kind === 'tasks' ? 'Dodano zadania do notatki.' : 'Dodano quiz do notatki.')
    window.setTimeout(() => setToast(''), 3000)
  }

  function applyAiMetadata(noteId: string, tags: string[], properties: Record<string, string>) {
    const note = notes.find(item => item.id === noteId)
    if (!note || !aiCanAccessNote(note)) return
    patchNote(noteId, { tags: [...new Set([...note.tags, ...tags.map(tag => tag.trim()).filter(Boolean)])], properties: { ...(note.properties ?? {}), ...properties } })
    setToast(`Zapisano ${tags.length} tagów i ${Object.keys(properties).length} właściwości.`)
    window.setTimeout(() => setToast(''), 3000)
  }

  function insertAttachmentLink(attachment: NoteAttachment) {
    insertTextIntoNote(`[${attachment.fileName}](./assets/${encodeURIComponent(attachment.fileName)})`)
  }

  function insertDocumentReference(attachment: NoteAttachment, page: number, fragment = '') {
    const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(page))), ...(fragment.trim() ? { search: fragment.trim() } : {}) })
    const label = `${attachment.fileName} · strona ${Math.max(1, Math.floor(page))}${fragment.trim() ? ' · cytat' : ''}`
    insertTextIntoNote(`[${label}](./assets/${encodeURIComponent(attachment.fileName)}#${params.toString()})`, attachment.noteId)
  }

  function openAttachment(fileName: string, noteId = selectedId, page = 1, fragment = '') {
    const attachment = attachments.find(item => item.noteId === noteId && item.fileName === fileName)
    if (attachment && (!attachment.mimeType.startsWith('audio/') || featureFlags.audioNotes)) {
      setPreviewAttachmentPage(Math.max(1, page || 1))
      setPreviewAttachmentFragment(fragment)
      setPreviewAttachmentId(attachment.id)
    }
  }

  function openAttachmentPreview(attachment: NoteAttachment) {
    setPreviewAttachmentPage(1)
    setPreviewAttachmentFragment('')
    setPreviewAttachmentId(attachment.id)
  }

  async function recognizeAttachmentText(attachment: NoteAttachment): Promise<string> {
    if (!ollamaModel.trim()) throw new Error('Ustaw model obsługujący obrazy w ustawieniach Ollama.')
    const sourceNote = notes.find(note => note.id === attachment.noteId)
    if (sourceNote && !aiCanAccessNote(sourceNote)) throw new Error('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.')
    return runAiTask(`OCR załącznika · ${attachment.fileName}`, async signal => {
    const startedAt = Date.now()
    let selectedModel = ollamaModel
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
        await streamOllamaMessageWithFallback(ollamaBaseUrl, ollamaModel, aiPreferences.fallbackModel, [{ role: 'user', content: `Odczytaj wiernie cały widoczny tekst z załączonych stron PDF ${firstPage}–${lastPage} z ${pdf.totalPages}, także odręczne notatki i dopiski. Zachowaj kolejność, podziały na akapity i tabele w Markdown. Nie dopowiadaj nieczytelnych słów; oznacz je jako [nieczytelne]. Zwróć wyłącznie rozpoznany tekst.`, images: pdf.pages.map(page => page.base64) }], chunk => { batchResult += chunk }, signal, undefined, fallback => { selectedModel = fallback }, used => { selectedModel = used })
        sections.push(batchResult.trim())
        pageCount = pdf.totalPages
        pageStart = lastPage + 1
      }
      if (!pageCount) throw new Error('Nie udało się wczytać stron dokumentu.')
      const text = sections.filter(Boolean).join('\n\n')
      if (!text) throw new Error('Model nie rozpoznał tekstu.')
      saveAiDiagnostic({ task: 'ocr', model: selectedModel, contextCharacters: 0, contextImages: Math.min(20, pageCount), durationMs: Date.now() - startedAt, createdAt: Date.now() })
      return text
    }
    const images = [await imageAttachmentToPngBase64(attachment.dataUrl)]
    let result = ''
    await streamOllamaMessageWithFallback(ollamaBaseUrl, ollamaModel, aiPreferences.fallbackModel, [{ role: 'user', content: 'Odczytaj wiernie cały widoczny tekst z załączonego obrazu, w tym odręczne notatki, pismo odręczne i dopiski. Zachowaj kolejność, podziały na akapity i tabele w Markdown. Nie zgaduj nieczytelnych słów; oznacz je jako [nieczytelne]. Zwróć wyłącznie rozpoznany tekst.', images }], chunk => { result += chunk }, signal, undefined, fallback => { selectedModel = fallback }, used => { selectedModel = used })
    if (!result.trim()) throw new Error('Model nie rozpoznał tekstu.')
    saveAiDiagnostic({ task: 'ocr', model: selectedModel, contextCharacters: 0, contextImages: images.length, durationMs: Date.now() - startedAt, createdAt: Date.now() })
    return result.trim()
    })
  }

  async function indexAttachment(attachment: NoteAttachment) {
    setAttachmentIndexing(attachment.id)
    const startedAt = Date.now()
    try {
      const extractedText = await recognizeAttachmentText(attachment)
      await saveAttachmentExtractedText(attachment, extractedText)
      setToast(`Zaindeksowano tekst: ${attachment.fileName}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Nie udało się zaindeksować załącznika.'
      saveAiDiagnostic({ task: 'ocr', model: ollamaModel, contextCharacters: 0, contextImages: 0, durationMs: Date.now() - startedAt, error: detail, createdAt: Date.now() })
      setToast(detail)
    } finally {
      setAttachmentIndexing('')
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  async function mergeDuplicateNotes(targetId: string, sourceId: string) {
    if (targetId === sourceId) return
    const target = notesWithAvailableContent.find(note => note.id === targetId)
    const source = notesWithAvailableContent.find(note => note.id === sourceId)
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
      const nextTrash = [...await trashNoteData(new Set([sourceId])), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
      clearRecoveryDraftForNotes(new Set([sourceId]))
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
    const note = notesWithAvailableContent.find(item => item.id === attachment.noteId)
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
    setShowCreateNotePage(false)
    setSaved(false)
    void saveNote(note).then(async () => {
      await saveNoteVersion(note)
      setSaved(true)
    }, () => setSaved(false))
    setNotes(current => [note, ...current])
    if (folder) setFolderRegistry(current => [...new Set([...current, ...folderParents(folder)])])
    setEditorSelection({ noteId: note.id, mode: editorMode, text: '' })
    setSelectedId(note.id)
    setEditorRevision(value => value + 1)
    setMobileDrawer('none')
  }, [activeFilter, editorMode])

  const openCreateNote = useCallback(() => {
    const initialFolder = activeReviewSessionId === ALL_NOTES_PAGE_ID
      ? allNotesFolderPreset === '__root__' ? '' : allNotesFolderPreset || 'Osobiste'
      : activeFilter === 'root' ? '' : activeFilter !== 'all' && activeFilter !== 'favorites' && !activeFilter.startsWith('smart:') ? activeFilter : 'Osobiste'
    setCreateNoteInitialFolder(initialFolder)
    setActiveReviewSessionId('')
    setShowCreateNotePage(true)
    setMobileDrawer('none')
  }, [activeFilter, activeReviewSessionId, allNotesFolderPreset])

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
    setOrganizationSettings(current => ({ ...current, folderOrder: current.folderOrder.map(relocate), folderTemplateDefaults: Object.fromEntries(Object.entries(current.folderTemplateDefaults).map(([folder, templateId]) => [relocate(folder), templateId])) }))
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
    if (event.button !== 0 || entryPointerDrag.current) return
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

  function handleEntryDrop(target: EntryTarget, destination: EntryDropDestination) {
    if (destination.kind === 'grid-slot') {
      if (target.kind === 'note') openNoteInGridSlot(target.id, destination.noteId)
      return
    }
    if (target.kind === 'note') moveNoteToFolder(target.id, destination.path)
    else moveFolder(target.path, destination.path)
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

  function clearRecoveryDraftForNotes(noteIdsToRemove: Set<string>) {
    try {
      const draft = JSON.parse(localStorage.getItem(NOTE_RECOVERY_DRAFT_KEY) || 'null') as NoteRecoveryDraft | null
      if (draft?.note && noteIdsToRemove.has(draft.note.id)) localStorage.removeItem(NOTE_RECOVERY_DRAFT_KEY)
    } catch { /* Ignore stale or unavailable recovery metadata. */ }
  }

  async function commitRename() {
    const value = renameDraft.trim()
    const target = renameTarget
    if (!target || !value) return
    if (target.kind === 'note') {
      const renamed = notesRef.current.find(note => note.id === target.id)
      setRenameTarget(null)
      setRenameDraft('')
      if (renamed && renamed.title !== value) {
        setToast('Zmieniam nazwę i aktualizuję odnośniki…')
        const candidates = notesRef.current.filter(note => note.id !== renamed.id)
        for (let offset = 0; offset < candidates.length; offset += 24) {
          const batch = candidates.slice(offset, offset + 24)
          const bodies = await Promise.all(batch.map(async note => {
            const pending = pendingContentPatches.current.get(note.id)?.content
            const cached = noteBodiesRef.current.get(note.id)
            if (pending !== undefined) return pending
            if (cached !== undefined) return cached
            if (note.contentLoaded !== false) return note.content
            try { return await getNoteBody(note.id) } catch (error) { reportDiskSaveError(error); return '' }
          }))
          batch.forEach((note, index) => {
            const original = bodies[index] ?? ''
            const content = replaceWikiLinkTarget(original, renamed.title, value)
            if (content === original) return
            pendingContentPreviousBodies.current.set(note.id, original)
            patchNote(note.id, { content })
          })
          if (offset + batch.length < candidates.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        }
        setToast('Zmieniono nazwę i odnośniki do notatki.')
        window.setTimeout(() => setToast(''), 3000)
      }
      patchNote(target.id, { title: value, aliases: renamed && renamed.title !== value ? [...new Set([...(renamed.aliases ?? []), renamed.title].filter(Boolean))] : renamed?.aliases })
    } else {
      if (value.includes('/') || value.includes('\\')) {
        setToast('Nazwa folderu nie może zawierać ukośnika')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      const parts = target.path.split('/')
      parts[parts.length - 1] = value
      const destination = parts.join('/')
      if (destination !== target.path && folders.includes(destination)) {
        setToast('Folder o tej nazwie już istnieje')
        window.setTimeout(() => setToast(''), 2800)
        return
      }
      const source = target.path
      const relocate = (folder: string) => folder === source ? destination : folder.startsWith(`${source}/`) ? `${destination}${folder.slice(source.length)}` : folder
      setFolderRegistry([...new Set(folders.map(relocate).flatMap(folderParents))])
      setFolderColors(current => relocateFolderColors(current, source, destination))
      setOrganizationSettings(current => ({ ...current, folderOrder: current.folderOrder.map(relocate), folderTemplateDefaults: Object.fromEntries(Object.entries(current.folderTemplateDefaults).map(([folder, templateId]) => [relocate(folder), templateId])) }))
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
    clearRecoveryDraftForNotes(new Set([id]))
    const entries = await trashNoteData(new Set([id]))
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
        const nextTrash = [...await trashNoteData(removedIdsForTrash), ...trashEntries].filter(entry => Date.now() - entry.deletedAt < 30 * 86_400_000)
        await saveTrashEntries(nextTrash)
        setTrashEntries(nextTrash)
        await Promise.all(removedNotes.map(async note => {
          await removeAssetsForNote(note.id)
          await removeAttachmentsForNote(note.id)
          await removeNote(note.id)
        }))
        const removedIds = new Set(removedNotes.map(note => note.id))
        clearRecoveryDraftForNotes(removedIds)
        removeNotesFromReviewSessions(removedIds)
        setAssets(current => current.filter(asset => !removedIds.has(asset.noteId)))
        setAttachments(current => current.filter(attachment => !removedIds.has(attachment.noteId)))
        setNotes(current => current.filter(note => !removedIds.has(note.id)))
        setFlashcards(current => current.filter(card => !removedIds.has(card.noteId)))
        if (selectedId && removedIds.has(selectedId)) selectNote(notes.find(note => !removedIds.has(note.id))?.id ?? '')
        const nextFolders = folders.filter(folder => folder !== target.path && !folder.startsWith(`${target.path}/`))
        setFolderRegistry(nextFolders)
        setFolderColors(current => Object.fromEntries(Object.entries(current).filter(([folder]) => folder !== target.path && !folder.startsWith(`${target.path}/`))))
        setOrganizationSettings(current => ({ ...current, folderOrder: current.folderOrder.filter(folder => folder !== target.path && !folder.startsWith(`${target.path}/`)), folderTemplateDefaults: Object.fromEntries(Object.entries(current.folderTemplateDefaults).filter(([folder]) => folder !== target.path && !folder.startsWith(`${target.path}/`))) }))
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

  function renderEntryMenu(target: EntryTarget, cachedSiblings?: string[]): React.ReactNode {
    const key = menuKey(target)
    const folderSiblings = target.kind === 'folder' ? cachedSiblings ?? folders.filter(folder => {
      const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
      return (folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '') === parent
    }) : []
    const folderIndex = target.kind === 'folder' ? folderSiblingIndexes.get(target.path) ?? folderSiblings.indexOf(target.path) : -1
    return <div className="entry-actions" onClick={event => event.stopPropagation()}>
      <button className="entry-more-button" title="Więcej opcji" aria-label="Więcej opcji" aria-expanded={openActionMenu === key} onClick={() => setOpenActionMenu(current => current === key ? '' : key)}><MoreVertical size={16} /></button>
      {openActionMenu === key && <div className="sidebar-context-menu" role="menu">
        {target.kind === 'folder' && <>
          <button role="menuitem" disabled={folderIndex <= 0} onClick={() => { reorderFolder(target.path, -1); setOpenActionMenu('') }}><ChevronUp size={14} />Przenieś wyżej</button>
          <button role="menuitem" disabled={folderIndex < 0 || folderIndex >= folderSiblings.length - 1} onClick={() => { reorderFolder(target.path, 1); setOpenActionMenu('') }}><ChevronDown size={14} />Przenieś niżej</button>
        </>}
        <button role="menuitem" onClick={() => { setColorTarget(target); setOpenActionMenu('') }}><Palette size={14} />Ustaw kolor</button>
        <button role="menuitem" onClick={() => beginRename(target)}><Pencil size={14} />Zmień nazwę</button>
        <button className="danger-menu-item" role="menuitem" onClick={() => askDelete(target)}><Trash2 size={14} />Usuń</button>
      </div>}
    </div>
  }

  function renderNoteFile(note: Note, depth = 0): React.ReactNode {
    const target: EntryTarget = { kind: 'note', id: note.id }
    const color = noteDisplayColor(note)
    return <div data-drop-folder={note.folder} className={`folder-file-row ${selectedId === note.id ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={{ paddingLeft: `${22 + depth * 10}px`, ...(entryColorStyle(color) ?? {}) }}>
      <button className={`folder-file-item ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, target, note.title || 'Bez tytułu')} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); setActiveFilter(note.folder ? note.folder : 'root'); selectNote(note.id); setMobileDrawer('none') }} title="Przeciągnij notatkę do innego folderu"><FileText size={13} /><span>{note.title || 'Bez tytułu'}</span></button>
      {renderEntryMenu(target)}
    </div>
  }

  function toggleFolderExpansion(folder: string) {
    setCollapsedFolders(current => {
      const next = new Set(current)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  function folderDisplayColor(folder: string): string | undefined {
    return effectiveFolderColors.get(folder)
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

  function toggleFoldersPanel() {
    setShowFoldersPanel(current => {
      const next = !current
      localStorage.setItem('no-tie-folders-panel-visible', String(next))
      return next
    })
  }

  function isCompactLayout() {
    return window.matchMedia('(max-width: 1024px)').matches
  }

  function toggleSidebarPanel() {
    if (isCompactLayout()) {
      setMobileDrawer(current => current === 'sidebar' ? 'none' : 'sidebar')
      return
    }
    toggleMainSidebar()
  }

  function sidebarPanelIsVisible() {
    return isCompactLayout() ? mobileDrawer === 'sidebar' : showMainSidebar
  }

  function toggleLibraryPanel() {
    if (isCompactLayout()) {
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
    return isCompactLayout() ? mobileDrawer === 'notes' : showLibrary
  }

  function toggleFoldersPanelDrawer() {
    if (isCompactLayout()) {
      if (!showFoldersPanel) {
        localStorage.setItem('no-tie-folders-panel-visible', 'true')
        setShowFoldersPanel(true)
      }
      setMobileDrawer(current => current === 'folders' ? 'none' : 'folders')
      return
    }
    toggleFoldersPanel()
  }

  function foldersPanelIsVisible() {
    return isCompactLayout() ? mobileDrawer === 'folders' : showFoldersPanel
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
    if (automaticBackupRunning.current || !libraryPayloadsReady) return
    const snapshot = backupSnapshotRef.current
    if (!snapshot.notes.length) return
    automaticBackupRunning.current = true
    setBackupBusy(true)
    try {
      const diskNotes = await getNotes()
      const diskById = new Map(diskNotes.map(note => [note.id, note]))
      const backupNotes = snapshot.notes.map(note => {
        const pending = pendingContentPatches.current.get(note.id)
        const content = pending?.content ?? noteBodiesRef.current.get(note.id) ?? diskById.get(note.id)?.content ?? ''
        return { ...note, content, contentLoaded: true }
      })
      await Promise.all(backupNotes.map(note => flushNoteVersion(note.id, note)))
      const versions = (await Promise.all(backupNotes.map(note => getNoteVersions(note.id)))).flat()
      const attachmentHistory = (await Promise.all(backupNotes.map(note => getAttachmentHistory(note.id)))).flat()
      const workspace = { reviewSessions: snapshot.reviewSessions, savedSearches: snapshot.savedSearches, noteTemplates: snapshot.templates, folderColors: snapshot.folderColors, flashcards: snapshot.flashcards, flashcardTrash: snapshot.flashcardTrash, trash: snapshot.trashEntries, organization: snapshot.organizationSettings }
      const { buildArchive } = await import('./archive')
      const info = await saveAutoBackup(buildArchive(backupNotes, snapshot.assets, versions, snapshot.attachments, workspace, attachmentHistory))
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
    if (!ready || !libraryPayloadsReady) return
    const checkBackupSchedule = () => {
      const previous = Number(localStorage.getItem('no-tie-last-automatic-backup') ?? '0')
      if (Date.now() - previous >= 86_400_000) void createAutomaticBackup(true)
    }
    checkBackupSchedule()
    const interval = window.setInterval(checkBackupSchedule, 60 * 60_000)
    return () => window.clearInterval(interval)
  }, [ready, libraryPayloadsReady])

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

  function beginFlashcardAiTask(label: string) {
    const id = ++nextFlashcardAiTaskId.current
    setFlashcardAiTasks(current => [...current, { id, label, startedAt: Date.now(), state: 'running' }])
    return id
  }
  function finishFlashcardAiTask(id: number, failed = false, result = '') {
    const finishedAt = Date.now()
    const savedResult = result.trim()
    setFlashcardAiTasks(current => current.map(task => task.id === id ? { ...task, finishedAt, state: failed ? 'error' : 'done', result: savedResult || undefined, resultExpanded: Boolean(savedResult) && (!showingFlashcardsPageRef.current || task.label === 'Kontrola jakości fiszek' || task.label === 'Analiza pokrycia tematów') } : task))
    if (!savedResult) window.setTimeout(() => setFlashcardAiTasks(current => current.filter(task => task.id !== id)), 3500)
  }
  function toggleFlashcardAiTaskResult(id: number) {
    setFlashcardAiTasks(current => current.map(task => task.id === id ? { ...task, resultExpanded: !task.resultExpanded } : task))
  }
  function dismissFlashcardAiTask(id: number) {
    setFlashcardAiTasks(current => current.filter(task => task.id !== id))
  }
  function createFlashcard(noteId: string, question: string, answer: string, kind: FlashcardKind = 'basic', tags: string[] = [], imageOcclusion?: FlashcardImageOcclusion, metadata: Partial<Flashcard> = {}) {
    const now = Date.now()
    setFlashcards(current => [{ id: crypto.randomUUID(), noteId, question, answer, kind, tags, ...metadata, studyMode: metadata.studyMode ?? 'flip', imageOcclusion: kind === 'image-occlusion' ? imageOcclusion : undefined, dueAt: now, intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0 }, ...current])
  }

  function updateFlashcard(id: string, edit: Partial<Flashcard>) {
    setFlashcards(current => current.map(card => card.id === id ? { ...card, ...edit } : card))
  }

  function toggleFlashcardSuspended(id: string) {
    setFlashcards(current => current.map(card => card.id === id ? { ...card, suspended: !card.suspended } : card))
  }

  function setFlashcardDueAt(id: string, dueAt: number) {
    setFlashcards(current => current.map(card => card.id === id ? { ...card, dueAt } : card))
  }

  function rateFlashcard(id: string, grade: FlashcardGrade, metadata?: FlashcardReviewMeta) {
    setFlashcards(current => current.map(card => card.id === id ? reviewFlashcard(card, grade, Date.now(), metadata) : card))
  }

  function trashFlashcard(card: Flashcard) {
    setFlashcards(current => current.filter(item => item.id !== card.id))
    setFlashcardTrash(current => [{ id: crypto.randomUUID(), deletedAt: Date.now(), card }, ...current])
  }

  function restoreFlashcardTrash(id: string) {
    const entry = flashcardTrash.find(item => item.id === id)
    if (!entry) return
    setFlashcards(current => current.some(card => card.id === entry.card.id) ? current : [entry.card, ...current])
    setFlashcardTrash(current => current.filter(item => item.id !== id))
  }

  async function regenerateFlashcard(card: Flashcard): Promise<{ question: string; answer: string }> {
    return runAiTask(`Popraw fiszkę · ${card.question.slice(0, 45)}`, async signal => {
    const noteHeader = resolveWikiTarget(notes, card.noteId)
    if (!noteHeader) throw new Error('Nie znaleziono notatki źródłowej tej fiszki.')
    if (!aiCanAccessNote(noteHeader)) throw new Error('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.')
    const note = noteHeader.contentLoaded === false ? { ...noteHeader, content: await getNoteBody(noteHeader.id), contentLoaded: true } : noteHeader
    if (!ollamaModel.trim()) throw new Error('Wybierz model Ollama w ustawieniach.')

    const contextImages: string[] = []
    const attachmentSections: string[] = []
    for (const attachment of attachments.filter(item => item.noteId === note.id)) {
      let transcript = attachment.transcript?.trim() || attachment.transcriptSegments?.map(segment => segment.text.trim()).filter(Boolean).join('\n') || ''
      if (attachment.mimeType.startsWith('audio/') && !transcript && featureFlags.audioNotes) transcript = (await transcribeAudioAttachment(attachment)).trim()
      const textSections = [
        transcript,
        attachment.extractedText?.trim(),
        attachment.pdfAnnotations?.map(annotation => `Strona ${annotation.page}${annotation.quote ? `, cytat: „${annotation.quote}”` : ''}: ${annotation.text}`).join('\n'),
      ].filter((value): value is string => Boolean(value))

      if (attachment.mimeType === 'application/pdf' && !attachment.extractedText?.trim()) {
        try {
          const { pdfAttachmentToText } = await import('./pdfVision')
          const extracted = await pdfAttachmentToText(attachment.dataUrl, 24, 9_000)
          if (extracted.text.trim()) textSections.push(extracted.text.trim())
          else if (contextImages.length < 6) {
            const { pdfAttachmentToVisionPages } = await import('./pdfVision')
            const pages = await pdfAttachmentToVisionPages(attachment.dataUrl, 6 - contextImages.length)
            contextImages.push(...pages.pages.map(page => page.base64))
          }
        } catch { /* Continue with any text already extracted from the PDF. */ }
      } else if (attachment.mimeType.startsWith('image/') && !attachment.extractedText?.trim() && contextImages.length < 6) {
        try { contextImages.push(await imageAttachmentToPngBase64(attachment.dataUrl)) } catch { /* Continue with the note and readable attachment text. */ }
      }
      if (textSections.length) attachmentSections.push(`ZAŁĄCZNIK „${attachment.fileName}”:\n${textSections.join('\n\n')}`)
    }

    const sourceText = `NOTATKA: ${note.title || 'Bez tytułu'}\nFolder: ${note.folder || 'Bez folderu'}\nTagi: ${note.tags.join(', ') || 'brak'}\n\n${note.content.slice(0, 28_000)}\n\nZAŁĄCZNIKI:\n${attachmentSections.join('\n\n').slice(0, 14_000)}`
    let result = ''
    await streamOllamaMessageWithFallback(ollamaBaseUrl, ollamaModel, aiPreferences.fallbackModel, [{
      role: 'user',
      content: `Popraw poniższą fiszkę, zachowując zgodność z materiałem. Uczyń pytanie jednoznacznym i skupionym na jednej istotnej informacji, a odpowiedź krótką i precyzyjną. Nie dodawaj faktów spoza źródła. Zwróć wyłącznie obiekt JSON z polami string "question" i "answer".\n\nOBECNA FISZKA:\nPytanie: ${card.question}\nOdpowiedź: ${card.answer}\n\nMATERIAŁ ŹRÓDŁOWY:\n${sourceText}`,
      images: contextImages.length ? contextImages : undefined,
    }], chunk => { result += chunk }, signal)
    const fenced = result.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const start = result.indexOf('{')
    const end = result.lastIndexOf('}')
    const candidate = fenced?.trim() || (start >= 0 && end > start ? result.slice(start, end + 1) : '')
    if (!candidate) throw new Error('Model nie zwrócił poprawionej fiszki.')
    let parsed: unknown
    try { parsed = JSON.parse(candidate) } catch { throw new Error('Odpowiedź modelu nie zawiera poprawnego JSON.') }
    if (!parsed || typeof parsed !== 'object') throw new Error('Model nie zwrócił obiektu fiszki.')
    const row = parsed as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (!question || !answer) throw new Error('Poprawiona fiszka nie zawiera pytania i odpowiedzi.')
    return { question, answer }
    })
  }

  async function findSimilarFlashcards(candidates: readonly Flashcard[]): Promise<{ firstId: string; secondId: string; score: number }[]> {
    return runAiTask('Wykrywanie podobnych fiszek', async signal => {
    const cardsToCompare = candidates.filter(card => card.question.trim() && (!card.noteId || aiAccessibleNoteIds.has(card.noteId)))
    if (cardsToCompare.length < 2) return []
    if (cardsToCompare.length > 300) throw new Error('Zawęź listę filtrami do maksymalnie 300 kart, aby porównać ich pytania.')
    if (!embeddingModel.trim()) throw new Error('Ustaw model embeddingów w ustawieniach Ollama.')
    const vectors: number[][] = []
    for (let start = 0; start < cardsToCompare.length; start += 64) {
      if (signal.aborted) throw new Error('Zadanie AI anulowano.')
      const batch = cardsToCompare.slice(start, start + 64)
      try { vectors.push(...await embedOllamaTexts(ollamaBaseUrl, embeddingModel, batch.map(card => card.question))) }
      catch (error) {
        const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
        if (/model.{0,120}(not found|does not exist|nie znaleziono|nie istnieje)|(not found|does not exist|nie znaleziono|nie istnieje).{0,120}model/i.test(detail)) {
          if (/ollama pull/i.test(detail)) throw new Error(detail)
          throw new Error(`Nie znaleziono modelu embeddingów „${embeddingModel}”. Pobierz go poleceniem: ollama pull ${embeddingModel}. Szczegóły: ${detail}`)
        }
        throw error
      }
    }
    if (vectors.length !== cardsToCompare.length) {
      throw new Error(`Ollama zwróciła ${vectors.length} wektorów dla ${cardsToCompare.length} fiszek. Sprawdź kompatybilność serwera i modelu embeddingów.`)
    }
    const dimensions = vectors[0]?.length ?? 0
    if (!dimensions || vectors.some(vector => vector.length !== dimensions || vector.some(value => !Number.isFinite(value)))) {
      throw new Error('Model Ollama zwrócił nieprawidłowe wektory embeddingów. Sprawdź, czy wybrany model obsługuje embeddingi.')
    }
    const normalizedVectors = vectors.map(vector => {
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
      return vector.map(value => value / norm)
    })
    const matches: { firstId: string; secondId: string; score: number }[] = []
    for (let first = 0; first < cardsToCompare.length; first += 1) {
      for (let second = first + 1; second < cardsToCompare.length; second += 1) {
        const left = normalizedVectors[first] ?? []
        const right = normalizedVectors[second] ?? []
        let score = 0
        for (let index = 0; index < Math.min(left.length, right.length); index += 1) score += left[index]! * right[index]!
        if (score >= .78) matches.push({ firstId: cardsToCompare[first]!.id, secondId: cardsToCompare[second]!.id, score })
      }
      if (first % 8 === 7) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
    return matches.sort((left, right) => right.score - left.score).slice(0, 30)
    })
  }

  async function assistFlashcards(action: FlashcardAiAction, card?: Flashcard, input = ''): Promise<string> {
    return runAiTask(`Pomoc AI przy fiszkach · ${action}`, async signal => {
    const startedAt = Date.now()
    if (!ollamaModel.trim()) throw new Error('Wybierz model Ollama w ustawieniach.')
    if (card) {
      const note = resolveWikiTarget(notes, card.noteId)
      if (note && !aiCanAccessNote(note)) throw new Error('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.')
    }
    let safeInput = input
    if (['quality', 'coverage', 'tags'].includes(action) && input.trim()) {
      try {
        const sourceRows: unknown = JSON.parse(input)
        if (Array.isArray(sourceRows)) {
          const accessibleCards = flashcards.filter(item => {
            const sourceNote = resolveWikiTarget(notes, item.noteId)
            return !sourceNote || aiCanAccessNote(sourceNote)
          })
          const accessibleIds = new Set(accessibleCards.map(item => item.id))
          const accessibleQuestions = new Set(accessibleCards.map(item => `${normalizeAiText(item.question)}\u0000${normalizeAiText(item.answer)}`))
          const rows = sourceRows.filter(row => {
            if (!row || typeof row !== 'object') return false
            const item = row as { id?: unknown; question?: unknown; answer?: unknown }
            if (typeof item.id === 'string') return accessibleIds.has(item.id)
            return typeof item.question === 'string' && accessibleQuestions.has(`${normalizeAiText(item.question)}\u0000${normalizeAiText(typeof item.answer === 'string' ? item.answer : '')}`)
          })
          safeInput = JSON.stringify(rows)
          if (!rows.length) throw new Error('Żadna z wybranych fiszek nie pochodzi z folderu dostępnego dla AI.')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('folderu dostępnego')) throw error
        if (aiPreferences.folderAccessRestricted) throw new Error('Nie udało się sprawdzić dostępu do źródeł fiszek dla AI.')
      }
    }
    const cardContext = card ? 'Pytanie: ' + card.question + '\nOdpowiedź: ' + card.answer + '\nAkceptowane warianty: ' + (card.answerVariants ?? []).join('; ') + '\nTagi: ' + (card.tags ?? []).join(', ') : ''
    const instructions: Record<FlashcardAiAction, string> = {
      evaluate: 'Porównaj odpowiedź ucznia z odpowiedzią wzorcową do fiszki. Oceń merytorycznie, także gdy sformułowanie jest inne: wskaż, co jest poprawne, czego brakuje, co jest błędne i czy odpowiedź jest w pełni poprawna, częściowa czy niepoprawna. Zwróć krótki feedback po polsku. Nie wymagaj identycznych słów i nie dodawaj faktów spoza odpowiedzi wzorcowej.\n' + cardContext + '\nOdpowiedź ucznia: ' + input,
      distractors: 'Wygeneruj 3 wiarygodne, ale błędne odpowiedzi do pytania wielokrotnego wyboru. Nie powtarzaj poprawnej odpowiedzi ani jej wariantów. Zwróć wyłącznie JSON array stringów.\n' + cardContext,
      quality: 'Przeprowadź kontrolę jakości fiszek. Dla każdej wskaż niejednoznaczne, zbyt szerokie, błędne lub powtarzalne pytania i zaproponuj konkretną poprawę. Jeśli karta jest dobra, napisz to. Zwróć raport po polsku. Dane: ' + safeInput,
      coverage: 'Pogrupuj fiszki w tematy, wskaż najważniejsze zagadnienia niepokryte przez pytania oraz nierównowagę między tematami. Nie wymyślaj treści źródła. Zwróć zwięzły raport po polsku. Dane: ' + safeInput,
      tags: 'Nadaj każdej fiszce 1–4 krótkie tagi tematyczne po polsku. Zachowaj identyfikatory. Zwróć wyłącznie JSON array obiektów {"id":string,"tags":string[]}. Dane: ' + safeInput,
      example: 'Podaj krótki trafny przykład i kontrprzykład ilustrujący pojęcie z fiszki. Używaj wyłącznie faktów zgodnych z kartą. Zwróć tekst po polsku z etykietami „Przykład” i „Kontrprzykład”.\n' + cardContext,
      mnemonic: 'Utwórz łatwe do zapamiętania skojarzenie, mnemotechnikę lub analogię pomagającą przypomnieć odpowiedź. Nie zmieniaj znaczenia. Zwróć krótki tekst po polsku.\n' + cardContext,
      difficulty: 'Przepisz fiszkę na poziom ' + input + '. Zachowaj poprawność i tę samą wiedzę. Poziom początkujący używa prostego języka, zaawansowany może wymagać dokładniejszego rozumowania. Zwróć wyłącznie JSON z polami string question i answer.\n' + cardContext,
    }
    let result = ''
    const selectedProfile = aiPreferences.promptProfiles.filter(profile => profile.task === 'flashcard-assist').at(-1)
    const profilePrompt = selectedProfile?.prompt.trim() ? `\nPreferencje profilu „${selectedProfile.name}”: ${selectedProfile.prompt.trim()}` : ''
    const ratingPrompt = aiPreferences.ratings.filter(item => item.task === 'flashcard-assist').slice(-3).map(item => `${item.rating > 0 ? 'Zachowaj dobre cechy poprzedniego wyniku' : 'Popraw poprzedni wynik'}${item.comment ? `: ${item.comment}` : ''}`).join('\n')
    const prompt = `${instructions[action]}${profilePrompt}${ratingPrompt ? `\nPreferencje z ocen: ${ratingPrompt}` : ''}`
    let usedModel = ollamaModel
    try {
      await streamOllamaMessageWithFallback(ollamaBaseUrl, ollamaModel, aiPreferences.fallbackModel, [{ role: 'user', content: prompt }], chunk => { result += chunk }, signal, undefined, fallback => { result = ''; usedModel = fallback }, selected => { usedModel = selected })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Nie udało się uzyskać odpowiedzi modelu.'
      saveAiDiagnostic({ task: 'flashcard-assist', model: usedModel, contextCharacters: prompt.length, contextImages: 0, durationMs: Date.now() - startedAt, error: detail, createdAt: Date.now() })
      throw error
    }
    if (!result.trim()) throw new Error('Model nie zwrócił odpowiedzi.')
    saveAiDiagnostic({ task: 'flashcard-assist', model: usedModel, contextCharacters: prompt.length, contextImages: 0, durationMs: Date.now() - startedAt, createdAt: Date.now() })
    return result.trim()
    })
  }

  async function trashNoteData(noteIds: Set<string>, batchId = crypto.randomUUID()) {
    const deletedAt = Date.now()
    const targets = notes.filter(note => noteIds.has(note.id))
    const entries: TrashEntry[] = []
    for (let offset = 0; offset < targets.length; offset += 24) {
      const batch = targets.slice(offset, offset + 24)
      const notesWithContent = await Promise.all(batch.map(async note => {
        const pending = pendingContentPatches.current.get(note.id)?.content
        const cached = noteBodiesRef.current.get(note.id)
        const content = pending ?? cached ?? (note.contentLoaded === false ? await getNoteBody(note.id) : note.content)
        return { ...note, content, contentLoaded: true }
      }))
      entries.push(...notesWithContent.map(note => ({
        id: crypto.randomUUID(), batchId, deletedAt, note: copyNote(note),
        assets: assets.filter(asset => asset.noteId === note.id).map(asset => ({ ...asset })),
        attachments: attachments.filter(attachment => attachment.noteId === note.id).map(attachment => ({ ...attachment })),
      })))
      if (offset + batch.length < targets.length) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
    return entries
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

  function beginArchiveTask(action: ArchiveTaskState['action'], title: string): number {
    const id = ++archiveTaskSequence.current
    setToast('')
    setArchiveTask({ id, action, title, phase: 'Przygotowuję zadanie', percent: 0, completed: 0, total: 0, current: '', counterLabel: '', expanded: true, state: 'running', detail: '' })
    return id
  }

  function updateArchiveTask(id: number, updates: Partial<ArchiveTaskState>) {
    setArchiveTask(current => current?.id === id ? { ...current, ...updates } : current)
  }

  function completeArchiveTask(id: number, state: 'done' | 'error', detail: string) {
    updateArchiveTask(id, state === 'done'
      ? { state, detail, percent: 100, phase: 'Zakończono' }
      : { state, detail, phase: 'Nie udało się zakończyć' })
  }

  function archiveTaskProgress(id: number, progress: ArchiveTransferProgress) {
    if (progress.stage === 'unpack') {
      updateArchiveTask(id, { phase: 'Rozpakowuję pliki archiwum', percent: Math.min(66, 7 + progress.percent * 0.59), completed: progress.completed, total: progress.total, current: progress.current, counterLabel: 'plików' })
    } else if (progress.stage === 'parse') {
      updateArchiveTask(id, { phase: 'Analizuję notatki i linki', percent: Math.min(74, 68 + progress.percent * 0.06), completed: progress.completed, total: progress.total, current: progress.current, counterLabel: 'notatek' })
    } else if (progress.stage === 'compress') {
      updateArchiveTask(id, { phase: 'Kompresuję archiwum ZIP', percent: 8 + progress.percent * 0.82, completed: progress.completed, total: progress.total, current: progress.current, counterLabel: 'plików' })
    } else {
      updateArchiveTask(id, { phase: 'Zapisuję plik ZIP', percent: 96, completed: 0, total: 0, current: progress.current, counterLabel: '' })
    }
  }

  async function letProgressPaint() {
    await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
  }

  async function exportNotesArchive() {
    if (archiveTask?.state === 'running') return
    const taskId = beginArchiveTask('export', 'Eksport paczki No-Tie')
    try {
      await letProgressPaint()
      const diskNotes = await getNotes()
      const diskById = new Map(diskNotes.map(note => [note.id, note]))
      const exportNotes = notes.map(note => ({ ...note, content: pendingContentPatches.current.get(note.id)?.content ?? noteBodiesRef.current.get(note.id) ?? diskById.get(note.id)?.content ?? '', contentLoaded: true }))
      const versions: NoteVersion[] = []
      const attachmentHistory: NoteAttachmentHistory[] = []
      updateArchiveTask(taskId, { phase: 'Zbieram historię i ustawienia', percent: 3, completed: 0, total: exportNotes.length, current: '', counterLabel: 'notatek' })
      await processBatches(exportNotes, async note => {
        await flushNoteVersion(note.id, note)
        versions.push(...await getNoteVersions(note.id))
        attachmentHistory.push(...await getAttachmentHistory(note.id))
      }, (completed, note) => updateArchiveTask(taskId, { phase: 'Zbieram historię notatek', percent: 3 + Math.round((completed / Math.max(1, exportNotes.length)) * 4), completed, total: exportNotes.length, current: note.title || note.id, counterLabel: 'notatek' }))
      const workspace = { reviewSessions, savedSearches, noteTemplates: templates, folderColors, flashcards, flashcardTrash, trash: trashEntries, organization: organizationSettings }
      updateArchiveTask(taskId, { phase: 'Przygotowuję pliki do spakowania', percent: 7, completed: 0, total: exportNotes.length, counterLabel: 'notatek' })
      const { exportArchiveToFolder } = await import('./archive')
      const savedPath = await exportArchiveToFolder(exportNotes, assets, versions, attachments, workspace, attachmentHistory, progress => archiveTaskProgress(taskId, progress))
      if (!savedPath) { completeArchiveTask(taskId, 'done', 'Eksport został anulowany.'); return }
      completeArchiveTask(taskId, 'done', `Paczka została zapisana: ${savedPath}`)
    } catch (error) {
      completeArchiveTask(taskId, 'error', error instanceof Error ? error.message : 'Nie udało się przygotować paczki.')
    }
  }

  async function exportObsidianVault() {
    if (archiveTask?.state === 'running') return
    const taskId = beginArchiveTask('export', 'Eksport vaulta Obsidiana')
    try {
      await letProgressPaint()
      const diskNotes = await getNotes()
      const diskById = new Map(diskNotes.map(note => [note.id, note]))
      const exportNotes = notes.map(note => ({ ...note, content: pendingContentPatches.current.get(note.id)?.content ?? noteBodiesRef.current.get(note.id) ?? diskById.get(note.id)?.content ?? '', contentLoaded: true }))
      updateArchiveTask(taskId, { phase: 'Przygotowuję notatki i załączniki', percent: 5, completed: 0, total: notes.length, counterLabel: 'notatek' })
      const { exportObsidianVaultToFolder } = await import('./archive')
      const savedPath = await exportObsidianVaultToFolder(exportNotes, assets, attachments, progress => archiveTaskProgress(taskId, progress))
      if (!savedPath) { completeArchiveTask(taskId, 'done', 'Eksport został anulowany.'); return }
      completeArchiveTask(taskId, 'done', `Zapisano ${savedPath}. Rozpakuj ZIP i otwórz folder w Obsidianie.`)
    } catch (error) {
      completeArchiveTask(taskId, 'error', error instanceof Error ? error.message : 'Nie udało się przygotować eksportu do Obsidiana.')
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setShowCommandPalette(true)
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
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
    if (archiveTask?.state === 'running') { event.target.value = ''; return }
    const taskId = beginArchiveTask('import', 'Import notatek i załączników')
    try {
      await letProgressPaint()
      updateArchiveTask(taskId, { phase: 'Odczytuję wybrany plik', percent: 3, current: file.name })
      let parsed: ParsedArchive
      if (file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown')) {
        const markdown = await file.text()
        const note = markdownToNote(markdown, crypto.randomUUID())
        note.id = crypto.randomUUID()
        const heading = note.content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
        if (!note.title || note.title === 'Importowana notatka') note.title = heading || file.name.replace(/\.(?:md|markdown)$/i, '').replace(/[-_]+/g, ' ')
        note.folder = 'Importowane'
        parsed = { notes: [note], assets: [], versions: [], attachments: [], attachmentHistory: [] }
        updateArchiveTask(taskId, { phase: 'Wczytano pojedynczą notatkę Markdown', percent: 68, completed: 1, total: 1, current: file.name, counterLabel: 'notatek' })
      } else {
        updateArchiveTask(taskId, { phase: 'Wczytuję zawartość archiwum', percent: 5, current: file.name })
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { parseArchive } = await import('./archive')
        parsed = await parseArchive(bytes, progress => archiveTaskProgress(taskId, progress))
      }
      updateArchiveTask(taskId, { phase: 'Zapisuję notatki i załączniki', percent: 75, completed: 0, total: parsed.notes.length + parsed.assets.length + parsed.attachments.length, current: '' })
      await applyParsedArchive(parsed, false, progress => updateArchiveTask(taskId, {
        phase: progress.phase,
        percent: progress.phase.startsWith('Czyszczę') ? 75 + Math.round((progress.completed / Math.max(1, progress.total)) * 4) : 79 + Math.round((progress.completed / Math.max(1, progress.total)) * 20),
        completed: progress.completed,
        total: progress.total,
        current: progress.current,
        counterLabel: 'elementów',
      }))
      completeArchiveTask(taskId, 'done', `Zaimportowano ${parsed.notes.length} notatek oraz ${parsed.assets.length + parsed.attachments.length} załączników.`)
    } catch (error) {
      completeArchiveTask(taskId, 'error', error instanceof Error ? error.message : 'Nie udało się zaimportować pliku.')
    }
    event.target.value = ''
  }

  async function applyParsedArchive(imported: ParsedArchive, replaceExisting = false, onProgress?: (progress: ArchiveApplyProgress) => void) {
    setSaved(false)
    if (replaceExisting) {
      await processBatches(notes, async note => {
        await removeAssetsForNote(note.id)
        await removeAttachmentsForNote(note.id)
        await removeNote(note.id)
      }, (completed, note) => onProgress?.({ phase: 'Czyszczę istniejące notatki', completed, total: Math.max(1, notes.length), current: note.title || note.id }))
    }
    const totalItems = imported.notes.length + imported.assets.length + imported.attachments.length + imported.attachmentHistory.length
    let savedItems = 0
    const noteProgress = (completed: number, note: Note) => {
      savedItems = completed
      onProgress?.({ phase: 'Zapisuję notatki', completed: savedItems, total: totalItems, current: note.title || note.id })
    }
    await processBatches(imported.notes, async note => {
      if (!replaceExisting && notes.some(existing => existing.id === note.id)) {
        await removeAssetsForNote(note.id)
        await removeAttachmentsForNote(note.id)
      }
      await saveNote(note)
      const versions = imported.versions.filter(version => version.noteId === note.id)
      await saveNoteVersions(note.id, versions)
      if (!versions.length) await saveNoteVersion(note)
    }, noteProgress)
    await processBatches(imported.assets, saveAsset, (completed, asset) => {
      savedItems = imported.notes.length + completed
      onProgress?.({ phase: 'Zapisuję schematy SVG', completed: savedItems, total: totalItems, current: asset.fileName })
    })
    await processBatches(imported.attachments, saveAttachment, (completed, attachment) => {
      savedItems = imported.notes.length + imported.assets.length + completed
      onProgress?.({ phase: 'Zapisuję załączniki', completed: savedItems, total: totalItems, current: attachment.fileName })
    })
    await processBatches(imported.attachmentHistory, saveArchivedAttachment, (completed, attachment) => {
      savedItems = imported.notes.length + imported.assets.length + imported.attachments.length + completed
      onProgress?.({ phase: 'Zapisuję historię załączników', completed: savedItems, total: totalItems, current: attachment.fileName })
    })
    const importedIds = new Set(imported.notes.map(note => note.id))
    const nextNotes = (replaceExisting ? imported.notes : [...notes.filter(note => !importedIds.has(note.id)), ...imported.notes]).sort((a, b) => b.updatedAt - a.updatedAt)
    for (const note of imported.notes) {
      seenNoteObjects.current.set(note.id, note)
      pendingNoteSaves.current.delete(note.id)
    }
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
      if (imported.workspace.flashcardTrash) setFlashcardTrash(imported.workspace.flashcardTrash)
      if (imported.workspace.trash) setTrashEntries(imported.workspace.trash)
      if (imported.workspace.organization) setOrganizationSettings(imported.workspace.organization)
    }
    if (replaceExisting) setActiveFilter('all')
    if (imported.notes[0]) selectNote(imported.notes[0].id)
    setActiveReviewSessionId('')
    setEditorRevision(value => value + 1)
    setSaved(true)
    if (!onProgress) {
      setToast(`${replaceExisting ? 'Przywrócono' : 'Zaimportowano'} ${imported.notes.length} notatek.`)
      window.setTimeout(() => setToast(''), 3000)
    }
  }

  async function restoreAutomaticBackup(fileName: string) {
    setBackupBusy(true)
    const taskId = beginArchiveTask('import', 'Przywracanie kopii zapasowej')
    try {
      await letProgressPaint()
      updateArchiveTask(taskId, { phase: 'Odczytuję kopię zapasową', percent: 5, current: fileName })
      const backupBytes = await readAutoBackup(fileName)
      const { parseArchive } = await import('./archive')
      const imported = await parseArchive(backupBytes, progress => archiveTaskProgress(taskId, progress))
      await applyParsedArchive(imported, true, progress => updateArchiveTask(taskId, {
        phase: progress.phase,
        percent: progress.phase.startsWith('Czyszczę') ? 75 + Math.round((progress.completed / Math.max(1, progress.total)) * 4) : 79 + Math.round((progress.completed / Math.max(1, progress.total)) * 20),
        completed: progress.completed,
        total: progress.total,
        current: progress.current,
        counterLabel: 'elementów',
      }))
      completeArchiveTask(taskId, 'done', `Przywrócono kopię: ${imported.notes.length} notatek.`)
      setShowBackupTrash(false)
    } catch (error) {
      completeArchiveTask(taskId, 'error', errorMessage(error, 'Nie udało się przywrócić kopii zapasowej.'))
      reportDiskSaveError(error)
    } finally { setBackupBusy(false) }
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

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    if (!showCommandPalette) return []
    const openPage = (pageId: string, filter: Filter = 'all') => () => { setShowCreateNotePage(false); setActiveReviewSessionId(pageId); setActiveFilter(filter); setMobileDrawer('none') }
    const commands: PaletteCommand[] = [
      { id: 'all-notes', title: 'Wszystkie notatki', detail: 'Otwórz wyszukiwarkę i bibliotekę', group: 'Widoki', run: () => { setAllNotesPreset('all'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); openPage(ALL_NOTES_PAGE_ID)() } },
      { id: 'favorites', title: 'Ulubione', detail: 'Pokaż ulubione notatki', group: 'Widoki', run: () => { setAllNotesPreset('favorites'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); openPage(ALL_NOTES_PAGE_ID)() } },
      { id: 'recent', title: 'Ostatnie notatki', detail: 'Sortuj od ostatnio zmienionych', group: 'Widoki', run: () => { setAllNotesPreset('recent'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); openPage(ALL_NOTES_PAGE_ID)() } },
      { id: 'new-note', title: 'Nowa notatka', detail: 'Utwórz notatkę z szablonu', group: 'Narzędzia', run: openCreateNote },
      { id: 'flashcards', title: 'Fiszki', detail: 'Otwórz moduł fiszek', group: 'Narzędzia', run: openPage(FLASHCARDS_PAGE_ID) },
      { id: 'tasks', title: 'Zadania', detail: 'Otwórz listę zadań', group: 'Narzędzia', run: openPage(TASKS_PAGE_ID) },
      { id: 'reviews', title: 'Powtórki', detail: 'Otwórz plan nauki', group: 'Narzędzia', run: openPage(REVIEW_SESSIONS_OVERVIEW_ID) },
      { id: 'saved-searches', title: 'Zapisane widoki', detail: 'Otwórz zapisane wyszukiwania', group: 'Narzędzia', run: openPage(SAVED_SEARCHES_PAGE_ID) },
      { id: 'templates', title: 'Szablony', detail: 'Zarządzaj szablonami notatek', group: 'Narzędzia', run: openPage(NOTE_TEMPLATES_PAGE_ID) },
      { id: 'link-audit', title: 'Kontrola powiązań', detail: 'Znajdź zerwane linki i osierocone notatki', group: 'Narzędzia', run: openPage(LINK_AUDIT_PAGE_ID) },
      { id: 'collections', title: 'Kolekcje', detail: 'Grupuj notatki niezależnie od folderów', group: 'Narzędzia', run: openPage(COLLECTIONS_PAGE_ID) },
      { id: 'workspace-layouts', title: 'Obszary robocze', detail: 'Zapisz lub przywróć układ pracy', group: 'Narzędzia', run: () => { setShowWorkspaceLayouts(true); setMobileDrawer('none') } },
      { id: 'knowledge-graph', title: 'Mapa powiązań', detail: 'Przeglądaj sieć notatek', group: 'Narzędzia', run: () => setShowKnowledgeGraph(true) },
    ]
    for (const folder of folders) commands.push({ id: `folder:${folder}`, title: folder.split('/').at(-1) ?? folder, detail: `Folder · ${folder}`, group: 'Foldery', run: () => openAllNotesFolder(folder) })
    for (const collection of organizationSettings.collections) commands.push({ id: `collection:${collection.id}`, title: collection.name, detail: 'Kolekcja', group: 'Kolekcje', run: () => { setCollectionFocusId(collection.id); openPage(COLLECTIONS_PAGE_ID)() } })
    for (const search of savedSearches) commands.push({ id: `search:${search.id}`, title: search.name, detail: [search.query, search.tag, search.folder].filter(Boolean).join(' · ') || 'Zapisany widok', group: 'Zapisane widoki', run: () => { applySavedSearch(search); setMobileDrawer('none') } })
    for (const note of notes) commands.push({ id: `note:${note.id}`, title: note.title || 'Bez tytułu', detail: [note.folder || 'Poziom główny', ...(note.aliases ?? []), ...note.tags].join(' · '), group: 'Notatki', run: () => openLinkedNote(note.id) })
    return commands
  }, [showCommandPalette, folders, organizationSettings.collections, savedSearches, notes])

  if (!ready) {
    return <div className="loading-screen"><div className="brand-mark">N</div><p>Otwieram Twoje notatki…</p></div>
  }
  if (loadError) {
    return <div className="loading-screen"><div className="brand-mark">N</div><p>Nie udało się otworzyć notatek.</p><small className="storage-error">{loadError}</small></div>
  }

  return (
    <main className={`app-shell ${mobileDrawer !== 'none' ? 'drawer-open' : ''} ${entryDragVisual ? 'entry-dragging' : ''} ${showChat ? 'with-ollama-chat' : ''} ${showLibrary ? '' : 'library-hidden'} ${showMainSidebar ? '' : 'sidebar-hidden'} ${showFoldersPanel ? '' : 'folders-panel-hidden'}`}>
      {(showMainSidebar || mobileDrawer === 'sidebar') && <aside className={`sidebar ${mobileDrawer === 'sidebar' ? 'mobile-visible' : ''}`} onClickCapture={event => {
        const target = event.target
        if (target instanceof Element && target.closest('.nav-item, .folder-file-item')) setShowCreateNotePage(false)
      }}>
        <div className="sidebar-content">
          <div className="brand-row"><div className="brand-mark">N</div><span>No-Tie</span><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij menu"><X size={18} /></button></div>
          <button className="new-note-button" onClick={openCreateNote}><Plus size={17} /><span>Nowa notatka</span><kbd>N</kbd></button>
          <div className="sidebar-section">
            <span className="section-label">BIBLIOTEKA</span>
            <button className={`nav-item ${showingAllNotesPage && allNotesPreset === 'all' ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(ALL_NOTES_PAGE_ID); setAllNotesPreset('all'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); setActiveFilter('all'); setMobileDrawer('none') }}><BookOpen size={17} /><span>Wszystkie notatki</span><span className="nav-count">{notes.length}</span></button>
            <button className={`nav-item ${showingAllNotesPage && allNotesPreset === 'favorites' ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(ALL_NOTES_PAGE_ID); setAllNotesPreset('favorites'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); setActiveFilter('all'); setMobileDrawer('none') }}><Heart size={17} /><span>Ulubione</span><span className="nav-count">{favoriteNoteCount}</span></button>
            <button className={`nav-item ${showingAllNotesPage && allNotesPreset === 'recent' ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(ALL_NOTES_PAGE_ID); setAllNotesPreset('recent'); setAllNotesFolderPreset(''); setAllNotesPresetRevision(value => value + 1); setActiveFilter('all'); setMobileDrawer('none') }}><Clock3 size={17} /><span>Ostatnie</span></button>
          </div>
          <div className="sidebar-section workspace-tools">
            <div className="section-heading"><span className="section-label">NARZĘDZIA</span></div>
            <button className={`nav-item ${showingFlashcardsPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(FLASHCARDS_PAGE_ID); setActiveFilter('all'); setMobileDrawer('none') }}><Brain size={16} /><span>Fiszki</span><span className="nav-count">{dueFlashcardCount}</span></button>
            <button className={`nav-item ${showingTaskManagerPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(TASKS_PAGE_ID); setMobileDrawer('none') }}><CheckSquare2 size={16} /><span>Zadania</span><span className="nav-count">{incompleteTaskCount}</span></button>
            <button className="nav-item" onClick={() => setShowDailyNotes(true)}><CalendarDays size={16} /><span>Notatki dzienne</span></button>
            <button className={`nav-item ${showingReviewSessionsOverview || activeReviewSession ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(REVIEW_SESSIONS_OVERVIEW_ID); setMobileDrawer('none') }}><Repeat2 size={16} /><span>Powtórki</span><span className="nav-count">{reviewSessions.length}</span></button>
            <button className={`nav-item ${showingSavedSearchesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(SAVED_SEARCHES_PAGE_ID); setMobileDrawer('none') }}><BookmarkPlus size={16} /><span>Zapisane widoki</span><span className="nav-count">{savedSearches.length}</span></button>
            <button className={`nav-item ${showingNoteTemplatesPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(NOTE_TEMPLATES_PAGE_ID); setMobileDrawer('none') }}><FilePlus2 size={16} /><span>Szablony</span><span className="nav-count">{templates.length}</span></button>
            {featureFlags.attachmentManager && <button className={`nav-item ${showingAttachmentManagerPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(ATTACHMENTS_PAGE_ID); setMobileDrawer('none') }}><Paperclip size={16} /><span>Załączniki</span><span className="nav-count">{visibleAttachmentCount}</span></button>}
            {featureFlags.noteBoard && <button className={`nav-item ${showingNoteBoardPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(NOTE_BOARD_PAGE_ID); setMobileDrawer('none') }}><Columns3 size={16} /><span>Statusy notatek</span></button>}
            {featureFlags.projectDashboard && <button className={`nav-item ${showingProjectDashboardPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(PROJECTS_PAGE_ID); setMobileDrawer('none') }}><BarChart3 size={16} /><span>Pulpit projektów</span></button>}
            <button className={`nav-item ${showingCollectionsPage ? 'active' : ''}`} onClick={() => { setCollectionFocusId(''); setActiveReviewSessionId(COLLECTIONS_PAGE_ID); setMobileDrawer('none') }}><FolderHeart size={16} /><span>Kolekcje</span><span className="nav-count">{organizationSettings.collections.length}</span></button>
            <button className={`nav-item ${showingLinkAuditPage ? 'active' : ''}`} onClick={() => { setActiveReviewSessionId(LINK_AUDIT_PAGE_ID); setMobileDrawer('none') }}><Network size={16} /><span>Kontrola powiązań</span></button>
            <button className="nav-item" onClick={() => setShowWorkspaceLayouts(true)}><LayoutTemplate size={16} /><span>Obszary robocze</span><span className="nav-count">{organizationSettings.workspaces.length}</span></button>
            <button className="nav-item" onClick={() => setShowKnowledgeGraph(true)}><Network size={16} /><span>Mapa powiązań</span></button>
            {featureFlags.duplicateManager && <button className="nav-item" onClick={() => setShowDuplicateManager(true)}><Copy size={16} /><span>Duplikaty</span></button>}
            <button className="nav-item" onClick={() => setShowBackupTrash(true)}><Archive size={16} /><span>Kopie i kosz</span><span className="nav-count">{trashEntries.length}</span></button>
          </div>
          {featureFlags.smartFolders && savedSearches.length > 0 && <div className="sidebar-section smart-folders-section"><div className="section-heading"><span className="section-label">INTELIGENTNE FOLDERY</span></div>{savedSearches.map(search => <button type="button" className={`nav-item ${activeFilter === `smart:${search.id}` ? 'active' : ''}`} key={search.id} onClick={() => { setActiveReviewSessionId(''); setActiveFilter(`smart:${search.id}`); setQuery(''); setSearchTag(''); setSearchFolder(''); setMobileDrawer('none') }}><Search size={15} /><span>{search.name}</span>{activeFilter === `smart:${search.id}` && <span className="nav-count">{smartFolderResults?.length ?? 0}</span>}</button>)}</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="offline-card"><span className="online-dot" /><div><strong>Dane lokalne</strong><span>{storageLocationLabel} · offline</span></div><Check size={15} /></div>
          <div className="user-row"><div className="avatar">N</div><div><strong>Moje notatki</strong><span>Przestrzeń prywatna</span></div><div className="user-row-actions">{featureFlags.appLock && hasLockPin && <button type="button" className="sidebar-help-button" onClick={lockApp} title="Zablokuj aplikację" aria-label="Zablokuj aplikację"><LockKeyhole size={17} /></button>}<button type="button" className="sidebar-help-button" onClick={() => setShowFeatureManager(true)} title="Moduły aplikacji" aria-label="Otwórz moduły aplikacji"><Puzzle size={17} /></button><button type="button" className="sidebar-help-button" onClick={() => setShowHelp(true)} title="Instrukcja obsługi" aria-label="Otwórz instrukcję obsługi"><CircleHelp size={19} /></button></div></div>
        </div>
      </aside>}

      {(showFoldersPanel || mobileDrawer === 'folders') && <aside className={`folder-panel ${mobileDrawer === 'folders' ? 'mobile-visible' : ''}`} onClickCapture={event => {
        const target = event.target
        if (target instanceof Element && target.closest('.nav-item, .folder-file-item')) setShowCreateNotePage(false)
      }}>
        <header className="folder-panel-heading">
          <div><p className="eyebrow">ORGANIZACJA NOTATEK</p><h2>Foldery i pliki</h2></div>
          <div className="folder-panel-heading-actions"><button className="tiny-icon" title="Dodaj folder" aria-label="Dodaj folder" onClick={() => { setFolderDraft(''); setShowFolderDialog(true) }}><Plus size={15} /></button><button className="mobile-close icon-button" onClick={() => setMobileDrawer('none')} aria-label="Zamknij foldery i pliki"><X size={18} /></button></div>
        </header>
        <div className="folders-section">
          <VirtualizedList
            className="folder-entries"
            dataDropFolder=""
            items={folderPanelEntries}
            itemHeight={29}
            keyOf={entry => entry.kind === 'note' ? `note:${entry.note.id}` : entry.kind === 'folder' ? `folder:${entry.path}` : `more:${entry.folder}`}
            renderItem={entry => {
              if (entry.kind === 'note') return renderNoteFile(entry.note, entry.depth)
              if (entry.kind === 'more') {
                const limit = folderNoteLimits[entry.folder] ?? 60
                return <button type="button" className="folder-more-notes" style={{ paddingLeft: `${18 + entry.depth * 10}px` }} onClick={() => setFolderNoteLimits(current => ({ ...current, [entry.folder]: limit + 60 }))}>Pokaż kolejne notatki · pozostało {entry.remaining}</button>
              }
              const folder = entry.path
              const label = folder.split('/').at(-1) ?? folder
              const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
              const siblings = foldersByParent.get(parent) ?? []
              const count = folderNoteCounts.get(folder) ?? 0
              const target: EntryTarget = { kind: 'folder', path: folder }
              const color = folderDisplayColor(folder)
              const collapsed = collapsedFolders.has(folder)
              return <div className="folder-tree-node" data-drop-folder={folder}>
                <div className={`folder-drop-row ${activeFilter === folder ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={{ paddingLeft: `${6 + entry.depth * 10}px`, ...(entryColorStyle(color) ?? {}) }} data-drop-folder={folder}>
                  <button type="button" className="folder-collapse-button" onClick={event => { event.stopPropagation(); toggleFolderExpansion(folder) }} aria-label={collapsed ? `Rozwiń zawartość folderu ${folder}` : `Zwiń zawartość folderu ${folder}`} aria-expanded={!collapsed} title={collapsed ? 'Rozwiń folder' : 'Zwiń folder'}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                  <button className={`nav-item folder-item ${activeFilter === folder && !showingWorkspacePage ? 'active' : ''} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, target, label)} onClick={() => { if (ignoreClickAfterDrag()) return; setActiveReviewSessionId(''); setActiveFilter(folder); setMobileDrawer('none'); toggleFolderExpansion(folder) }} aria-expanded={!collapsed} title={`Kliknij, aby ${collapsed ? 'rozwinąć' : 'zwinąć'} folder „${label}”. Przeciągnij, aby go przenieść.`}><Folder size={16} /><span>{label}</span><span className="nav-count">{count}</span></button>
                  {renderEntryMenu(target, siblings)}
                </div>
              </div>
            }}
            footer={!folders.length && !rootNotes.length && <p className="empty-hint">Utwórz folder lub przeciągnij tu notatkę.</p>}
          />
        </div>
      </aside>}

      {showLibrary && <section className={`notes-panel ${mobileDrawer === 'notes' ? 'mobile-visible' : ''}`}>
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
        {searchIndexProgress && <div className="search-index-status" role="status"><LoaderCircle size={13} />Wczytuję treść do wyszukiwania: {searchIndexProgress.done.toLocaleString('pl-PL')} / {searchIndexProgress.total.toLocaleString('pl-PL')}</div>}
        {featureFlags.bulkActions && <div className="bulk-note-toolbar"><button type="button" className={`button ${bulkSelectMode ? 'primary' : 'secondary'}`} onClick={() => { setBulkSelectMode(value => !value); setBulkSelectedIds([]) }}>{bulkSelectMode ? 'Zakończ zaznaczanie' : 'Zaznacz notatki'}</button>{bulkSelectMode && <><span>{bulkSelectedIds.length} zaznaczono</span><button type="button" className="link-button" onClick={() => setBulkSelectedIds(visibleNotes.map(note => note.id))}>Zaznacz widoczne</button><select aria-label="Przenieś zaznaczone notatki do folderu" value={bulkTargetFolder} onChange={event => setBulkTargetFolder(event.target.value)}><option value="">Poziom główny</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><button type="button" className="button secondary" disabled={!bulkSelectedIds.length} onClick={moveSelectedNotesBulk}>Przenieś</button><input aria-label="Tag dla zaznaczonych notatek" value={bulkTagDraft} onChange={event => setBulkTagDraft(event.target.value)} placeholder="Dodaj/usuń tag" /><button type="button" className="button secondary" disabled={!bulkTagDraft.trim() || !bulkSelectedIds.length} onClick={applyBulkTag}>Zastosuj tag</button><button type="button" className="button danger-button" disabled={!bulkSelectedIds.length} onClick={() => void deleteSelectedNotesBulk()}><Trash2 size={13} />Do kosza</button></>}</div>}
        <div className="list-toolbar"><span>{visibleNotes.length} NOTATKI</span><label className="list-view-select"><span>Widok</span><select value={noteDisplayMode} onChange={event => setDisplayMode(event.target.value as NoteDisplayMode)} aria-label="Sposób wyświetlania notatek"><option value="full">Treść i tagi</option><option value="names-tags">Nazwy i tagi</option><option value="names">Same nazwy</option></select></label></div>
        {!visibleNotes.length ? <div className="note-list"><div className="empty-state compact"><div className="empty-illustration"><Search size={22} /></div><strong>Brak pasujących notatek</strong><span>Spróbuj zmienić wyszukiwanie albo utwórz nową notatkę.</span><button className="button secondary" onClick={openCreateNote}><Plus size={15} />Nowa notatka</button></div></div> : <VirtualizedList
          className="note-list"
          items={noteListItems}
          itemHeight={noteDisplayMode === 'full' ? 120 : noteDisplayMode === 'names-tags' ? 78 : 48}
          keyOf={note => note.id}
          onItemsRendered={(start, end) => {
            const rows = noteListItems.slice(start, end).filter(note => note.contentLoaded === false && !noteBodiesRef.current.has(note.id))
            void Promise.all(rows.map(note => ensureNoteBody(note.id))).catch(reportDiskSaveError)
          }}
          renderItem={note => {
            const body = noteBodies.get(note.id)
            const excerptNote = body === undefined ? undefined : { ...note, content: body, contentLoaded: true }
            const color = noteDisplayColor(note)
            return <div className="note-card-select-row">{bulkSelectMode && <input type="checkbox" className="note-bulk-checkbox" aria-label={`Zaznacz notatkę ${note.title || 'Bez tytułu'}`} checked={bulkSelectedIdSet.has(note.id)} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={event => setBulkSelectedIds(current => event.target.checked ? [...new Set([...current, note.id])] : current.filter(id => id !== note.id))} />}<button className={`note-card view-${noteDisplayMode} ${selectedId === note.id ? 'selected' : ''} ${color ? 'has-entry-color' : ''}`} style={entryColorStyle(color)} onPointerDown={event => startEntryPointerDrag(event, { kind: 'note', id: note.id }, note.title || 'Bez tytułu')} onClick={() => { if (ignoreClickAfterDrag() || bulkSelectMode) return; setActiveReviewSessionId(''); selectNote(note.id); setMobileDrawer('none') }}>
              {noteDisplayMode === 'full' && <div className="note-card-top"><span className="note-date">{dateLabel(note.updatedAt)}</span>{note.favorite && <Star size={14} className="favorite-mini" fill="currentColor" />}</div>}
              <strong>{note.title || 'Bez tytułu'}</strong>
              {noteDisplayMode === 'full' && <p>{excerptNote ? cachedNoteExcerpt(excerptNote) || 'Pusta notatka' : 'Wczytuję podgląd…'}</p>}
              {noteDisplayMode !== 'names' && <div className="note-card-bottom">{noteDisplayMode === 'full' && note.folder && <span className="folder-pill"><Folder size={12} />{note.folder}</span>}{note.tags.map(cleanLibraryTag).filter(tag => tag && !/^[-:|\s]+$/.test(tag)).map((tag, index) => <span key={`${index}:${tag}`} className="tag-pill">{tag}</span>)}</div>}
            </button></div>
          }}
          footer={noteListLimit < visibleNotes.length && <button type="button" className="note-list-load-more" onClick={() => setNoteListLimit(limit => Math.min(visibleNotes.length, limit + 100))}>Pokaż kolejne {Math.min(100, visibleNotes.length - noteListLimit)} · pozostało {visibleNotes.length - noteListLimit}</button>}
        />}
        <div className="notes-list-footer"><span><span className="online-dot" />{usesNativeFiles ? ' Pliki na tym urządzeniu' : ' Zapis na tym urządzeniu'}</span></div>
      </section>}

      <section className="editor-panel">
        <header className="topbar">
          <div className="topbar-start">
            <div className="mobile-actions"><button className="icon-button" onClick={() => setMobileDrawer('sidebar')} aria-label="Otwórz narzędzia"><Menu size={19} /></button><button className="icon-button" onClick={() => { if (!showFoldersPanel) { localStorage.setItem('no-tie-folders-panel-visible', 'true'); setShowFoldersPanel(true) } setMobileDrawer('folders') }} aria-label="Otwórz foldery i pliki"><Folder size={18} /></button><button className="icon-button" onClick={() => { if (!showLibrary) { localStorage.setItem('no-tie-library-visible', 'true'); setShowLibrary(true) } setMobileDrawer('notes') }} aria-label={showLibrary ? 'Pokaż notatki' : 'Pokaż bibliotekę'}><PanelLeft size={18} /></button></div>
            <div className="navigation-history-controls" aria-label="Historia widoków"><button type="button" className="icon-button" title="Poprzedni widok" aria-label="Poprzedni widok" disabled={navigationPosition <= 0} onClick={() => moveNavigationHistory(-1)}><ArrowLeft size={16} /></button><button type="button" className="icon-button" title="Następny widok" aria-label="Następny widok" disabled={navigationPosition < 0 || navigationPosition >= navigationStack.current.length - 1} onClick={() => moveNavigationHistory(1)}><ArrowRight size={16} /></button></div>
            <details className="topbar-dropdown topbar-dropdown-left" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open') }}>
              <summary className="topbar-dropdown-trigger" aria-label="Menu paneli i biblioteki"><MoreVertical size={16} /><span className="topbar-dropdown-label">Panele</span><ChevronDown size={13} /></summary>
              <div className="topbar-dropdown-menu" role="group" aria-label="Panele i biblioteka">
                <button type="button" onClick={event => { toggleSidebarPanel(); event.currentTarget.closest('details')?.removeAttribute('open') }}><PanelLeft size={15} /><span>{sidebarPanelIsVisible() ? 'Ukryj narzędzia' : 'Pokaż narzędzia'}</span>{sidebarPanelIsVisible() && <Check size={14} className="topbar-menu-check" />}</button>
                <button type="button" onClick={event => { toggleFoldersPanelDrawer(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Folder size={15} /><span>{foldersPanelIsVisible() ? 'Ukryj Foldery i pliki' : 'Pokaż Foldery i pliki'}</span>{foldersPanelIsVisible() && <Check size={14} className="topbar-menu-check" />}</button>
                <button type="button" onClick={event => { toggleLibraryPanel(); event.currentTarget.closest('details')?.removeAttribute('open') }}><BookOpen size={15} /><span>{libraryPanelIsVisible() ? 'Ukryj Twoją bibliotekę' : 'Pokaż Twoją bibliotekę'}</span>{libraryPanelIsVisible() && <Check size={14} className="topbar-menu-check" />}</button>
              </div>
            </details>
          </div>
          <nav className="breadcrumb" aria-label="Ścieżka nawigacji">
            {showCreateNotePage ? <><button type="button" className="breadcrumb-link" onClick={() => openAllNotesFolder('')}>Notatki</button><span className="crumb-slash">/</span><span className="breadcrumb-current">Nowa notatka</span></> : showingToolsBreadcrumb ? <><span className="breadcrumb-section">Narzędzia</span><span className="crumb-slash">/</span><span className="breadcrumb-current">{toolsBreadcrumbTitle}</span></> : activeSmartFolder ? <><button type="button" className="breadcrumb-link" onClick={() => openAllNotesFolder('')}>Notatki</button><span className="crumb-slash">/</span><span className="breadcrumb-current">{activeSmartFolder.name}</span></> : <>
              <button type="button" className="breadcrumb-link" onClick={() => openAllNotesFolder('')}>Notatki</button>
              {showingAllNotesPage && !allNotesFolderPreset && <span className="breadcrumb-pair"><span className="crumb-slash">/</span><button type="button" className="breadcrumb-link breadcrumb-current" aria-current="page" onClick={() => openAllNotesFolder('')}>Wszystkie notatki</button></span>}
              {breadcrumbFolders.map(folder => <span className="breadcrumb-pair" key={folder.path}><span className="crumb-slash">/</span><button type="button" className={`breadcrumb-link ${folder.path === breadcrumbFolderPath ? 'breadcrumb-current' : ''}`} aria-current={folder.path === breadcrumbFolderPath ? 'page' : undefined} onClick={() => openAllNotesFolder(folder.path)}>{folder.label}</button></span>)}
            </>}
          </nav>
          <div className="topbar-actions">
            <span className={`save-indicator ${saved ? 'is-saved' : ''}`}><span className="save-dot" />{saved ? 'Zapisano' : 'Zapisywanie…'}</span>
            <button type="button" className="icon-button command-palette-trigger" title="Paleta poleceń (Ctrl+Shift+P)" aria-label="Otwórz paletę poleceń" onClick={() => setShowCommandPalette(true)}><Command size={16} /></button>
            {!showingWorkspacePage && notes.length > 0 && <button type="button" className={`split-view-toggle ${noteGridEnabled ? 'active' : ''}`} onClick={toggleNoteGrid} aria-pressed={noteGridEnabled} title={noteGridEnabled ? 'Wróć do pojedynczej notatki' : 'Otwórz siatkę notatek'}><Columns3 size={15} /><span>{noteGridEnabled ? 'Pojedynczy widok' : 'Siatka notatek'}</span></button>}
            {!showingWorkspacePage && selectedNote && featureFlags.noteReminders && <button type="button" className="icon-button note-history-button" onClick={() => setShowNoteReminder(true)} title="Ustaw przypomnienie o notatce" aria-label="Ustaw przypomnienie o notatce"><Bell size={16} /></button>}
            {!showingWorkspacePage && selectedNote && <button className="icon-button note-history-button" onClick={() => void openNoteHistory()} title="Historia wersji notatki" aria-label="Historia wersji notatki"><History size={17} /></button>}
            <details className="topbar-dropdown topbar-dropdown-right" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open') }}>
              <summary className={`topbar-dropdown-trigger ollama-menu-trigger ${showChat ? 'active' : ''}`} aria-label="Menu Ollama" title="Ollama"><MessageCircle size={16} /><span className="topbar-dropdown-label">Ollama</span><ChevronDown size={13} /></summary>
              <div className="topbar-dropdown-menu" role="group" aria-label="Ollama, import i eksport">
                <button type="button" onClick={event => { toggleChat(); event.currentTarget.closest('details')?.removeAttribute('open') }}><MessageCircle size={15} /><span>{showChat ? 'Ukryj czat Ollama' : 'Pokaż czat Ollama'}</span>{showChat && <Check size={14} className="topbar-menu-check" />}</button>
                <button type="button" onClick={event => { openOllamaSettings(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Settings2 size={15} /><span>Ustawienia modelu</span></button>
                <button type="button" onClick={event => { setShowAiWorkspace(true); event.currentTarget.closest('details')?.removeAttribute('open') }}><Sparkles size={15} /><span>Profile i ustawienia AI</span></button>
                <button type="button" onClick={event => { setShowAiTaskQueue(true); event.currentTarget.closest('details')?.removeAttribute('open') }}><Clock3 size={15} /><span>Kolejka zadań AI</span>{aiTaskQueue.some(task => task.status === 'running' || task.status === 'queued') && <span className="topbar-menu-count">{aiTaskQueue.filter(task => task.status === 'running' || task.status === 'queued').length}</span>}</button>
                <div className="topbar-menu-separator" role="separator" />
                <button type="button" disabled={archiveTask?.state === 'running'} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void exportNotesArchive() }}><Archive size={15} /><span>Eksportuj paczkę</span></button>
                <button type="button" disabled={archiveTask?.state === 'running'} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); importInput.current?.click() }}><Import size={15} /><span>Importuj paczkę</span></button>
                <div className="topbar-menu-separator" role="separator" />
                <button type="button" disabled={!notes.length || archiveTask?.state === 'running'} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void exportObsidianVault() }}><Archive size={15} /><span>Eksportuj vault Obsidiana</span></button>
                <button type="button" disabled={archiveTask?.state === 'running'} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); importInput.current?.click() }}><Import size={15} /><span>Importuj z Obsidiana (ZIP lub MD)</span></button>
              </div>
            </details>
            <input ref={importInput} type="file" accept=".zip,.md,.markdown,application/zip,text/markdown" hidden onChange={handleImport} />
          </div>
        </header>

        <Suspense fallback={<div className="editor-loading">Otwieram widok…</div>}>
        {!showingWorkspacePage && noteGridEnabled ? (
          <NoteGridView
            notes={noteGridIds.map(id => notesWithAvailableContent.find(note => note.id === id)).filter((note): note is Note => Boolean(note))}
            allNotes={notesWithAvailableContent}
            assets={assets}
            attachments={attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })}
            activeNoteId={selectedId}
            revision={editorRevision}
            getNoteActions={markdownActionsFor}
            onFocus={focusGridNote}
            onRemove={removeNoteFromGrid}
            onAdd={addNoteToGrid}
            onPatch={(noteId, patch) => patchNote(noteId, patch)}
            onSelectionChange={(noteId, mode, text) => setEditorSelection({ noteId, mode, text })}
            onNoteAction={handleMarkdownNoteAction}
            onOpenNote={(target, sourceNoteId) => { focusGridNote(sourceNoteId); openLinkedNote(target) }}
            onOpenAttachment={(fileName, sourceNoteId, page, fragment) => { focusGridNote(sourceNoteId); openAttachment(fileName, sourceNoteId, page, fragment) }}
          />
        ) : showingSavedSearchesPage ? (
          <SavedSearchDialog
            searches={savedSearches}
            current={{ query, tag: searchTag, folder: searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : '') }}
            onSave={name => { const folder = searchFolder || (activeFilter !== 'all' && activeFilter !== 'favorites' && activeFilter !== 'root' ? activeFilter : ''); setSavedSearches(current => [{ id: crypto.randomUUID(), name, query, tag: searchTag, folder }, ...current]) }}
            onApply={applySavedSearch}
            onDelete={id => setSavedSearches(current => current.filter(search => search.id !== id))}
            onClose={() => setActiveReviewSessionId('')}
          />
        ) : showingNoteTemplatesPage ? (
          <TemplateManagerDialog templates={templates} notes={notes} assets={assets} onSave={setTemplates} onClose={() => setActiveReviewSessionId('')} />
        ) : showingLinkAuditPage ? (
          <NoteLinkAuditPage notes={notesWithAvailableContent} onOpen={openLinkedNote} />
        ) : showingCollectionsPage ? (
          <CollectionsPage collections={organizationSettings.collections} notes={notesWithAvailableContent} initialCollectionId={collectionFocusId} onChange={collections => setOrganizationSettings(current => ({ ...current, collections }))} onOpen={openLinkedNote} />
        ) : showingTaskManagerPage ? (
          <TaskManagerPage notes={notesWithAvailableContent} tasks={parsedTasks} attachments={attachments} onUpdate={updateTask} onOpenNote={openLinkedNote} onOpenAttachment={openAttachmentPreview} onCreate={createTask} onCreateMany={createProjectTasks} onClose={() => setActiveReviewSessionId('')} />
        ) : showingProjectDashboardPage ? (
          <ProjectDashboardPage notes={notesWithAvailableContent} tasks={parsedTasks} onOpenNote={openLinkedNote} onClose={() => setActiveReviewSessionId('')} />
        ) : showingAttachmentManagerPage ? (
          <AttachmentManagerPage notes={notes} attachments={attachments.filter(attachment => featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })} indexing={attachmentIndexing} onOpenNote={openLinkedNote} onPreview={openAttachmentPreview} onDelete={attachment => void deleteAttachment(attachment)} onIndex={featureFlags.attachmentIndex ? attachment => void indexAttachment(attachment) : undefined} onClose={() => setActiveReviewSessionId('')} />
        ) : showingNoteBoardPage ? (
          <NoteBoardPage notes={notesWithAvailableContent} onSetStatus={setNoteWorkflowStatus} onOpen={openLinkedNote} onClose={() => setActiveReviewSessionId('')} />
        ) : showCreateNotePage ? (
          <CreateNotePage templates={templates} folders={folders} initialFolder={createNoteInitialFolder} folderTemplateDefaults={organizationSettings.folderTemplateDefaults} onSetFolderTemplateDefault={setFolderTemplateDefault} notes={notes} assets={assets} onCreate={(template, folder) => createNote(template, folder)} onClose={() => setShowCreateNotePage(false)} />
        ) : showingAllNotesPage ? (
          <AllNotesPage key={`${allNotesPreset}:${allNotesPresetRevision}`} preset={allNotesPreset} initialFolder={allNotesFolderPreset} onFolderChange={setAllNotesFolderPreset} noteOrder={organizationSettings.noteOrder} onReorder={reorderNotes} notes={notes} attachments={attachments} searchAttachments={searchableAttachments} contentByNote={searchContentByNote.size ? searchContentByNote : noteBodies} normalizedContentByNote={searchNormalizedContentByNote} onSearchContentChange={setAllNotesSearchNeedsContent} onVisibleNotes={visible => { void ensureNoteBodies(visible.map(note => note.id)).catch(reportDiskSaveError) }} advancedSearch={featureFlags.advancedQuery} getNoteColor={noteDisplayColor} onOpen={openLinkedNote} />
        ) : showingFlashcardsPage ? (
          <FlashcardsPage cards={flashcards} notes={notes} attachments={attachments} trash={flashcardTrash} aiTaskNotices={flashcardAiTasks} onBeginAiTask={beginFlashcardAiTask} onFinishAiTask={finishFlashcardAiTask} onCreate={createFlashcard} onUpdate={updateFlashcard} onReview={rateFlashcard} onSetDueAt={setFlashcardDueAt} onToggleSuspend={toggleFlashcardSuspended} onDelete={trashFlashcard} onRestoreTrash={restoreFlashcardTrash} onPurgeTrash={id => setFlashcardTrash(current => current.filter(entry => entry.id !== id))} onRegenerate={regenerateFlashcard} onFindSimilar={findSimilarFlashcards} onAiAssist={assistFlashcards} onOpenNote={noteId => { setActiveReviewSessionId(''); openLinkedNote(noteId) }} />
        ) : showingReviewSessionsOverview ? (
          <ReviewSessionsOverview
            sessions={reviewSessions}
            notes={notes}
            onOpen={sessionId => { setActiveReviewSessionId(sessionId); setMobileDrawer('none') }}
            onCreate={() => openReviewSessionEditor()}
            onEdit={openReviewSessionEditor}
          />
        ) : activeReviewSession ? (
          <ReviewSessionView
            session={activeReviewSession}
            notes={notes}
            onStart={() => startReviewTimer(activeReviewSession.id)}
            onPause={() => pauseReviewTimer(activeReviewSession.id)}
            onFinish={() => pauseReviewTimer(activeReviewSession.id, 'completed')}
            onReset={() => resetReviewTimer(activeReviewSession.id)}
            onSetActiveNote={noteId => setActiveReviewNote(activeReviewSession.id, noteId)}
            onOpenNote={openReviewNote}
            onEdit={() => openReviewSessionEditor(activeReviewSession.id)}
            onReorder={noteIds => reorderReviewSession(activeReviewSession.id, noteIds)}
          />
        ) : selectedNote && !selectedNote.contentLoaded ? (
          <div className="editor-loading note-body-loading" role="status"><LoaderCircle size={19} className={loadingSelectedNote ? 'is-spinning' : ''} />{loadingSelectedNote ? 'Wczytuję treść notatki…' : <button type="button" className="link-button" onClick={() => void ensureNoteBody(selectedNote.id).catch(reportDiskSaveError)}>Wczytaj treść ponownie</button>}</div>
        ) : selectedNote ? (
          <article className="note-editor" key={selectedNote.id}>
            <div className="editor-scroll">
              <div className="note-meta-line"><span className="meta-dot" /><select className="folder-select" value={selectedNote.folder} onChange={event => moveNoteToFolder(selectedNote.id, event.target.value)} aria-label="Folder notatki"><option value="">Bez folderu</option>{folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select><span className="meta-divider">·</span>Utworzono {dateLabel(selectedNote.createdAt)}</div>
              <input className="note-title-input" value={selectedNote.title} onChange={event => patchNote(selectedNote.id, { title: event.target.value })} placeholder="Tytuł notatki" aria-label="Tytuł notatki" />
              <div className="tags-row"><Tag size={15} /><div className="tag-list">{selectedNote.tags.map(tag => <button className="editable-tag" key={tag} onClick={() => patchNote(selectedNote.id, { tags: selectedNote.tags.filter(item => item !== tag) })} title="Usuń tag">{tag}<X size={11} /></button>)}<input className="tag-input" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} placeholder={selectedNote.tags.length ? 'Dodaj tag…' : 'Dodaj tag'} aria-label="Dodaj tag" />{tagInput && <button className="tag-add-button" onClick={addTag}>Dodaj</button>}</div></div>
              <NotePropertiesEditor key={`${selectedNote.id}:${(selectedNote.aliases ?? []).join('|')}`} note={selectedNote} onChange={patch => patchNote(selectedNote.id, patch)} />
              <div className="editor-tools-row">
                <div className="editor-tools-left"><div className="view-mode-toggle" role="group" aria-label="Widok notatki"><button className={`view-mode-button ${editorMode === 'rendered' ? 'active' : ''}`} title="Widok wizualny" aria-label="Widok wizualny" aria-pressed={editorMode === 'rendered'} onClick={() => setEditorMode('rendered')}><Eye size={16} /></button><button className={`view-mode-button ${editorMode === 'source' ? 'active' : ''}`} title="Surowy Markdown" aria-label="Surowy Markdown" aria-pressed={editorMode === 'source'} onClick={() => setEditorMode('source')}><Code2 size={16} /></button></div></div>
                <div className="template-toolbar"><button type="button" className="icon-button template-manage-button" title="Eksportuj jako HTML" aria-label="Eksportuj jako HTML" onClick={() => exportCurrentAsHtml()}><FileText size={14} /></button><button type="button" className="icon-button template-manage-button" title="Drukuj / zapisz jako PDF" aria-label="Drukuj lub zapisz jako PDF" onClick={exportCurrentAsPdf}><Archive size={14} /></button></div>
              </div>
              {editorMode === 'source' ? <MarkdownSourceEditor noteId={selectedNote.id} markdown={selectedNote.content} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'source', text })} noteActions={markdownNoteActions} onNoteAction={handleMarkdownNoteAction} /> : <Suspense fallback={<div className="editor-loading">Otwieram edytor…</div>}><MarkdownEditor key={`${selectedNote.id}-${editorRevision}`} noteId={selectedNote.id} markdown={selectedNote.content} assets={currentAssets} attachments={currentAttachments} revision={editorRevision} onChange={content => patchNote(selectedNote.id, { content })} onSelectionChange={text => setEditorSelection({ noteId: selectedNote.id, mode: 'rendered', text })} onOpenNote={openLinkedNote} onOpenAttachment={(fileName, page, fragment) => openAttachment(fileName, selectedNote.id, page, fragment)} notes={notesWithAvailableContent} allAssets={assets} noteActions={markdownNoteActions} onNoteAction={handleMarkdownNoteAction} /></Suspense>}
      <NoteConnections note={selectedNote} notes={notesWithAvailableContent} onOpen={note => openLinkedNote(note.id)} onShowGraph={() => setShowKnowledgeGraph(true)} onExpandedChange={setNoteConnectionsOpen} />
              <NoteAttachmentsPanel attachments={currentAttachmentsForUi} assets={currentAssets} audioEnabled={featureFlags.audioNotes} onAdd={addAttachments} onAddAsset={() => { setEditingAsset(undefined); setShowDrawing(true) }} onEditAsset={asset => { setEditingAsset(asset); setShowDrawing(true) }} onRemove={attachment => void deleteAttachment(attachment)} onOcr={recognizeAttachmentText} onSaveExtractedText={saveAttachmentExtractedText} onTranscribe={featureFlags.audioNotes ? transcribeAudioAttachment : undefined} onInsertText={insertTextIntoNote} onSaveTranscript={saveAttachmentTranscript} onInsertAttachmentLink={insertAttachmentLink} onPreview={openAttachmentPreview} />
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
        </Suspense>
      </section>
      {showChat && <Suspense fallback={<div className="chat-loading">Otwieram czat…</div>}><ChatPanel open baseUrl={ollamaBaseUrl} model={ollamaModel} note={selectedNote && aiCanAccessNote(selectedNote) ? selectedNote : undefined} notes={aiAccessibleNotes} assets={assets.filter(asset => aiAccessibleNoteIds.has(asset.noteId))} attachments={attachments.filter(attachment => aiAccessibleNoteIds.has(attachment.noteId) && (featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/'))).map(attachment => featureFlags.attachmentIndex ? attachment : { ...attachment, extractedText: undefined })} preferences={aiPreferences} contextPickerEnabled={featureFlags.aiContextPicker} citationsEnabled={featureFlags.aiCitations} onOpenCitation={openCitation} onRunTask={runAiTask} onDiagnostic={saveAiDiagnostic} onRateOutput={rateAiOutput} onClose={closeChat} onOpenSettings={openOllamaSettings} /></Suspense>}
      <Suspense fallback={null}>
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showCommandPalette && <CommandPaletteDialog commands={paletteCommands} onClose={() => setShowCommandPalette(false)} />}
      {showWorkspaceLayouts && <WorkspaceLayoutsDialog layouts={organizationSettings.workspaces} onSave={saveWorkspaceLayout} onApply={applyWorkspaceLayout} onDelete={id => setOrganizationSettings(current => ({ ...current, workspaces: current.workspaces.filter(layout => layout.id !== id) }))} onClose={() => setShowWorkspaceLayouts(false)} />}
      {attachments.find(attachment => attachment.id === previewAttachmentId && (!attachment.mimeType.startsWith('audio/') || featureFlags.audioNotes)) && <AttachmentPreviewDialog attachment={attachments.find(attachment => attachment.id === previewAttachmentId)!} annotationsEnabled={featureFlags.pdfAnnotations} transcriptTimestampsEnabled={featureFlags.transcriptTimestamps} initialPage={previewAttachmentPage} initialQuote={previewAttachmentFragment} onSaveAnnotations={savePdfAnnotations} onSaveMetadata={saveAttachmentMetadataFields} onInsertDocumentLink={insertDocumentReference} onGenerateFlashcardsFromPage={featureFlags.aiFlashcards ? (attachment, page) => { const sourceNote = notes.find(note => note.id === attachment.noteId); if (!sourceNote || !aiCanAccessNote(sourceNote)) { setToast('Ograniczenia dostępu nie pozwalają AI czytać tego folderu.'); window.setTimeout(() => setToast(''), 3000); return } setFlashcardGenerationScope({ kind: 'pdf-page', noteId: attachment.noteId, attachmentId: attachment.id, page, label: `Strona ${page} · ${attachment.fileName}` }); setAiNoteTool('flashcards'); setPreviewAttachmentId('') } : undefined} onClose={() => setPreviewAttachmentId('')} />}
      {entryDragVisual && <div className="entry-drag-ghost" style={{ left: entryDragVisual.x, top: entryDragVisual.y }} aria-hidden="true"><div>{entryDragVisual.target.kind === 'folder' ? <Folder size={15} /> : <FileText size={15} />}<strong>{entryDragVisual.label}</strong></div><span>{entryDragVisual.gridSlotId ? 'Otwórz tu zamiast obecnej notatki' : entryDragVisual.dropFolder === null && entryDragVisual.canDropToGrid ? 'Upuść w polu siatki lub folderze' : entryDragVisual.dropFolder === null ? 'Upuść na folder' : entryDragVisual.dropFolder ? `Przenieś do: ${entryDragVisual.dropFolder}` : 'Przenieś do: Bez folderu'}</span></div>}
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
      {showDailyNotes && <DailyNotesDialog notes={notesWithAvailableContent} onSelect={openDailyNote} onClose={() => setShowDailyNotes(false)} />}
      {showBackupTrash && <BackupTrashDialog backups={autoBackups} trash={trashEntries} busy={backupBusy || backupsLoading || !libraryPayloadsReady} onCreateBackup={() => void createAutomaticBackup(false)} onDownloadBackup={fileName => void downloadAutomaticBackup(fileName)} onRestoreBackup={fileName => void restoreAutomaticBackup(fileName)} onDeleteBackup={fileName => void removeAutomaticBackup(fileName)} onRestoreTrash={entryId => void restoreTrashEntry(entryId)} onDeleteTrash={entryId => void deleteTrashEntry(entryId)} onEmptyTrash={() => void emptyTrash()} onClose={() => setShowBackupTrash(false)} />}
      {showKnowledgeGraph && <KnowledgeGraphDialog notes={notesWithAvailableContent} onOpen={note => { setShowKnowledgeGraph(false); openLinkedNote(note.id) }} onClose={() => setShowKnowledgeGraph(false)} />}
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
      {showNoteLinkDialog && notes.find(note => note.id === noteActionTargetId) && <NoteLinkDialog
        notes={notes}
        currentNoteId={noteActionTargetId}
        onSelect={note => {
          dispatchWikiLinkInsert({ noteId: noteActionTargetId, target: note.title || note.id })
          setShowNoteLinkDialog(false)
        }}
        onClose={() => setShowNoteLinkDialog(false)}
      />}
      {showNoteEmbedDialog && notes.find(note => note.id === noteActionTargetId) && <NoteLinkDialog notes={notes} currentNoteId={noteActionTargetId} purpose="embed" onSelect={note => { dispatchWikiEmbedInsert({ noteId: noteActionTargetId, target: note.title || note.id }); setShowNoteEmbedDialog(false) }} onClose={() => setShowNoteEmbedDialog(false)} />}
      {showAiEdit && aiEditTarget && <AiSelectionEditDialog selectedText={aiEditTarget.text} model={ollamaModel} baseUrl={ollamaBaseUrl} preferences={aiPreferences} onRunTask={runAiTask} onDiagnostic={saveAiDiagnostic} onRateOutput={(rating, comment) => rateAiOutput('selection-edit', rating, comment)} onApply={replacement => dispatchAiReplaceSelection({ noteId: aiEditTarget.noteId, replacement })} onClose={() => { setShowAiEdit(false); setAiEditTarget(null) }} />}
      {aiNoteTool && aiDialogNote && aiDialogNote.contentLoaded !== false && <AiNoteToolsDialog kind={aiNoteTool} note={aiDialogNote} canUseAi={aiCanAccessNote(aiDialogNote)} attachments={attachments.filter(attachment => attachment.noteId === aiDialogNote.id && (featureFlags.audioNotes || !attachment.mimeType.startsWith('audio/')))} existingQuestions={flashcards.filter(card => card.noteId === aiDialogNote.id).map(card => card.question)} sourceText={flashcardGenerationScope?.kind === 'selection' ? flashcardGenerationScope.text : undefined} sourcePage={flashcardGenerationScope?.kind === 'pdf-page' ? { attachmentId: flashcardGenerationScope.attachmentId, page: flashcardGenerationScope.page } : undefined} sourceLabel={flashcardGenerationScope?.label} baseUrl={ollamaBaseUrl} model={ollamaModel} preferences={aiPreferences} onRunTask={runAiTask} onDiagnostic={saveAiDiagnostic} onRateOutput={rateAiOutput} onOpenSource={(attachment, page) => { openLinkedNote(attachment.noteId); openAttachment(attachment.fileName, attachment.noteId, page) }} onApply={value => appendAiTextToNote(value, aiNoteTool, aiDialogNote.id)} onApplyMetadata={applyAiMetadata} onCreateFlashcard={(noteId, question, answer, metadata) => createFlashcard(noteId, question, answer, 'basic', [], undefined, metadata)} onTranscribeAudio={featureFlags.audioNotes ? transcribeAudioAttachment : undefined} onMinimizedChange={setAiNoteGeneratorMinimized} onClose={() => { setAiNoteTool(null); setAiNoteGeneratorMinimized(false); setFlashcardGenerationScope(null); setNoteActionTargetId('') }} />}
      {showAiWorkspace && <AiWorkspaceDialog preferences={aiPreferences} folders={folders} availableModels={ollamaModels.map(item => item.name)} onChange={updateAiPreferences} onClose={() => setShowAiWorkspace(false)} />}
      {showAiTaskQueue && <AiTaskQueueDialog tasks={aiTaskQueue} onMove={moveAiTask} onCancel={cancelAiTask} onClose={() => setShowAiTaskQueue(false)} />}
      {selectedTextFlashcard && notes.find(note => note.id === selectedTextFlashcard.noteId) && <SelectedTextFlashcardDialog noteTitle={notes.find(note => note.id === selectedTextFlashcard.noteId)?.title ?? ''} selectedText={selectedTextFlashcard.text} onSave={(question, answer) => { createFlashcard(selectedTextFlashcard.noteId, question, answer); setSelectedTextFlashcard(null) }} onClose={() => setSelectedTextFlashcard(null)} />}
      {recoveryDraft && <div className="modal-backdrop recovery-backdrop" role="presentation"><section className="folder-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-dialog-title"><div className="folder-dialog-mark"><History size={19} /></div><h2 id="recovery-dialog-title">Odzyskać niezapisane zmiany?</h2><p>W notatce <strong>„{recoveryDraft.note.title || 'Bez tytułu'}”</strong> znaleziono nowszą wersję roboczą z {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(recoveryDraft.capturedAt)}.</p><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={discardRecoveryDraft}>Odrzuć wersję roboczą</button><button type="button" className="button primary" onClick={() => void restoreRecoveryDraft()}>Odzyskaj zmiany</button></div></section></div>}
      {showNoteHistory && selectedNote && historyDialogNoteId === selectedNote.id && <NoteHistoryDialog note={selectedNote} attachments={currentAttachments} versions={noteVersions} loading={noteVersionsLoading} onRestore={restoreNoteVersion} onClose={closeNoteHistory} />}
      {showFeatureManager && <FeatureManagerDialog features={featureFlags} onToggle={toggleFeature} onConfigureLock={() => setShowLockSetup(true)} onClose={() => setShowFeatureManager(false)} />}
      {showLockSetup && featureFlags.appLock && <AppLockDialog mode="setup" onSetPin={configureAppLockPin} onUnlock={async () => false} onClose={() => setShowLockSetup(false)} />}
      {appLocked && featureFlags.appLock && hasLockPin && <AppLockDialog mode="unlock" onSetPin={async () => {}} onUnlock={unlockApp} />}
      {showNoteReminder && selectedNote && featureFlags.noteReminders && <NoteReminderDialog note={selectedNote} onSave={value => setNoteReminder(selectedNote.id, value)} onClose={() => setShowNoteReminder(false)} />}
      {showDuplicateManager && featureFlags.duplicateManager && <DuplicateManagerDialog notes={notesWithAvailableContent} onOpen={id => { setShowDuplicateManager(false); openLinkedNote(id) }} onMerge={(targetId, sourceId) => void mergeDuplicateNotes(targetId, sourceId)} onClose={() => setShowDuplicateManager(false)} />}
      </Suspense>
      {!!flashcardAiTasks.length && <div className="flashcard-ai-task-notification-stack" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${aiNoteGeneratorMinimized ? 154 : 122}px)`, maxHeight: `calc(100dvh - env(safe-area-inset-top, 0px) - ${aiNoteGeneratorMinimized ? 170 : 138}px)` }}>
        {flashcardAiTasks.map(task => {
          const stateLabel = task.state === 'running' ? 'AI pracuje' : task.state === 'error' ? 'AI zakończyło się błędem' : 'AI zakończyło zadanie'
          const durationLabel = task.state === 'running' ? 'Trwa: ' : 'Czas zadania: '
          const ratingTask: AiTaskType = 'flashcard-assist'
          return <aside key={task.id} className={`flashcard-ai-task-notification is-${task.state}`} aria-label={`Zadanie AI: ${task.label}`}>
            <div className="flashcard-ai-task-notification-status"><span className="flashcard-ai-task-notification-mark">{task.state === 'running' ? <Sparkles className="spin" size={16} /> : task.state === 'done' ? <Check size={16} /> : <X size={16} />}</span><span><strong role="status" aria-live="polite">{stateLabel}</strong><small aria-live="off">{task.label} · {durationLabel}<FlashcardAiTaskDuration startedAt={task.startedAt} finishedAt={task.finishedAt} /></small>{task.result && <small>Wynik gotowy · możesz go rozwinąć</small>}</span></div>
            <div className="flashcard-ai-task-notification-actions">{task.result && <button type="button" className="button secondary" aria-expanded={Boolean(task.resultExpanded)} aria-controls={`flashcard-ai-task-result-${task.id}`} onClick={() => toggleFlashcardAiTaskResult(task.id)}>{task.resultExpanded ? 'Zwiń' : 'Rozwiń'}</button>}<button type="button" className="icon-button" aria-label={`Usuń powiadomienie: ${task.label}`} title="Usuń powiadomienie" onClick={() => dismissFlashcardAiTask(task.id)}><X size={16} /></button></div>
            {task.result && <div id={`flashcard-ai-task-result-${task.id}`} className="flashcard-ai-task-notification-result" hidden={!task.resultExpanded}><Suspense fallback={<p>Wczytuję wynik AI…</p>}><FlashcardAiTaskResultContent value={task.result} /></Suspense>{task.state === 'done' && !flashcardAiRatedTasks[task.id] && <div className="flashcard-ai-rating"><span>Oceń odpowiedź AI</span><input value={flashcardAiRatingDrafts[task.id] ?? ''} onChange={event => setFlashcardAiRatingDrafts(current => ({ ...current, [task.id]: event.target.value }))} placeholder="Opcjonalna wskazówka" aria-label="Komentarz do oceny wyniku fiszek" /><button type="button" className="icon-button" aria-label="Dobra odpowiedź AI" onClick={() => { rateAiOutput(ratingTask, 1, flashcardAiRatingDrafts[task.id] ?? ''); setFlashcardAiRatedTasks(current => ({ ...current, [task.id]: true })) }}><ThumbsUp size={14} /></button><button type="button" className="icon-button" aria-label="Słaba odpowiedź AI" onClick={() => { rateAiOutput(ratingTask, -1, flashcardAiRatingDrafts[task.id] ?? ''); setFlashcardAiRatedTasks(current => ({ ...current, [task.id]: true })) }}><ThumbsDown size={14} /></button></div>}</div>}
          </aside>
        })}
      </div>}
      {archiveTask && <aside className={`archive-task-notification is-${archiveTask.state}`} aria-label={`${archiveTask.action === 'import' ? 'Import' : 'Eksport'}: ${archiveTask.title}`}>
        <div className="archive-task-header">
          <span className="archive-task-mark">{archiveTask.state === 'running' ? <LoaderCircle className="spin" size={16} /> : archiveTask.state === 'error' ? <X size={16} /> : <Check size={16} />}</span>
          <span className="archive-task-heading"><strong>{archiveTask.title}</strong><small role="status" aria-live="polite">{archiveTask.phase}{archiveTask.state === 'running' ? ` · ${Math.round(archiveTask.percent)}%` : ''}</small></span>
          <span className="archive-task-actions"><button type="button" className="button secondary" aria-expanded={archiveTask.expanded} aria-controls={`archive-task-details-${archiveTask.id}`} onClick={() => updateArchiveTask(archiveTask.id, { expanded: !archiveTask.expanded })}>{archiveTask.expanded ? 'Zwiń' : 'Postęp'}</button>{archiveTask.state !== 'running' && <button type="button" className="icon-button" aria-label="Zamknij powiadomienie o imporcie lub eksporcie" onClick={() => setArchiveTask(current => current?.id === archiveTask.id ? null : current)}><X size={16} /></button>}</span>
        </div>
        <div id={`archive-task-details-${archiveTask.id}`} className="archive-task-details" hidden={!archiveTask.expanded}>
          <div className="archive-task-progress-track" role="progressbar" aria-label="Postęp importu lub eksportu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(archiveTask.percent)}><span style={{ width: `${Math.max(0, Math.min(100, archiveTask.percent))}%` }} /></div>
          <div className="archive-task-progress-label"><span>{archiveTask.total > 0 ? `${archiveTask.completed} z ${archiveTask.total} ${archiveTask.counterLabel || 'elementów'}` : archiveTask.state === 'running' ? 'Przetwarzanie danych' : ''}</span><strong>{Math.round(archiveTask.percent)}%</strong></div>
          {archiveTask.current && <small className="archive-task-current" title={archiveTask.current}>{archiveTask.current}</small>}
          {archiveTask.detail && <p className="archive-task-detail">{archiveTask.detail}</p>}
        </div>
      </aside>}
      {toast && <div className="app-toast" role="status"><span className="app-toast-mark"><Check size={16} /></span><span>{toast}</span></div>}
      {mobileDrawer !== 'none' && <button className="drawer-scrim" aria-label="Zamknij menu" onClick={() => setMobileDrawer('none')} />}
    </main>
  )
}

export default App
