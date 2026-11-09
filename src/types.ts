export type Note = {
  id: string
  title: string
  content: string
  folder: string
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
