import { useMemo } from 'react'
import { BarChart3, CheckSquare2, FileText, Folder, X } from 'lucide-react'
import type { Note } from './types'
import type { ParsedTask } from './knowledge'

export function ProjectDashboardDialog({ notes, tasks, onOpenNote, onClose }: { notes: Note[]; tasks: ParsedTask[]; onOpenNote: (noteId: string) => void; onClose: () => void }) {
  const projects = useMemo(() => {
    const groups = new Map<string, Note[]>()
    for (const note of notes) { const key = note.folder.split('/')[0] || 'Bez folderu'; groups.set(key, [...(groups.get(key) ?? []), note]) }
    return [...groups].map(([name, items]) => { const ids = new Set(items.map(note => note.id)); const projectTasks = tasks.filter(task => ids.has(task.noteId)); return { name, items: items.sort((a, b) => b.updatedAt - a.updatedAt), openTasks: projectTasks.filter(task => !task.done).length, overdue: projectTasks.filter(task => !task.done && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10)).length } }).sort((a, b) => b.items.length - a.items.length)
  }, [notes, tasks])
  return <div className="modal-backdrop project-dashboard-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="project-dashboard-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dashboard-title"><header><span className="folder-dialog-mark"><BarChart3 size={19} /></span><div><h2 id="project-dashboard-title">Pulpit projektów</h2><p>{projects.length} grup według folderów · {tasks.filter(task => !task.done).length} otwartych zadań</p></div><button type="button" className="icon-button" aria-label="Zamknij pulpit" onClick={onClose}><X size={17} /></button></header><div className="project-dashboard-grid">{projects.map(project => <article className="project-dashboard-card" key={project.name}><h3><Folder size={15} />{project.name}</h3><div className="project-dashboard-metrics"><span><FileText size={14} />{project.items.length} notatek</span><span><CheckSquare2 size={14} />{project.openTasks} zadań</span>{project.overdue > 0 && <strong>{project.overdue} po terminie</strong>}</div><div className="project-dashboard-recent">{project.items.slice(0, 4).map(note => <button type="button" key={note.id} onClick={() => onOpenNote(note.id)}><span>{note.title || 'Bez tytułu'}</span><small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(note.updatedAt)}</small></button>)}</div></article>)}{!projects.length && <p>Utwórz foldery, aby grupować projekty.</p>}</div></section></div>
}
