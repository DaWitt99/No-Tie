import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import { ArrowLeft, Bell, BookmarkPlus, CalendarDays, CheckSquare2, ChevronLeft, ChevronRight, Flag, Clock3, FileText, Paperclip, Play, Plus, Timer, Trash2 } from 'lucide-react'
import type { Note, NoteAttachment } from './types'
import type { ParsedTask, TaskPatch, TaskPriorityOption, TaskRepeat, TaskStatus } from './knowledge'

type TaskPriority = ParsedTask['priority']
type TaskTemplate = { id: string; name: string; title: string; priority: string; repeat: TaskRepeat; estimateMinutes: number; milestone: boolean }
type ProjectTemplate = { id: string; name: string; tasks: { title: string; estimateMinutes: number; milestone: boolean }[] }
type TaskView = 'list' | 'kanban' | 'calendar' | 'timeline' | 'week' | 'templates'
const statusLabels: Record<TaskStatus, string> = { todo: 'Do zrobienia', doing: 'W toku', done: 'Zrobione' }
const defaultPriorities: TaskPriorityOption[] = [
  { id: 'high', name: 'Wysoki', color: '#c66c68', order: 0 },
  { id: 'normal', name: 'Zwykły', color: '#7081d4', order: 1 },
  { id: 'low', name: 'Niski', color: '#7d987a', order: 2 },
]
const prioritiesKey = 'no-tie-task-priorities'
const taskTemplatesKey = 'no-tie-task-templates'
const projectTemplatesKey = 'no-tie-project-templates'
function readStored<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function dateTimeString(date: Date) { return `${dateString(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function duration(seconds: number) { const total = Math.max(0, Math.floor(seconds)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); return hours ? `${hours} godz. ${minutes} min` : `${minutes} min` }
function selectedValues(event: ChangeEvent<HTMLSelectElement>) { return [...event.currentTarget.selectedOptions].map(option => option.value) }

export function TaskManagerPage({ notes, tasks, attachments, onUpdate, onOpenNote, onOpenAttachment, onCreate, onCreateMany, onClose }: {
  notes: Note[]; tasks: ParsedTask[]; attachments: NoteAttachment[]; onUpdate: (task: ParsedTask, patch: TaskPatch) => void; onOpenNote: (noteId: string) => void
  onOpenAttachment: (attachment: NoteAttachment) => void
  onCreate: (noteId: string, title: string, dueDate: string, priority: TaskPriority, repeat?: TaskRepeat, remindAt?: string, dependency?: string, extra?: TaskPatch) => void
  onCreateMany: (noteId: string, tasks: { title: string; extra?: TaskPatch }[]) => void; onClose: () => void
}) {
  const [view, setView] = useState<TaskView>('list')
  const [showCompleted, setShowCompleted] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [repeat, setRepeat] = useState<TaskRepeat | 'custom'>('')
  const [repeatCount, setRepeatCount] = useState(2)
  const [repeatUnit, setRepeatUnit] = useState<'days' | 'weeks' | 'months'>('weeks')
  const [remindAt, setRemindAt] = useState('')
  const [dependency, setDependency] = useState('')
  const [estimateMinutes, setEstimateMinutes] = useState(0)
  const [milestone, setMilestone] = useState(false)
  const [relatedNoteIds, setRelatedNoteIds] = useState<string[]>([])
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [now, setNow] = useState(Date.now())
  const [priorityOptions, setPriorityOptions] = useState<TaskPriorityOption[]>(() => readStored(prioritiesKey, defaultPriorities))
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(() => readStored(taskTemplatesKey, []))
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplate[]>(() => readStored(projectTemplatesKey, []))
  const [projectTemplateName, setProjectTemplateName] = useState('')
  const [projectTemplateText, setProjectTemplateText] = useState('')
  const [priorityName, setPriorityName] = useState('')
  const [priorityColor, setPriorityColor] = useState('#7382d3')
  const today = dateString(new Date(now))
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { localStorage.setItem(prioritiesKey, JSON.stringify(priorityOptions)) }, [priorityOptions])
  useEffect(() => { localStorage.setItem(taskTemplatesKey, JSON.stringify(taskTemplates)) }, [taskTemplates])
  useEffect(() => { localStorage.setItem(projectTemplatesKey, JSON.stringify(projectTemplates)) }, [projectTemplates])

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || (priorityOptions.find(item => item.id === a.priority)?.order ?? 999) - (priorityOptions.find(item => item.id === b.priority)?.order ?? 999)), [priorityOptions, tasks])
  const visibleTasks = sortedTasks.filter(task => showCompleted || !task.done)
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const noteById = useMemo(() => new Map(notes.map(note => [note.id, note])), [notes])
  const attachmentById = useMemo(() => new Map(attachments.map(attachment => [attachment.id, attachment])), [attachments])
  const currentWeekEnd = new Date(now); currentWeekEnd.setDate(currentWeekEnd.getDate() + 6)
  const overdueTasks = sortedTasks.filter(task => !task.done && task.dueDate && task.dueDate < today)
  const dueThisWeek = sortedTasks.filter(task => !task.done && task.dueDate && task.dueDate >= today && task.dueDate <= dateString(currentWeekEnd))
  const completedThisWeek = sortedTasks.filter(task => task.done && task.completedAt >= now - 7 * 24 * 60 * 60 * 1000)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!noteId || !draft.trim()) return
    const actualRepeat = repeat === 'custom' ? `every-${Math.max(1, repeatCount)}-${repeatUnit}` as TaskRepeat : repeat
    onCreate(noteId, draft.trim(), dueDate, priority, actualRepeat, remindAt, dependency, { estimateMinutes, milestone, relatedNoteIds, attachmentIds })
    setDraft(''); setDueDate(''); setPriority('normal'); setRepeat(''); setRemindAt(''); setDependency(''); setEstimateMinutes(0); setMilestone(false); setRelatedNoteIds([]); setAttachmentIds([])
  }
  function applyTaskTemplate(id: string) {
    const template = taskTemplates.find(item => item.id === id)
    if (!template) return
    setDraft(template.title); setPriority(template.priority); setRepeat(template.repeat); setEstimateMinutes(template.estimateMinutes); setMilestone(template.milestone)
  }
  function saveTaskTemplate() {
    if (!draft.trim()) return
    const name = window.prompt('Nazwa szablonu zadania', draft.trim())?.trim()
    if (!name) return
    const templateRepeat = repeat === 'custom' ? `every-${Math.max(1, repeatCount)}-${repeatUnit}` as TaskRepeat : repeat
    setTaskTemplates(current => [{ id: crypto.randomUUID(), name, title: draft.trim(), priority, repeat: templateRepeat, estimateMinutes, milestone }, ...current])
  }
  function saveProjectTemplate(event: FormEvent) {
    event.preventDefault()
    const templateTasks = projectTemplateText.split('\n').map(line => line.trim()).filter(Boolean).map(line => ({ title: line.replace(/^[-*]\s*/, '').replace(/^\[m\]\s*/i, ''), estimateMinutes: 0, milestone: /^\[m\]\s*/i.test(line) }))
    if (!projectTemplateName.trim() || !templateTasks.length) return
    setProjectTemplates(current => [{ id: crypto.randomUUID(), name: projectTemplateName.trim(), tasks: templateTasks }, ...current])
    setProjectTemplateName(''); setProjectTemplateText('')
  }
  function applyProjectTemplate(template: ProjectTemplate) {
    if (!noteId) return
    onCreateMany(noteId, template.tasks.map(item => ({ title: item.title, extra: { estimateMinutes: item.estimateMinutes, milestone: item.milestone } })))
  }
  function addPriority(event: FormEvent) {
    event.preventDefault()
    const name = priorityName.trim()
    if (!name) return
    const id = `custom-${crypto.randomUUID()}`
    setPriorityOptions(current => [...current, { id, name, color: priorityColor, order: current.length }])
    setPriorityName('')
  }
  function updatePriority(option: TaskPriorityOption, patch: Partial<TaskPriorityOption>) { setPriorityOptions(current => current.map(item => item.id === option.id ? { ...item, ...patch } : item)) }
  function deletePriority(option: TaskPriorityOption) {
    if (option.id === 'high' || option.id === 'normal' || option.id === 'low' || tasks.some(task => task.priority === option.id)) return
    setPriorityOptions(current => current.filter(item => item.id !== option.id).map((item, index) => ({ ...item, order: index })))
  }
  function stopTimer(task: ParsedTask) {
    if (!task.timerStartedAt) { onUpdate(task, { timerStartedAt: now }); return }
    onUpdate(task, { timerStartedAt: 0, actualSeconds: task.actualSeconds + Math.floor((now - task.timerStartedAt) / 1000) })
  }
  function snooze(task: ParsedTask, minutes: number) { onUpdate(task, { snoozedUntil: dateTimeString(new Date(now + minutes * 60_000)) }) }

  const renderTask = (task: ParsedTask) => {
    const priorityOption = priorityOptions.find(option => option.id === task.priority)
    const runningSeconds = task.actualSeconds + (task.timerStartedAt ? Math.floor((now - task.timerStartedAt) / 1000) : 0)
    const blockers = tasks.filter(item => item.id !== task.id && !item.done)
    const dependencyBlocker = task.dependency ? taskById.get(task.dependency) : undefined
    const linkedNotes = task.relatedNoteIds.map(id => noteById.get(id)).filter((item): item is Note => Boolean(item))
    const linkedAttachments = task.attachmentIds.map(id => attachmentById.get(id)).filter((item): item is NoteAttachment => Boolean(item))
    const isOverdue = task.dueDate && task.dueDate < today && !task.done
    return <article key={task.id} className={`task-row ${task.done ? 'done' : ''} ${isOverdue ? 'overdue' : ''} ${task.milestone ? 'milestone' : ''}`}>
      <input type="checkbox" aria-label={`${task.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}: ${task.text}`} checked={task.done} onChange={event => onUpdate(task, { done: event.target.checked })} />
      <div className="task-main"><div className="task-title-line"><strong>{task.milestone && <Flag size={13} aria-label="Kamień milowy" />} {task.text}</strong>{priorityOption && <span className="task-priority-chip" style={{ '--task-priority-color': priorityOption.color } as CSSProperties}>{priorityOption.name}</span>}</div>
        <button type="button" onClick={() => onOpenNote(task.noteId)}>{task.noteTitle || 'Bez tytułu'} ↗</button>
        <small>{task.repeat && `Powtarzaj: ${task.repeat.replace('every-', 'co ').replace('-days', ' dni').replace('-weeks', ' tygodnie').replace('-months', ' miesiące')}`} {task.dependency && `· Po: ${taskById.get(task.dependency)?.text ?? 'zadaniu'}`}</small>
        <div className="task-time-summary"><span><Clock3 size={12} />{task.estimateMinutes ? `Plan ${duration(task.estimateMinutes * 60)}` : 'Bez szacunku'}</span><span><Timer size={12} />Rzeczywisty {duration(runningSeconds)}</span>{task.estimateMinutes > 0 && task.done && <b className={runningSeconds <= task.estimateMinutes * 60 ? 'under-estimate' : 'over-estimate'}>{runningSeconds <= task.estimateMinutes * 60 ? 'W ramach planu' : `+${duration(runningSeconds - task.estimateMinutes * 60)}`}</b>}</div>
        <details className="task-extra"><summary>Szczegóły, przypomnienie i powiązania</summary><div className="task-extra-grid">
          <label>Powtarzanie<select aria-label={`Powtarzanie: ${task.text}`} value={task.repeat} onChange={event => onUpdate(task, { repeat: event.target.value as TaskRepeat })}><option value="">Bez powtarzania</option><option value="daily">Codziennie</option><option value="weekdays">W dni robocze</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option><option value="every-2-weeks">Co 2 tygodnie</option><option value="every-2-months">Co 2 miesiące</option></select></label>
          <label>Przypomnienie<input type="datetime-local" value={task.remindAt} onChange={event => onUpdate(task, { remindAt: event.target.value, snoozedUntil: '' })} /></label>
          <label>Zależność<select value={task.dependency} onChange={event => onUpdate(task, { dependency: event.target.value })}><option value="">Bez zależności</option>{blockers.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select></label>
          <label>Szacowany czas (min)<input type="number" min="0" value={task.estimateMinutes || ''} onChange={event => onUpdate(task, { estimateMinutes: Number(event.target.value) || 0 })} /></label>
          <label className="task-milestone-toggle"><input type="checkbox" checked={task.milestone} onChange={event => onUpdate(task, { milestone: event.target.checked })} />Kamień milowy</label>
          <label>Powiązane notatki<select multiple size={Math.min(4, Math.max(2, notes.length))} value={task.relatedNoteIds} onChange={event => onUpdate(task, { relatedNoteIds: selectedValues(event) })}>{notes.filter(item => item.id !== task.noteId).map(item => <option key={item.id} value={item.id}>{item.title || 'Bez tytułu'}</option>)}</select></label>
          <label>Załączniki<select multiple size={Math.min(4, Math.max(2, attachments.length))} value={task.attachmentIds} onChange={event => onUpdate(task, { attachmentIds: selectedValues(event) })}>{attachments.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label>
          <div className="task-associated-links">{linkedNotes.map(item => <button key={item.id} type="button" onClick={() => onOpenNote(item.id)}><FileText size={12} />{item.title || 'Bez tytułu'}</button>)}{linkedAttachments.map(item => <button key={item.id} type="button" onClick={() => onOpenAttachment(item)}><Paperclip size={12} />{item.fileName}</button>)}</div>
          {task.remindAt && <div className="task-snooze"><span><Bell size={12} />Odłóż przypomnienie</span><button type="button" onClick={() => snooze(task, 10)}>10 min</button><button type="button" onClick={() => snooze(task, 60)}>1 godz.</button><button type="button" onClick={() => snooze(task, 1440)}>Jutro</button>{task.snoozedUntil && <small>Do {task.snoozedUntil.replace('T', ' ')}</small>}</div>}
        </div></details>
      </div>
      <input type="date" aria-label={`Termin: ${task.text}`} value={task.dueDate} onChange={event => onUpdate(task, { dueDate: event.target.value })} />
      <select aria-label={`Status: ${task.text}`} value={task.status} onChange={event => onUpdate(task, { status: event.target.value as TaskStatus })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label={`Priorytet: ${task.text}`} value={task.priority} onChange={event => onUpdate(task, { priority: event.target.value })}>{priorityOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
      <button type="button" className={`task-timer-button ${task.timerStartedAt ? 'running' : ''}`} disabled={!task.timerStartedAt && Boolean(dependencyBlocker && !dependencyBlocker.done)} title={task.timerStartedAt ? 'Zatrzymaj pomiar' : dependencyBlocker && !dependencyBlocker.done ? `Najpierw ukończ: ${dependencyBlocker.text}` : 'Rozpocznij pomiar'} aria-label={task.timerStartedAt ? `Zatrzymaj pomiar czasu: ${task.text}` : `Rozpocznij pomiar czasu: ${task.text}`} onClick={() => stopTimer(task)}><Play size={14} /></button>
    </article>
  }

  const grouped = view === 'kanban' ? (['todo', 'doing', 'done'] as TaskStatus[]).map(status => ({ title: statusLabels[status], tasks: visibleTasks.filter(task => task.status === status) }))
    : view === 'timeline' ? [...new Set(visibleTasks.map(task => task.dueDate || 'Bez terminu'))].sort().map(day => ({ title: day, tasks: visibleTasks.filter(task => (task.dueDate || 'Bez terminu') === day) })) : []
  const calendarStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7))
  const calendarDays = Array.from({ length: 42 }, (_, index) => { const day = new Date(calendarStart); day.setDate(day.getDate() + index); return day })
  const monthTitle = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(calendarMonth)
  const calendarEvents = (day: string) => visibleTasks.flatMap(task => [
    ...(task.dueDate === day ? [{ task, kind: 'Termin' as const }] : []),
    ...(task.remindAt.slice(0, 10) === day ? [{ task, kind: 'Przypomnienie' as const }] : []),
  ])

  return <section className={`workspace-tool-page task-manager-page task-view-${view}`} aria-labelledby="task-manager-title">
    <header className="workspace-tool-heading"><span className="workspace-tool-mark"><CheckSquare2 size={21} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="task-manager-title">Zadania</h1><p>{tasks.filter(task => !task.done).length} otwartych · {tasks.filter(task => task.done).length} ukończonych</p></div><button type="button" className="icon-button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
    <div className="workspace-tool-content task-manager-content">
      <form className="task-create-form task-create-advanced" onSubmit={submit}>
        <input aria-label="Nazwa nowego zadania" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Dodaj zadanie…" />
        <select aria-label="Notatka dla nowego zadania" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title || 'Bez tytułu'}</option>)}</select>
        <input type="date" aria-label="Termin zadania" value={dueDate} onChange={event => setDueDate(event.target.value)} />
        <button type="submit" className="button primary" disabled={!draft.trim() || !notes.length}><Plus size={15} />Dodaj</button>
        <details className="task-create-options"><summary>Opcje zadania <span>powtarzanie · czas · powiązania</span></summary><div className="task-create-options-grid">
          <label>Priorytet<select value={priority} onChange={event => setPriority(event.target.value)}>{priorityOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Powtarzanie<select aria-label="Powtarzanie" value={repeat} onChange={event => setRepeat(event.target.value as TaskRepeat | 'custom')}><option value="">Bez powtarzania</option><option value="daily">Codziennie</option><option value="weekdays">W dni robocze</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option><option value="custom">Własny odstęp…</option></select></label>
          {repeat === 'custom' && <div className="task-custom-repeat"><input aria-label="Odstęp powtarzania" type="number" min="1" max="999" value={repeatCount} onChange={event => setRepeatCount(Math.max(1, Number(event.target.value) || 1))} /><select aria-label="Jednostka odstępu" value={repeatUnit} onChange={event => setRepeatUnit(event.target.value as typeof repeatUnit)}><option value="days">dni</option><option value="weeks">tygodnie</option><option value="months">miesiące</option></select></div>}
          <label>Przypomnienie<input type="datetime-local" aria-label="Przypomnienie" value={remindAt} onChange={event => setRemindAt(event.target.value)} /></label>
          <label>Zależność<select aria-label="Zależność od zadania" value={dependency} onChange={event => setDependency(event.target.value)}><option value="">Bez zależności</option>{tasks.filter(task => !task.done).map(task => <option key={task.id} value={task.id}>{task.text}</option>)}</select></label>
          <label>Szacowany czas (min)<input type="number" min="0" value={estimateMinutes || ''} onChange={event => setEstimateMinutes(Number(event.target.value) || 0)} /></label>
          <label className="task-milestone-toggle"><input type="checkbox" checked={milestone} onChange={event => setMilestone(event.target.checked)} />Kamień milowy</label>
          <label>Powiązane notatki<select multiple size={Math.min(4, Math.max(2, notes.length))} value={relatedNoteIds} onChange={event => setRelatedNoteIds(selectedValues(event))}>{notes.filter(item => item.id !== noteId).map(item => <option key={item.id} value={item.id}>{item.title || 'Bez tytułu'}</option>)}</select></label>
          <label>Załączniki<select multiple size={Math.min(4, Math.max(2, attachments.length))} value={attachmentIds} onChange={event => setAttachmentIds(selectedValues(event))}>{attachments.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label>
          <p className="task-multi-hint">Przytrzymaj Ctrl (lub ⌘), aby wybrać kilka pozycji.</p>
        </div></details>
      </form>
      <div className="task-toolbar"><div className="task-view-switch" role="group" aria-label="Widok zadań">{(['list', 'kanban', 'calendar', 'timeline', 'week', 'templates'] as TaskView[]).map(mode => <button key={mode} type="button" className={view === mode ? 'active' : ''} onClick={() => setView(mode)}>{mode === 'list' ? 'Lista' : mode === 'kanban' ? 'Kanban' : mode === 'calendar' ? 'Kalendarz' : mode === 'timeline' ? 'Oś czasu' : mode === 'week' ? 'Tydzień' : 'Szablony'}</button>)}</div><label className="task-show-completed"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />Pokaż ukończone</label><button type="button" className="button secondary" onClick={() => { if ('Notification' in window) void Notification.requestPermission() }}><Bell size={14} />Włącz przypomnienia</button></div>
      {view === 'list' && <div className="task-list" aria-label="Lista zadań">{visibleTasks.map(renderTask)}</div>}
      {view === 'kanban' && <div className="task-board task-board-kanban">{grouped.map(group => <section key={group.title}><h3>{group.title}<span>{group.tasks.length}</span></h3>{group.tasks.map(renderTask)}</section>)}</div>}
      {view === 'timeline' && <div className="task-board task-board-timeline">{grouped.map(group => <section key={group.title}><h3>{group.title}<span>{group.tasks.length}</span></h3>{group.tasks.map(renderTask)}</section>)}</div>}
      {view === 'calendar' && <section className="task-calendar"><header><button type="button" className="icon-button" aria-label="Poprzedni miesiąc" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><h2><CalendarDays size={16} />{monthTitle}</h2><button type="button" className="icon-button" aria-label="Następny miesiąc" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}><ChevronRight size={16} /></button><button type="button" className="button secondary" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Dziś</button></header><div className="task-calendar-grid">{['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'].map(day => <strong className="task-calendar-weekday" key={day}>{day}</strong>)}{calendarDays.map(day => { const key = dateString(day); const events = calendarEvents(key); return <div key={key} className={`task-calendar-day ${day.getMonth() !== calendarMonth.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''}`}><span>{day.getDate()}</span>{events.slice(0, 3).map(({ task, kind }) => <button key={`${task.id}-${kind}`} type="button" className={`task-calendar-event ${task.milestone ? 'milestone' : ''}`} title={`${task.text} · ${kind.toLocaleLowerCase('pl')}`} onClick={() => onOpenNote(task.noteId)}>{kind === 'Termin' ? '◆ ' : '◷ '}{task.text}</button>)}{events.length > 3 && <small>+{events.length - 3} więcej</small>}</div> })}</div><footer><span>◆ Termin</span><span>◷ Przypomnienie</span></footer></section>}
      {view === 'week' && <div className="task-week-summary"><div className="task-week-columns"><section><h3>Ukończone w ostatnich 7 dniach <span>{completedThisWeek.length}</span></h3>{completedThisWeek.map(renderTask)}{!completedThisWeek.length && <p>Brak ukończonych zadań w tym tygodniu.</p>}</section><section className="overdue-summary"><h3>Zaległe <span>{overdueTasks.length}</span></h3>{overdueTasks.map(renderTask)}{!overdueTasks.length && <p>Nie ma zaległych zadań.</p>}</section><section><h3>Termin w ciągu 7 dni <span>{dueThisWeek.length}</span></h3>{dueThisWeek.map(renderTask)}{!dueThisWeek.length && <p>Brak zadań z bliskim terminem.</p>}</section></div></div>}
      {view === 'templates' && <div className="task-templates-view"><section className="task-template-panel"><h2><BookmarkPlus size={16} />Szablony zadań</h2><div className="task-template-list">{taskTemplates.map(template => <article key={template.id}><div><strong>{template.name}</strong><small>{template.title} · {priorityOptions.find(item => item.id === template.priority)?.name ?? template.priority}</small></div><button type="button" className="button secondary" onClick={() => { applyTaskTemplate(template.id); setView('list') }}>Użyj</button><button type="button" className="icon-button" aria-label={`Usuń szablon ${template.name}`} onClick={() => setTaskTemplates(current => current.filter(item => item.id !== template.id))}><Trash2 size={14} /></button></article>)}{!taskTemplates.length && <p>Zapisz bieżące ustawienia zadania, aby szybko używać ich ponownie.</p>}</div><button type="button" className="button secondary" disabled={!draft.trim()} onClick={saveTaskTemplate}><BookmarkPlus size={14} />Zapisz bieżące jako szablon</button></section><section className="task-template-panel"><h2><CheckSquare2 size={16} />Szablony projektów</h2><p>Każdy wiersz tworzy zadanie; dodaj prefiks <code>[m]</code>, aby oznaczyć kamień milowy.</p><form onSubmit={saveProjectTemplate}><input aria-label="Nazwa szablonu projektu" value={projectTemplateName} onChange={event => setProjectTemplateName(event.target.value)} placeholder="Nazwa szablonu" /><textarea aria-label="Zadania szablonu projektu" value={projectTemplateText} onChange={event => setProjectTemplateText(event.target.value)} placeholder={'[m] Ustalenie zakresu\nPrzygotowanie materiałów\nTest końcowy'} rows={5} /><button type="submit" className="button primary" disabled={!projectTemplateName.trim() || !projectTemplateText.trim()}><Plus size={14} />Zapisz szablon projektu</button></form><div className="task-template-list">{projectTemplates.map(template => <article key={template.id}><div><strong>{template.name}</strong><small>{template.tasks.length} zadań · {template.tasks.filter(item => item.milestone).length} kamieni milowych</small></div><button type="button" className="button secondary" onClick={() => applyProjectTemplate(template)}>Dodaj do notatki</button><button type="button" className="icon-button" aria-label={`Usuń szablon ${template.name}`} onClick={() => setProjectTemplates(current => current.filter(item => item.id !== template.id))}><Trash2 size={14} /></button></article>)}</div></section><section className="task-template-panel task-priority-panel"><h2>Własne priorytety</h2><div className="task-priority-settings">{priorityOptions.map(option => <label key={option.id}><input aria-label={`Nazwa priorytetu ${option.name}`} value={option.name} onChange={event => updatePriority(option, { name: event.target.value })} /><input aria-label={`Kolor priorytetu ${option.name}`} type="color" value={option.color} onChange={event => updatePriority(option, { color: event.target.value })} /><span>{tasks.filter(task => task.priority === option.id).length} zadań</span>{!['high', 'normal', 'low'].includes(option.id) && <button type="button" className="icon-button" aria-label={`Usuń priorytet ${option.name}`} title={tasks.some(task => task.priority === option.id) ? 'Najpierw zmień priorytet przypisanych zadań' : 'Usuń priorytet'} disabled={tasks.some(task => task.priority === option.id)} onClick={() => deletePriority(option)}><Trash2 size={14} /></button>}</label>)}</div><form className="task-add-priority" onSubmit={addPriority}><input aria-label="Nazwa nowego priorytetu" value={priorityName} onChange={event => setPriorityName(event.target.value)} placeholder="Nazwa priorytetu" /><input aria-label="Kolor nowego priorytetu" type="color" value={priorityColor} onChange={event => setPriorityColor(event.target.value)} /><button type="submit" className="button secondary" disabled={!priorityName.trim()}><Plus size={14} />Dodaj priorytet</button></form></section></div>}
      {!visibleTasks.length && view !== 'templates' && view !== 'calendar' && view !== 'week' && <div className="task-empty"><CheckSquare2 size={23} /><strong>{showCompleted ? 'Brak zadań' : 'Wszystkie zadania wykonane'}</strong><span>Dodaj zadanie powyżej albo użyj listy zadań w Markdown.</span></div>}
      <footer className="task-page-footer">Terminy, priorytety, cykliczność, czas pracy, zależności i powiązania zapisują się przy zadaniu w metadanych Markdown.</footer>
    </div>
  </section>
}
