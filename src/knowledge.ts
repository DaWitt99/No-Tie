import type { Note } from './types'

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskRepeat = '' | 'daily' | 'weekly' | 'monthly'
export type ParsedTask = {
  id: string
  noteId: string
  noteTitle: string
  lineIndex: number
  text: string
  done: boolean
  dueDate: string
  priority: 'low' | 'normal' | 'high'
  status: TaskStatus
  repeat: TaskRepeat
  remindAt: string
  dependency: string
}

function normalize(value: string) { return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl') }

export function wikiTargets(markdown: string): string[] {
  const withoutCode = markdown.replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...withoutCode.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1].split('|', 1)[0].trim()).filter(Boolean)
}

export function resolveWikiTarget(notes: Note[], target: string): Note | undefined {
  const exactId = notes.find(note => note.id === target)
  if (exactId) return exactId
  const needle = normalize(target)
  return notes.find(note => normalize(note.title) === needle || note.aliases?.some(alias => normalize(alias) === needle))
}

export function backlinksFor(notes: Note[], note: Note): Note[] {
  return notes.filter(candidate => candidate.id !== note.id && wikiTargets(candidate.content).some(target => resolveWikiTarget(notes, target)?.id === note.id))
}

const taskMetadataPattern = /\s*<!--\s*no-tie-task\s+([^>]*?)\s*-->/i
function token(value: string, key: string) { return value.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`))?.[1] ?? '' }
function parseTaskMetadata(value: string) {
  const dueDate = token(value, 'due')
  const priorityValue = token(value, 'priority').toLowerCase()
  const priority: ParsedTask['priority'] = priorityValue === 'low' || priorityValue === 'high' ? priorityValue : 'normal'
  const statusValue = token(value, 'status')
  const status: TaskStatus = statusValue === 'doing' || statusValue === 'done' ? statusValue : 'todo'
  const repeatValue = token(value, 'repeat')
  const repeat: TaskRepeat = repeatValue === 'daily' || repeatValue === 'weekly' || repeatValue === 'monthly' ? repeatValue : ''
  const decode = (item: string) => { try { return decodeURIComponent(item) } catch { return item } }
  return { dueDate, priority, status, repeat, remindAt: decode(token(value, 'remind')), dependency: decode(token(value, 'depends')), id: decode(token(value, 'id')) }
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
      const parsed = parseTaskMetadata(metadata)
      const text = match[3].replace(taskMetadataPattern, '').trim()
      if (!text) return
      const done = match[2].toLowerCase() === 'x' || parsed.status === 'done'
      tasks.push({ noteId: note.id, noteTitle: note.title, lineIndex, text, done, ...parsed, status: done ? 'done' : parsed.status, id: parsed.id || `${note.id}:${lineIndex}` })
    })
    return tasks
  })
}

export type TaskPatch = Partial<Pick<ParsedTask, 'done' | 'dueDate' | 'priority' | 'status' | 'repeat' | 'remindAt' | 'dependency'>>
export function updateTaskLine(markdown: string, task: ParsedTask, patch: TaskPatch): string {
  const lines = markdown.split('\n')
  const line = lines[task.lineIndex]
  if (line === undefined) return markdown
  const match = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/)
  if (!match) return markdown
  const body = match[4].replace(taskMetadataPattern, '').trimEnd()
  const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate
  const priority = patch.priority ?? task.priority
  const done = patch.done === undefined ? (patch.status === undefined ? task.done : patch.status === 'done') : patch.done
  const status = patch.status ?? (patch.done === undefined ? task.status : patch.done ? 'done' : 'todo')
  const repeat = patch.repeat === undefined ? task.repeat : patch.repeat
  const remindAt = patch.remindAt === undefined ? task.remindAt : patch.remindAt
  const dependency = patch.dependency === undefined ? task.dependency : patch.dependency
  const fields = [
    `id=${encodeURIComponent(task.id)}`,
    dueDate ? `due=${dueDate}` : '',
    priority !== 'normal' ? `priority=${priority}` : '',
    status !== (done ? 'done' : 'todo') ? `status=${status}` : '',
    repeat ? `repeat=${repeat}` : '',
    remindAt ? `remind=${encodeURIComponent(remindAt)}` : '',
    dependency ? `depends=${encodeURIComponent(dependency)}` : '',
  ].filter(Boolean)
  const metadata = fields.length ? ` <!-- no-tie-task ${fields.join(' ')} -->` : ''
  lines[task.lineIndex] = `${match[1]}${done ? 'x' : ' '}${match[3]}${body}${metadata}`
  return lines.join('\n')
}

export function nextTaskDate(value: string, repeat: TaskRepeat): string {
  const date = value ? new Date(`${value}T12:00:00`) : new Date()
  if (repeat === 'daily') date.setDate(date.getDate() + 1)
  else if (repeat === 'weekly') date.setDate(date.getDate() + 7)
  else if (repeat === 'monthly') date.setMonth(date.getMonth() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
