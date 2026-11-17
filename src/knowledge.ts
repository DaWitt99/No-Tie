import type { Note } from './types'

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskRepeat = '' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | `every-${number}-${'days' | 'weeks' | 'months'}`
export type TaskPriorityOption = { id: string; name: string; color: string; order: number }
export type ParsedTask = {
  id: string
  noteId: string
  noteTitle: string
  lineIndex: number
  text: string
  done: boolean
  dueDate: string
  priority: string
  status: TaskStatus
  repeat: TaskRepeat
  remindAt: string
  dependency: string
  relatedNoteIds: string[]
  attachmentIds: string[]
  estimateMinutes: number
  actualSeconds: number
  timerStartedAt: number
  completedAt: number
  milestone: boolean
  snoozedUntil: string
}

function normalize(value: string) { return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl') }
const decode = (item: string) => { try { return decodeURIComponent(item) } catch { return item } }
function readStringArray(value: string): string[] {
  try { const parsed: unknown = JSON.parse(decode(value)); return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === 'string'))] : [] } catch { return [] }
}

export function wikiTargets(markdown: string): string[] {
  const withoutCode = markdown.replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...withoutCode.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => match[1].split('|', 1)[0].trim()).filter(Boolean)
}

export function resolveWikiTarget(notes: Note[], target: string): Note | undefined {
  const exactId = notes.find(note => note.id === target)
  if (exactId) return exactId
  let decodedTarget = target.trim()
  try { decodedTarget = decodeURIComponent(decodedTarget) } catch { /* Keep literal spaces and malformed escapes. */ }
  const withoutHeading = decodedTarget.split(/[＃#^]/, 1)[0].replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '')
  const needle = normalize(withoutHeading)
  const baseName = needle.split('/').at(-1) ?? needle
  return notes.find(note => normalize(note.title) === needle || note.aliases?.some(alias => normalize(alias) === needle))
    ?? notes.find(note => {
      const notePath = normalize(`${note.folder}/${note.title}`).replace(/^importowane\//, '')
      return notePath === needle || notePath.endsWith(`/${needle}`)
    })
    ?? notes.find(note => normalize(note.title) === baseName || note.aliases?.some(alias => normalize(alias) === baseName))
}

export function backlinksFor(notes: Note[], note: Note): Note[] {
  return notes.filter(candidate => candidate.id !== note.id && wikiTargets(candidate.content).some(target => resolveWikiTarget(notes, target)?.id === note.id))
}

const taskMetadataPattern = /\s*<!--\s*no-tie-task\s+([^>]*?)\s*-->/i
const parsedTaskCache = new WeakMap<Note, ParsedTask[]>()
function token(value: string, key: string) { return value.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`))?.[1] ?? '' }
function parseTaskMetadata(value: string) {
  const dueDate = token(value, 'due')
  const priority = decode(token(value, 'priority')).toLowerCase() || 'normal'
  const statusValue = token(value, 'status')
  const status: TaskStatus = statusValue === 'doing' || statusValue === 'done' ? statusValue : 'todo'
  const repeatValue = decode(token(value, 'repeat'))
  const repeat: TaskRepeat = repeatValue === 'daily' || repeatValue === 'weekdays' || repeatValue === 'weekly' || repeatValue === 'monthly' || repeatValue === 'yearly' || /^every-\d{1,3}-(days|weeks|months)$/.test(repeatValue) ? repeatValue as TaskRepeat : ''
  const number = (key: string) => { const parsed = Number(token(value, key)); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0 }
  return {
    dueDate, priority, status, repeat, remindAt: decode(token(value, 'remind')), dependency: decode(token(value, 'depends')), id: decode(token(value, 'id')),
    relatedNoteIds: readStringArray(token(value, 'notes')), attachmentIds: readStringArray(token(value, 'attachments')),
    estimateMinutes: number('estimate'), actualSeconds: number('actual'), timerStartedAt: number('timer'), completedAt: number('completed'),
    milestone: token(value, 'milestone') === '1', snoozedUntil: decode(token(value, 'snooze')),
  }
}

export function parseTasks(notes: Note[]): ParsedTask[] {
  return notes.flatMap(note => {
    const cached = parsedTaskCache.get(note)
    if (cached) return cached
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
    parsedTaskCache.set(note, tasks)
    return tasks
  })
}

export type TaskPatch = Partial<Pick<ParsedTask, 'done' | 'dueDate' | 'priority' | 'status' | 'repeat' | 'remindAt' | 'dependency' | 'relatedNoteIds' | 'attachmentIds' | 'estimateMinutes' | 'actualSeconds' | 'timerStartedAt' | 'completedAt' | 'milestone' | 'snoozedUntil'>>
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
  const relatedNoteIds = patch.relatedNoteIds ?? task.relatedNoteIds
  const attachmentIds = patch.attachmentIds ?? task.attachmentIds
  const estimateMinutes = patch.estimateMinutes ?? task.estimateMinutes
  const actualSeconds = patch.actualSeconds ?? task.actualSeconds
  const timerStartedAt = patch.timerStartedAt ?? task.timerStartedAt
  const completedAt = patch.completedAt !== undefined ? patch.completedAt : done ? task.completedAt || Date.now() : 0
  const milestone = patch.milestone ?? task.milestone
  const snoozedUntil = patch.snoozedUntil ?? task.snoozedUntil
  const fields = [
    `id=${encodeURIComponent(task.id)}`,
    dueDate ? `due=${dueDate}` : '',
    priority !== 'normal' ? `priority=${encodeURIComponent(priority)}` : '',
    status !== (done ? 'done' : 'todo') ? `status=${status}` : '',
    repeat ? `repeat=${repeat}` : '',
    remindAt ? `remind=${encodeURIComponent(remindAt)}` : '',
    dependency ? `depends=${encodeURIComponent(dependency)}` : '',
    relatedNoteIds.length ? `notes=${encodeURIComponent(JSON.stringify(relatedNoteIds))}` : '',
    attachmentIds.length ? `attachments=${encodeURIComponent(JSON.stringify(attachmentIds))}` : '',
    estimateMinutes ? `estimate=${estimateMinutes}` : '',
    actualSeconds ? `actual=${actualSeconds}` : '',
    timerStartedAt ? `timer=${timerStartedAt}` : '',
    completedAt ? `completed=${completedAt}` : '',
    milestone ? 'milestone=1' : '',
    snoozedUntil ? `snooze=${encodeURIComponent(snoozedUntil)}` : '',
  ].filter(Boolean)
  const metadata = fields.length ? ` <!-- no-tie-task ${fields.join(' ')} -->` : ''
  lines[task.lineIndex] = `${match[1]}${done ? 'x' : ' '}${match[3]}${body}${metadata}`
  return lines.join('\n')
}

export function nextTaskDate(value: string, repeat: TaskRepeat): string {
  const date = value ? new Date(`${value}T12:00:00`) : new Date()
  if (repeat === 'daily') date.setDate(date.getDate() + 1)
  else if (repeat === 'weekdays') { do { date.setDate(date.getDate() + 1) } while (date.getDay() === 0 || date.getDay() === 6) }
  else if (repeat === 'weekly') date.setDate(date.getDate() + 7)
  else if (repeat === 'monthly') date.setMonth(date.getMonth() + 1)
  else if (repeat === 'yearly') date.setFullYear(date.getFullYear() + 1)
  else if (repeat.startsWith('every-')) {
    const [, countValue, unit] = repeat.match(/^every-(\d+)-(days|weeks|months)$/) ?? []
    const count = Number(countValue) || 1
    if (unit === 'days') date.setDate(date.getDate() + count)
    else if (unit === 'weeks') date.setDate(date.getDate() + count * 7)
    else if (unit === 'months') date.setMonth(date.getMonth() + count)
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
