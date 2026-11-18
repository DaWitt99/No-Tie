import type { Note, NoteAttachment } from './types'

export type NoteSearchFilters = {
  query: string
  tag?: string
  folder?: string
  attachments?: NoteAttachment[]
  advanced?: boolean
  sortByUpdated?: boolean
}

type SearchGroup = { fields: Record<string, string[]>; terms: { value: string; negative: boolean }[] }
type AttachmentIndex = { content: Map<string, string>; byNote: Map<string, NoteAttachment[]> }
type IndexedNote = {
  title?: string
  content?: string
  folder?: string
  tags?: string[]
  aliases?: string
  created?: string
  updated?: string
  attachmentContent: WeakMap<NoteAttachment[], string>
}

const EMPTY_ATTACHMENTS: NoteAttachment[] = []
const noteIndexes = new WeakMap<Note, IndexedNote>()
const attachmentIndexes = new WeakMap<NoteAttachment[], AttachmentIndex>()
const queryIndexes = new Map<string, SearchGroup[]>()
const MAX_QUERY_CACHE = 128

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').trim()
}

function getNoteIndex(note: Note): IndexedNote {
  const cached = noteIndexes.get(note)
  if (cached) return cached
  const index: IndexedNote = {
    attachmentContent: new WeakMap(),
  }
  noteIndexes.set(note, index)
  return index
}

function getTitle(note: Note, index: IndexedNote) { return index.title ??= normalize(note.title) }
function getContent(note: Note, index: IndexedNote) { return index.content ??= normalize(note.content) }
function getFolder(note: Note, index: IndexedNote) { return index.folder ??= normalize(note.folder) }
function getTags(note: Note, index: IndexedNote) { return index.tags ??= note.tags.map(normalize) }
function getAliases(note: Note, index: IndexedNote) { return index.aliases ??= normalize(note.aliases?.join(' ') ?? '') }
function getCreated(note: Note, index: IndexedNote) { return index.created ??= new Date(note.createdAt).toISOString().slice(0, 10) }
function getUpdated(note: Note, index: IndexedNote) { return index.updated ??= new Date(note.updatedAt).toISOString().slice(0, 10) }

function getAttachmentIndex(attachments: NoteAttachment[]): AttachmentIndex {
  const cached = attachmentIndexes.get(attachments)
  if (cached) return cached
  const grouped = new Map<string, NoteAttachment[]>()
  for (const attachment of attachments) {
    const values = grouped.get(attachment.noteId) ?? []
    values.push(attachment)
    grouped.set(attachment.noteId, values)
  }
  const content = new Map([...grouped].map(([noteId, values]) => [noteId, values.map(attachment => `${attachment.fileName} ${attachment.author ?? ''} ${attachment.documentDate ?? ''} ${attachment.description ?? ''} ${attachment.transcript ?? ''} ${attachment.extractedText ?? ''}`).join(' ')]))
  const index = { content, byNote: grouped }
  attachmentIndexes.set(attachments, index)
  return index
}

