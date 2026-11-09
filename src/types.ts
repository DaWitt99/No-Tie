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
}

export type NoteAsset = {
  id: string
  noteId: string
  fileName: string
  svg: string
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
