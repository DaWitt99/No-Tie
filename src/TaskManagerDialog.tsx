import { useMemo, useState, type FormEvent } from 'react'
import { CheckSquare2, Plus, X } from 'lucide-react'
import type { Note } from './types'
import type { ParsedTask } from './knowledge'

type TaskPriority = ParsedTask['priority']
const priorityRank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

export function TaskManagerDialog({ notes, tasks, onUpdate, onOpenNote, onCreate, onClose }: {
  notes: Note[]
  tasks: ParsedTask[]
  onUpdate: (task: ParsedTask, patch: Partial<Pick<ParsedTask, 'done' | 'dueDate' | 'priority'>>) => void
  onOpenNote: (noteId: string) => void
  onCreate: (noteId: string, title: string, dueDate: string, priority: TaskPriority) => void
  onClose: () => void
}) {
  const [showCompleted, setShowCompleted] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [draft, setDraft] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const visibleTasks = useMemo(() => tasks.filter(task => showCompleted || !task.done).sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || priorityRank[a.priority] - priorityRank[b.priority]), [showCompleted, tasks])
  const [today] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!noteId || !draft.trim()) return
    onCreate(noteId, draft.trim(), dueDate, priority)
    setDraft(''); setDueDate(''); setPriority('normal')
  }
  return <div className="modal-backdrop task-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="task-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="task-manager-title">
      <header><span className="folder-dialog-mark"><CheckSquare2 size={19} /></span><div><h2 id="task-manager-title">Zadania</h2><p>{tasks.filter(task => !task.done).length} otwartych · {tasks.filter(task => task.done).length} ukończonych</p></div><button type="button" className="icon-button" aria-label="Zamknij zadania" onClick={onClose}><X size={17} /></button></header>
      <form className="task-create-form" onSubmit={submit}><input aria-label="Nazwa nowego zadania" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Dodaj zadanie…" /><select aria-label="Notatka dla nowego zadania" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title || 'Bez tytułu'}</option>)}</select><input type="date" aria-label="Termin zadania" value={dueDate} onChange={event => setDueDate(event.target.value)} /><select aria-label="Priorytet nowego zadania" value={priority} onChange={event => setPriority(event.target.value as TaskPriority)}><option value="high">Wysoki</option><option value="normal">Zwykły</option><option value="low">Niski</option></select><button type="submit" className="button primary" disabled={!draft.trim() || !notes.length}><Plus size={15} />Dodaj</button></form>
      <label className="task-show-completed"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />Pokaż ukończone</label>
      <div className="task-list" aria-label="Lista zadań">
        {visibleTasks.map(task => <article key={task.id} className={`task-row ${task.done ? 'done' : ''} ${task.dueDate && task.dueDate < today && !task.done ? 'overdue' : ''}`}>
          <input type="checkbox" aria-label={`${task.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}: ${task.text}`} checked={task.done} onChange={event => onUpdate(task, { done: event.target.checked })} />
          <div className="task-main"><strong>{task.text}</strong><button type="button" onClick={() => onOpenNote(task.noteId)}>{task.noteTitle || 'Bez tytułu'} ↗</button></div>
          <input type="date" aria-label={`Termin: ${task.text}`} value={task.dueDate} onChange={event => onUpdate(task, { dueDate: event.target.value })} />
          <select aria-label={`Priorytet: ${task.text}`} value={task.priority} onChange={event => onUpdate(task, { priority: event.target.value as TaskPriority })}><option value="high">Wysoki</option><option value="normal">Zwykły</option><option value="low">Niski</option></select>
        </article>)}
        {!visibleTasks.length && <div className="task-empty"><CheckSquare2 size={23} /><strong>{showCompleted ? 'Brak zadań' : 'Wszystkie zadania wykonane'}</strong><span>Dodaj zadanie powyżej albo użyj listy zadań w Markdown.</span></div>}
      </div>
      <footer>Zadania są listami kontrolnymi Markdown. Termin i priorytet zapisują się jako metadane w wierszu zadania.</footer>
    </section>
  </div>
}
