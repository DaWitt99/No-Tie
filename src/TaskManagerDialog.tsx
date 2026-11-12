import { useMemo, useState, type FormEvent } from 'react'
import { Bell, CheckSquare2, Plus, X } from 'lucide-react'
import type { Note } from './types'
import type { ParsedTask, TaskPatch, TaskRepeat, TaskStatus } from './knowledge'

type TaskPriority = ParsedTask['priority']
const priorityRank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }
const statusLabels: Record<TaskStatus, string> = { todo: 'Do zrobienia', doing: 'W toku', done: 'Zrobione' }

export function TaskManagerDialog({ notes, tasks, onUpdate, onOpenNote, onCreate, onClose }: {
  notes: Note[]; tasks: ParsedTask[]; onUpdate: (task: ParsedTask, patch: TaskPatch) => void; onOpenNote: (noteId: string) => void
  onCreate: (noteId: string, title: string, dueDate: string, priority: TaskPriority, repeat?: TaskRepeat, remindAt?: string, dependency?: string) => void; onClose: () => void
}) {
  const [view, setView] = useState<'list' | 'kanban' | 'timeline'>('list')
  const [showCompleted, setShowCompleted] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [repeat, setRepeat] = useState<TaskRepeat>('')
  const [remindAt, setRemindAt] = useState('')
  const [dependency, setDependency] = useState('')
  const [today] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`)
  const visibleTasks = useMemo(() => tasks.filter(task => showCompleted || !task.done).sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || priorityRank[a.priority] - priorityRank[b.priority]), [showCompleted, tasks])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!noteId || !draft.trim()) return
    onCreate(noteId, draft.trim(), dueDate, priority, repeat, remindAt, dependency)
    setDraft(''); setDueDate(''); setPriority('normal'); setRepeat(''); setRemindAt(''); setDependency('')
  }
  const renderTask = (task: ParsedTask) => <article key={task.id} className={`task-row ${task.done ? 'done' : ''} ${task.dueDate && task.dueDate < today && !task.done ? 'overdue' : ''}`}>
    <input type="checkbox" aria-label={`${task.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}: ${task.text}`} checked={task.done} onChange={event => onUpdate(task, { done: event.target.checked })} />
    <div className="task-main"><strong>{task.text}</strong><button type="button" onClick={() => onOpenNote(task.noteId)}>{task.noteTitle || 'Bez tytułu'} ↗</button><small>{task.repeat && `Powtarzaj: ${task.repeat}`} {task.dependency && `· Zależność: ${tasks.find(item => item.id === task.dependency)?.text ?? 'zadanie'}`}</small><details className="task-extra"><summary>Przypomnienie i zależności</summary><select aria-label={`Powtarzanie: ${task.text}`} value={task.repeat} onChange={event => onUpdate(task, { repeat: event.target.value as TaskRepeat })}><option value="">Bez powtarzania</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select><input type="datetime-local" aria-label={`Przypomnienie: ${task.text}`} value={task.remindAt} onChange={event => onUpdate(task, { remindAt: event.target.value })} /><select aria-label={`Zależność: ${task.text}`} value={task.dependency} onChange={event => onUpdate(task, { dependency: event.target.value })}><option value="">Bez zależności</option>{tasks.filter(item => item.id !== task.id).map(item => <option key={item.id} value={item.id}>{item.text}</option>)}</select></details></div>
    <input type="date" aria-label={`Termin: ${task.text}`} value={task.dueDate} onChange={event => onUpdate(task, { dueDate: event.target.value })} />
    <select aria-label={`Status: ${task.text}`} value={task.status} onChange={event => onUpdate(task, { status: event.target.value as TaskStatus })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    <select aria-label={`Priorytet: ${task.text}`} value={task.priority} onChange={event => onUpdate(task, { priority: event.target.value as TaskPriority })}><option value="high">Wysoki</option><option value="normal">Zwykły</option><option value="low">Niski</option></select>
  </article>
  const grouped = view === 'kanban' ? (['todo', 'doing', 'done'] as TaskStatus[]).map(status => ({ title: statusLabels[status], tasks: visibleTasks.filter(task => task.status === status) }))
    : view === 'timeline' ? [...new Set(visibleTasks.map(task => task.dueDate || 'Bez terminu'))].sort().map(day => ({ title: day, tasks: visibleTasks.filter(task => (task.dueDate || 'Bez terminu') === day) })) : []
  return <div className="modal-backdrop task-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`task-manager-dialog task-view-${view}`} role="dialog" aria-modal="true" aria-labelledby="task-manager-title">
      <header><span className="folder-dialog-mark"><CheckSquare2 size={19} /></span><div><h2 id="task-manager-title">Zadania</h2><p>{tasks.filter(task => !task.done).length} otwartych · {tasks.filter(task => task.done).length} ukończonych</p></div><button type="button" className="icon-button" aria-label="Zamknij zadania" onClick={onClose}><X size={17} /></button></header>
      <form className="task-create-form task-create-advanced" onSubmit={submit}><input aria-label="Nazwa nowego zadania" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Dodaj zadanie…" /><select aria-label="Notatka dla nowego zadania" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title || 'Bez tytułu'}</option>)}</select><input type="date" aria-label="Termin zadania" value={dueDate} onChange={event => setDueDate(event.target.value)} /><select aria-label="Powtarzanie" value={repeat} onChange={event => setRepeat(event.target.value as TaskRepeat)}><option value="">Bez powtarzania</option><option value="daily">Codziennie</option><option value="weekly">Co tydzień</option><option value="monthly">Co miesiąc</option></select><input type="datetime-local" aria-label="Przypomnienie" value={remindAt} onChange={event => setRemindAt(event.target.value)} /><select aria-label="Zależność od zadania" value={dependency} onChange={event => setDependency(event.target.value)}><option value="">Bez zależności</option>{tasks.filter(task => !task.done).map(task => <option key={task.id} value={task.id}>{task.text}</option>)}</select><select aria-label="Priorytet nowego zadania" value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}><option value="high">Wysoki</option><option value="normal">Zwykły</option><option value="low">Niski</option></select><button type="submit" className="button primary" disabled={!draft.trim() || !notes.length}><Plus size={15} />Dodaj</button></form>
      <div className="task-toolbar"><div className="task-view-switch" role="group" aria-label="Widok zadań">{(['list', 'kanban', 'timeline'] as const).map(mode => <button key={mode} type="button" className={view === mode ? 'active' : ''} onClick={() => setView(mode)}>{mode === 'list' ? 'Lista' : mode === 'kanban' ? 'Kanban' : 'Oś czasu'}</button>)}</div><label className="task-show-completed"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />Pokaż ukończone</label><button type="button" className="button secondary" onClick={() => { if (!('Notification' in window)) return; void Notification.requestPermission() }}><Bell size={14} />Włącz przypomnienia</button></div>
      {view === 'list' ? <div className="task-list" aria-label="Lista zadań">{visibleTasks.map(renderTask)}</div> : <div className={`task-board task-board-${view}`}>{grouped.map(group => <section key={group.title}><h3>{group.title}<span>{group.tasks.length}</span></h3>{group.tasks.map(renderTask)}</section>)}</div>}
      {!visibleTasks.length && <div className="task-empty"><CheckSquare2 size={23} /><strong>{showCompleted ? 'Brak zadań' : 'Wszystkie zadania wykonane'}</strong><span>Dodaj zadanie powyżej albo użyj listy zadań w Markdown.</span></div>}
      <footer>Zmiany pozostają w składni checklisty Markdown. Terminy, statusy, cykliczność i zależności zapisują się w komentarzu metadanych.</footer>
    </section>
  </div>
}
