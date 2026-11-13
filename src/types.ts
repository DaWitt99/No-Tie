export type Note = {
  id: string
  title: string
  content: string
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

export type FlashcardKind = 'basic' | 'cloze' | 'image-occlusion'

export type FlashcardOcclusionRegion = { id: string; x: number; y: number; width: number; height: number; label: string }
export type FlashcardImageOcclusion = { imageDataUrl: string; fileName: string; regions: FlashcardOcclusionRegion[] }

export type FlashcardReviewEvent = {
  at: number
  grade: 'again' | 'hard' | 'good' | 'easy'
}

export type Flashcard = {
  id: string
  noteId: string
  question: string
  answer: string
  kind?: FlashcardKind
  tags?: string[]
  imageOcclusion?: FlashcardImageOcclusion
  suspended?: boolean
  dueAt: number
  intervalDays: number
  ease: number
  repetitions: number
  lapses: number
  lastReviewedAt?: number
  reviewHistory?: FlashcardReviewEvent[]
}

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
  trash?: TrashEntry[]
}
