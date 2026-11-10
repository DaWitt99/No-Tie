import type { Note } from './types'

export type ParsedTask = {
  id: string
  noteId: string
  noteTitle: string
  lineIndex: number
  text: string
  done: boolean
  dueDate: string
  priority: 'low' | 'normal' | 'high'
}

function normalize(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl')
}

export function wikiTargets(markdown: string): string[] {
  const withoutCode = markdown.replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...withoutCode.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1].split('|', 1)[0].trim()).filter(Boolean)
}

export function resolveWikiTarget(notes: Note[], target: string): Note | undefined {
  const exactId = notes.find(note => note.id === target)
  if (exactId) return exactId
  const needle = normalize(target)
  return notes.find(note => normalize(note.title) === needle)
}

export function backlinksFor(notes: Note[], note: Note): Note[] {
  return notes.filter(candidate => candidate.id !== note.id && wikiTargets(candidate.content).some(target => resolveWikiTarget(notes, target)?.id === note.id))
}

const taskMetadataPattern = /\s*<!--\s*no-tie-task\s+([^>]*?)\s*-->\s*$/i

function parseTaskMetadata(value: string) {
  const dueDate = value.match(/(?:^|\s)due=(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1] ?? ''
  const priorityValue = value.match(/(?:^|\s)priority=(low|normal|high)(?:\s|$)/i)?.[1]?.toLowerCase()
  const priority: ParsedTask['priority'] = priorityValue === 'low' || priorityValue === 'high' ? priorityValue : 'normal'
  return { dueDate, priority }
}

export function parseTasks(notes: Note[]): ParsedTask[] {
  return notes.flatMap(note => {
    const tasks: ParsedTask[] = []
    let codeFence = ''
    note.content.split('\n').forEach((line, lineIndex) => {
      const fence = line.match(/^\s*(```+|~~~+)/)?.[1]?.[0]
      if (fence) { codeFence = codeFence ? (codeFence === fence ? '' : codeFence) : fence; return }
      if (codeFence) return
      const match = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+)(.*)$/)
      if (!match) return
      const metadata = match[3].match(taskMetadataPattern)?.[1] ?? ''
      const text = match[3].replace(taskMetadataPattern, '').trim()
      if (!text) return
      tasks.push({ id: `${note.id}:${lineIndex}`, noteId: note.id, noteTitle: note.title, lineIndex, text, done: match[2].toLowerCase() === 'x', ...parseTaskMetadata(metadata) })
    })
    return tasks
  })
}

export function updateTaskLine(markdown: string, task: ParsedTask, patch: Partial<Pick<ParsedTask, 'done' | 'dueDate' | 'priority'>>): string {
  const lines = markdown.split('\n')
  const line = lines[task.lineIndex]
  if (line === undefined) return markdown
  const match = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/)
  if (!match) return markdown
  const oldTail = match[4]
  const body = oldTail.replace(taskMetadataPattern, '').trimEnd()
  const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate
  const priority = patch.priority ?? task.priority
  const metadata = dueDate || priority !== 'normal'
    ? ` <!-- no-tie-task${dueDate ? ` due=${dueDate}` : ''}${priority !== 'normal' ? ` priority=${priority}` : ''} -->`
    : ''
  const checkbox = patch.done === undefined ? match[2] : patch.done ? 'x' : ' '
  lines[task.lineIndex] = `${match[1]}${checkbox}${match[3]}${body}${metadata}`
  return lines.join('\n')
}
