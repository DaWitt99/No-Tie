export type Note = {
  id: string
  title: string
  content: string
  /** False for metadata-only notes whose Markdown body has not been read yet. */
  contentLoaded?: boolean
  folder: string
  color?: string
  aliases?: string[]
  properties?: Record<string, string>
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  dailyDate?: string
}

export type NoteVersion = {
  id: string
  noteId: string
  createdAt: number
  note: Note
  attachments?: NoteAttachmentReference[]
}

export type NoteAsset = {
  id: string
  noteId: string
  fileName: string
  svg: string
}

export type NoteAttachment = {
  id: string
  noteId: string
  fileName: string
  mimeType: string
  dataUrl: string
  size: number
  contentHash?: string
  author?: string
  documentDate?: string
  description?: string
  transcript?: string
  transcriptSegments?: { startMs: number; endMs?: number; text: string; speaker?: string }[]
  extractedText?: string
  pdfAnnotations?: { id: string; page: number; text: string; quote?: string; createdAt: number }[]
}

export type NoteAttachmentReference = Pick<NoteAttachment, 'fileName' | 'mimeType' | 'size' | 'contentHash'>

export type NoteAttachmentHistory = NoteAttachment & {
  deletedAt: number
}

export type TrashEntry = {
  id: string
  batchId: string
  deletedAt: number
  note: Note
  assets: NoteAsset[]
  attachments: NoteAttachment[]
}

export type FlashcardKind = 'basic' | 'cloze' | 'image-occlusion' | 'sequence' | 'numeric' | 'audio' | 'video'
export type FlashcardTemplate = 'definition' | 'cause-effect' | 'comparison' | 'vocabulary' | 'process' | 'formula'
export const FLASHCARD_STUDY_MODES = [
  { value: 'flip', label: 'Pokaż odpowiedź' },
  { value: 'multiple-choice', label: 'Warianty odpowiedzi' },
  { value: 'true-false', label: 'Prawda / fałsz' },
  { value: 'explain', label: 'Odpowiedź opisowa' },
  { value: 'timed-exam', label: 'Odpowiedź na czas' },
] as const
export type FlashcardStudyMode = typeof FLASHCARD_STUDY_MODES[number]['value']
export function isFlashcardStudyMode(value: unknown): value is FlashcardStudyMode {
  return FLASHCARD_STUDY_MODES.some(mode => mode.value === value)
}

export type FlashcardOcclusionRegion = { id: string; x: number; y: number; width: number; height: number; label: string }
export type FlashcardImageOcclusion = { imageDataUrl: string; fileName: string; regions: FlashcardOcclusionRegion[] }

export type FlashcardReviewEvent = {
  at: number
  grade: 'again' | 'hard' | 'good' | 'easy'
  confidence?: number
  responseMs?: number
}

export type Flashcard = {
  id: string
  noteId: string
  question: string
  answer: string
  kind?: FlashcardKind
  studyMode: FlashcardStudyMode
  trueFalseAnswer?: boolean
  template?: FlashcardTemplate
  tags?: string[]
  imageOcclusion?: FlashcardImageOcclusion
  hints?: string[]
  answerVariants?: string[]
  sequenceItems?: string[]
  numericAnswer?: { value: number; tolerance: number; unit: string }
  mediaClip?: { attachmentId: string; startMs: number; endMs?: number }
  aiDistractors?: string[]
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  example?: string
  mnemonic?: string
  relatedCardIds?: string[]
  glossaryTerms?: { term: string; definition: string }[]
  suspended?: boolean
  dueAt: number
  intervalDays: number
  ease: number
  repetitions: number
  lapses: number
  lastReviewedAt?: number
  reviewHistory?: FlashcardReviewEvent[]
}

export type FlashcardTrashEntry = { id: string; deletedAt: number; card: Flashcard }

export type SavedSearch = {
  id: string
  name: string
  query: string
  tag: string
  folder: string
}

export type NoteTemplate = {
  id: string
  title: string
  tags: string[]
  content: string
}

export type NoteCollection = {
  id: string
  name: string
  noteIds: string[]
}

export type SavedWorkspaceLayout = {
  id: string
  name: string
  selectedNoteId: string
  activeFilter: string
  activeReviewSessionId: string
  allNotesPreset: 'all' | 'favorites' | 'recent'
  allNotesFolderPreset: string
  noteGridEnabled: boolean
  noteGridIds: string[]
  editorMode: 'rendered' | 'source'
  showMainSidebar: boolean
  showFoldersPanel?: boolean
  showChat: boolean
  createdAt: number
}

export type AiTaskType = 'chat' | 'summary' | 'tasks' | 'flashcards' | 'quiz' | 'selection-edit' | 'metadata' | 'flashcard-assist' | 'ocr'
export type AiOutputFormat = 'markdown' | 'bullets' | 'json' | 'table'

export type AiPromptProfile = {
  id: string
  task: AiTaskType
  name: string
  prompt: string
}

export type AiOutputTemplate = {
  id: string
  name: string
  format: AiOutputFormat
  instruction: string
}

export type AiOutputRating = {
  task: AiTaskType
  rating: 1 | -1
  comment: string
  createdAt: number
}

export type AiDiagnostic = {
  task: AiTaskType
  model: string
  contextCharacters: number
  contextImages: number
  durationMs: number
  error?: string
  createdAt: number
}

export type AiPreferences = {
  promptProfiles: AiPromptProfile[]
  outputTemplates: AiOutputTemplate[]
  folderAccessRestricted: boolean
  allowedFolders: string[]
  fallbackModel: string
  ratings: AiOutputRating[]
  lastDiagnostic?: AiDiagnostic
}

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  promptProfiles: [],
  outputTemplates: [
    { id: 'default-markdown', name: 'Markdown', format: 'markdown', instruction: 'Użyj czytelnego Markdown z nagłówkami tam, gdzie pomagają w odbiorze.' },
    { id: 'default-bullets', name: 'Lista punktowana', format: 'bullets', instruction: 'Przedstaw wynik jako zwięzłą listę punktowaną. Każdy punkt ma zawierać jedną myśl.' },
    { id: 'default-json', name: 'JSON', format: 'json', instruction: 'Zwróć poprawny JSON bez ogrodzenia kodu ani dodatkowego tekstu.' },
    { id: 'default-table', name: 'Tabela', format: 'table', instruction: 'Przedstaw wynik w czytelnej tabeli Markdown z krótkimi nazwami kolumn.' },
  ],
  folderAccessRestricted: false,
  allowedFolders: [],
  fallbackModel: '',
  ratings: [],
}

export type OrganizationSettings = {
  noteOrder: string[]
  folderOrder: string[]
  folderTemplateDefaults: Record<string, string>
  workspaces: SavedWorkspaceLayout[]
  collections: NoteCollection[]
  aiPreferences?: AiPreferences
}

export type ReviewSessionStatus = 'ready' | 'running' | 'paused' | 'completed'

export type ReviewSession = {
  id: string
  title: string
  noteIds: string[]
  createdAt: number
  updatedAt: number
  totalTimeMs: number
  noteTimesMs: Record<string, number>
  activeNoteId: string | null
  status: ReviewSessionStatus
  runningSince?: number
}

export type WorkspaceBackup = {
  reviewSessions: ReviewSession[]
  savedSearches: SavedSearch[]
  noteTemplates: NoteTemplate[]
  folderColors: Record<string, string>
  flashcards?: Flashcard[]
  flashcardTrash?: FlashcardTrashEntry[]
  trash?: TrashEntry[]
  organization?: OrganizationSettings
}