function getSearchGroups(query: string, advanced: boolean): SearchGroup[] {
  const key = `${advanced ? '1' : '0'}\u0000${query}`
  const cached = queryIndexes.get(key)
  if (cached) {
    queryIndexes.delete(key)
    queryIndexes.set(key, cached)
    return cached
  }
  const groups = (advanced ? query.split(/\s+OR\s+/i) : [query]).map(rawGroup => {
    const fields: Record<string, string[]> = {}
    const operator = advanced ? /(^|\s)(tag|folder|title|content|created|updated|after|before|has|is):(?:"([^"]*)"|'([^']*)'|(\S+))/gi : /(?!)/g
    const queryWithoutOperators = rawGroup.replace(operator, (_match, separator: string) => separator)
    for (const match of advanced ? rawGroup.matchAll(operator) : []) {
      const field = match[2]!.toLowerCase()
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

  queryIndexes.set(key, groups)
  if (queryIndexes.size > MAX_QUERY_CACHE) queryIndexes.delete(queryIndexes.keys().next().value!)
  return groups
}

export function searchNotes(notes: Note[], { query, tag = '', folder = '', attachments = EMPTY_ATTACHMENTS, advanced = true, sortByUpdated = true }: NoteSearchFilters): Note[] {
  const tagNeedle = normalize(tag)
  const folderNeedle = normalize(folder)
  const groups = getSearchGroups(query, advanced)
  const needsTerms = groups.some(group => group.terms.length > 0)
  const needsContent = needsTerms || groups.some(group => Boolean(group.fields.content?.length))
  const attachmentIndex = needsContent || groups.some(group => Boolean(group.fields.has?.length)) ? getAttachmentIndex(attachments) : undefined

  if (!groups.length && !tagNeedle && !folderNeedle) return sortByUpdated ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt) : [...notes]
  const results = notes.filter(note => {
    const index = getNoteIndex(note)
    if (tagNeedle && !getTags(note, index).some(value => value === tagNeedle)) return false
    if (folderNeedle === '__root__' && note.folder) return false
    if (folderNeedle && folderNeedle !== '__root__') {
      const noteFolder = getFolder(note, index)
      if (noteFolder !== folderNeedle && !noteFolder.startsWith(`${folderNeedle}/`)) return false
    }

    let content = ''
    if (needsContent && attachmentIndex) {
      let combined = index.attachmentContent.get(attachments)
      if (combined === undefined) {
        const attachmentText = attachmentIndex.content.get(note.id) ?? ''
        combined = normalize(`${note.content} ${attachmentText}`)
        index.attachmentContent.set(attachments, combined)
      }
      content = combined
    } else if (needsContent) content = getContent(note, index)
    const hasTerm = (value: string) => getTitle(note, index).includes(value)
      || getAliases(note, index).includes(value)
      || (needsContent ? content : getContent(note, index)).includes(value)
      || getFolder(note, index).includes(value)
      || getTags(note, index).some(tagValue => tagValue.includes(value))
    const matchesGroup = ({ fields, terms }: SearchGroup) => {
      if (!(fields.tag ?? []).every(needle => getTags(note, index).some(value => value.includes(needle)))) return false
      if (!(fields.folder ?? []).every(needle => getFolder(note, index).includes(needle))) return false
      if (!(fields.title ?? []).every(needle => getTitle(note, index).includes(needle))) return false
      if (!(fields.content ?? []).every(needle => content.includes(needle))) return false
      if ([...(fields.created ?? []), ...(fields.updated ?? []), ...(fields.after ?? []), ...(fields.before ?? [])].some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00`)))) return false
      if (!(fields.created ?? []).every(date => getCreated(note, index) === date)) return false
      if (!(fields.updated ?? []).every(date => getUpdated(note, index) === date)) return false
      if (!(fields.after ?? []).every(date => note.updatedAt >= new Date(`${date}T00:00:00`).getTime())) return false
      if (!(fields.before ?? []).every(date => note.updatedAt < new Date(`${date}T00:00:00`).getTime())) return false
      if (!(fields.is ?? []).every(value => value === 'favorite' && note.favorite)) return false
      const noteAttachments = attachmentIndex?.byNote.get(note.id) ?? []
      if (!(fields.has ?? []).every(value => noteAttachments.some(attachment => value === 'attachment'
        || value === 'pdf' && attachment.mimeType === 'application/pdf'
        || value === 'image' && attachment.mimeType.startsWith('image/')
        || value === 'audio' && attachment.mimeType.startsWith('audio/')))) return false
      return terms.every(term => term.negative ? !hasTerm(term.value) : hasTerm(term.value))
    }
    return !groups.length || groups.some(matchesGroup)
  })
  return sortByUpdated ? results.sort((a, b) => b.updatedAt - a.updatedAt) : results
}
