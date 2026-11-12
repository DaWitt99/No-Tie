import type { Note, NoteAttachment } from './types'

export type NoteSearchFilters = {
  query: string
  tag?: string
  folder?: string
  attachments?: NoteAttachment[]
  advanced?: boolean
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').trim()
}

export function searchNotes(notes: Note[], { query, tag = '', folder = '', attachments = [], advanced = true }: NoteSearchFilters): Note[] {
  const tagNeedle = normalize(tag)
  const folderNeedle = normalize(folder)
  const attachmentByNote = new Map<string, NoteAttachment[]>()
  for (const attachment of attachments) attachmentByNote.set(attachment.noteId, [...(attachmentByNote.get(attachment.noteId) ?? []), attachment])
  const groups = (advanced ? query.split(/\s+OR\s+/i) : [query]).map(rawGroup => {
    const fields: Record<string, string[]> = {}
    const operator = advanced ? /(^|\s)(tag|folder|title|content|created|updated|after|before|has|is):(?:"([^"]*)"|'([^']*)'|(\S+))/gi : /(?!)/g
    const queryWithoutOperators = rawGroup.replace(operator, (_match, separator: string) => separator)
    for (const match of advanced ? rawGroup.matchAll(operator) : []) {
      const field = match[2].toLowerCase()
      const value = normalize(match[3] ?? match[4] ?? match[5] ?? '')
      if (value) (fields[field] ??= []).push(value)
    }
    const terms: { value: string; negative: boolean }[] = []
    let negateNext = false
    for (const raw of queryWithoutOperators.match(/"[^"]+"|'[^']+'|\S+/g) ?? []) {
      if (advanced && /^NOT$/i.test(raw)) { negateNext = true; continue }
      const negative = advanced && (negateNext || raw.startsWith('-'))
      const value = normalize(raw.replace(/^-/, '').replace(/^['"]|['"]$/g, ''))
      if (value) terms.push({ value, negative })
      negateNext = false
    }
    return { fields, terms }
  }).filter(group => Object.keys(group.fields).length || group.terms.length)
  return notes.filter(note => {
    const title = normalize(note.title)
    const noteAttachments = attachmentByNote.get(note.id) ?? []
    const attachmentText = noteAttachments.map(attachment => `${attachment.fileName} ${attachment.transcript ?? ''} ${attachment.extractedText ?? ''}`).join(' ')
    const content = normalize(`${note.content} ${attachmentText}`)
    const noteFolder = normalize(note.folder)
    const tags = note.tags.map(normalize)
    if (tagNeedle && !tags.some(value => value === tagNeedle)) return false
    if (folderNeedle === '__root__' && note.folder) return false
    if (folderNeedle && folderNeedle !== '__root__' && noteFolder !== folderNeedle && !noteFolder.startsWith(`${folderNeedle}/`)) return false
    const searchable = normalize(`${note.title} ${note.aliases?.join(' ') ?? ''} ${note.content} ${note.folder} ${note.tags.join(' ')}`)
    const matchesGroup = ({ fields, terms }: typeof groups[number]) => {
      if (!(fields.tag ?? []).every(needle => tags.some(value => value.includes(needle)))) return false
      if (!(fields.folder ?? []).every(needle => noteFolder.includes(needle))) return false
      if (!(fields.title ?? []).every(needle => title.includes(needle))) return false
      if (!(fields.content ?? []).every(needle => content.includes(needle))) return false
      const created = new Date(note.createdAt).toISOString().slice(0, 10)
      const updated = new Date(note.updatedAt).toISOString().slice(0, 10)
      const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00`))
      if ([...(fields.created ?? []), ...(fields.updated ?? []), ...(fields.after ?? []), ...(fields.before ?? [])].some(date => !validDate(date))) return false
      if (!(fields.created ?? []).every(date => created === date)) return false
      if (!(fields.updated ?? []).every(date => updated === date)) return false
      if (!(fields.after ?? []).every(date => note.updatedAt >= new Date(`${date}T00:00:00`).getTime())) return false
      if (!(fields.before ?? []).every(date => note.updatedAt < new Date(`${date}T00:00:00`).getTime())) return false
      if (!(fields.is ?? []).every(value => value === 'favorite' && note.favorite)) return false
      if (!(fields.has ?? []).every(value => noteAttachments.some(attachment => value === 'attachment'
        || value === 'pdf' && attachment.mimeType === 'application/pdf'
        || value === 'image' && attachment.mimeType.startsWith('image/')
        || value === 'audio' && attachment.mimeType.startsWith('audio/')))) return false
      return terms.every(term => term.negative ? !searchable.includes(term.value) && !content.includes(term.value) : searchable.includes(term.value) || content.includes(term.value))
    }
    return !groups.length || groups.some(matchesGroup)
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}
