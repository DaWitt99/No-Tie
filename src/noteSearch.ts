import type { Note } from './types'

export type NoteSearchFilters = {
  query: string
  tag?: string
  folder?: string
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').trim()
}

export function searchNotes(notes: Note[], { query, tag = '', folder = '' }: NoteSearchFilters): Note[] {
  const fields: Record<'tag' | 'folder' | 'title' | 'content', string[]> = { tag: [], folder: [], title: [], content: [] }
  const operator = /(^|\s)(tag|folder|title|content):(?:"([^"]*)"|'([^']*)'|(\S+))/gi
  const queryWithoutOperators = query.replace(operator, (_match, separator: string) => separator)
  for (const match of query.matchAll(operator)) {
    const field = match[2].toLowerCase() as keyof typeof fields
    const value = normalize(match[3] ?? match[4] ?? match[5] ?? '')
    if (value) fields[field].push(value)
  }
  const terms = Array.from(queryWithoutOperators.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g), match => normalize(match[1] ?? match[2] ?? match[3] ?? '')).filter(Boolean)
  const tagNeedle = normalize(tag)
  const folderNeedle = normalize(folder)

  return notes.filter(note => {
    const title = normalize(note.title)
    const content = normalize(note.content)
    const noteFolder = normalize(note.folder)
    const tags = note.tags.map(normalize)
    if (tagNeedle && !tags.some(value => value === tagNeedle)) return false
    if (folderNeedle === '__root__' && note.folder) return false
    if (folderNeedle && folderNeedle !== '__root__' && noteFolder !== folderNeedle && !noteFolder.startsWith(`${folderNeedle}/`)) return false
    if (!fields.tag.every(needle => tags.some(value => value.includes(needle)))) return false
    if (!fields.folder.every(needle => noteFolder.includes(needle))) return false
    if (!fields.title.every(needle => title.includes(needle))) return false
    if (!fields.content.every(needle => content.includes(needle))) return false
    const searchable = normalize(`${note.title} ${note.aliases?.join(' ') ?? ''} ${note.content} ${note.folder} ${note.tags.join(' ')}`)
    return terms.every(needle => searchable.includes(needle))
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}
