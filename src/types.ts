export type Note = {
  id: string
  title: string
  content: string
  folder: string
  color?: string
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
}

export type NoteAttachmentReference = Pick<NoteAttachment, 'fileName' | 'mimeType' | 'size' | 'contentHash'>

export type NoteAttachmentHistory = NoteAttachment & {
  deletedAt: number
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
}
