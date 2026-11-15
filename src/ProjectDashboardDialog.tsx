import { useMemo } from 'react'
import { ArrowLeft, BarChart3, CheckSquare2, FileText, Folder } from 'lucide-react'
import type { Note } from './types'
import type { ParsedTask } from './knowledge'

export function ProjectDashboardPage({ notes, tasks, onOpenNote, onClose }: { notes: Note[]; tasks: ParsedTask[]; onOpenNote: (noteId: string) => void; onClose: () => void }) {
  const projects = useMemo(() => {
    const groups = new Map<string, Note[]>()
    for (const note of notes) { const key = note.folder.split('/')[0] || 'Bez folderu'; groups.set(key, [...(groups.get(key) ?? []), note]) }
    return [...groups].map(([name, items]) => { const ids = new Set(items.map(note => note.id)); const projectTasks = tasks.filter(task => ids.has(task.noteId)); return { name, items: items.sort((a, b) => b.updatedAt - a.updatedAt), openTasks: projectTasks.filter(task => !task.done).length, overdue: projectTasks.filter(task => !task.done && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10)).length } }).sort((a, b) => b.items.length - a.items.length)
  }, [notes, tasks])
  return <section className="workspace-tool-page project-dashboard-page" aria-labelledby="project-dashboard-title">
    <header className="workspace-tool-heading"><span className="workspace-tool-mark"><BarChart3 size={21} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="project-dashboard-title">Pulpit projektów</h1><p>{projects.length} grup według folderów · {tasks.filter(task => !task.done).length} otwartych zadań</p></div><button type="button" className="icon-button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
    <div className="workspace-tool-content project-dashboard-content"><div className="project-dashboard-grid">{projects.map(project => <article className="project-dashboard-card" key={project.name}><h3><Folder size={15} />{project.name}</h3><div className="project-dashboard-metrics"><span><FileText size={14} />{project.items.length} notatek</span><span><CheckSquare2 size={14} />{project.openTasks} zadań</span>{project.overdue > 0 && <strong>{project.overdue} po terminie</strong>}</div><div className="project-dashboard-recent">{project.items.slice(0, 4).map(note => <button type="button" key={note.id} onClick={() => onOpenNote(note.id)}><span>{note.title || 'Bez tytułu'}</span><small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(note.updatedAt)}</small></button>)}</div></article>)}{!projects.length && <div className="workspace-tool-empty"><Folder size={22} /><strong>Nie ma jeszcze grup projektów</strong><span>Utwórz foldery, aby pogrupować notatki w projekty.</span></div>}</div></div>
  </section>
}
