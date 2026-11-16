import { useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, CalendarDays, CheckSquare2, FileText, Flag, Folder, Milestone } from 'lucide-react'
import type { Note } from './types'
import type { ParsedTask } from './knowledge'

type Project = { name: string; items: Note[]; tasks: ParsedTask[]; openTasks: number; overdue: number; milestones: number }
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export function ProjectDashboardPage({ notes, tasks, onOpenNote, onClose }: { notes: Note[]; tasks: ParsedTask[]; onOpenNote: (noteId: string) => void; onClose: () => void }) {
  const [view, setView] = useState<'projects' | 'timeline'>('projects')
  const projects = useMemo<Project[]>(() => {
    const groups = new Map<string, Note[]>()
    for (const note of notes) { const key = note.folder.split('/')[0] || 'Bez folderu'; groups.set(key, [...(groups.get(key) ?? []), note]) }
    return [...groups].map(([name, items]) => {
      const ids = new Set(items.map(note => note.id))
      const projectTasks = tasks.filter(task => ids.has(task.noteId)).sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'))
      return { name, items: items.sort((a, b) => b.updatedAt - a.updatedAt), tasks: projectTasks, openTasks: projectTasks.filter(task => !task.done).length, overdue: projectTasks.filter(task => !task.done && task.dueDate && task.dueDate < today()).length, milestones: projectTasks.filter(task => task.milestone).length }
    }).sort((a, b) => b.items.length - a.items.length)
  }, [notes, tasks])
  const openTaskCount = tasks.filter(task => !task.done).length
  return <section className="workspace-tool-page project-dashboard-page" aria-labelledby="project-dashboard-title">
    <header className="workspace-tool-heading"><span className="workspace-tool-mark"><BarChart3 size={21} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="project-dashboard-title">Pulpit projektów</h1><p>{projects.length} grup według folderów · {openTaskCount} otwartych zadań · {tasks.filter(task => task.milestone).length} kamieni milowych</p></div><button type="button" className="icon-button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
    <div className="workspace-tool-content project-dashboard-content">
      <div className="project-dashboard-toolbar" role="group" aria-label="Widok pulpitu projektów"><button type="button" className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}><Folder size={14} />Projekty</button><button type="button" className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}><CalendarDays size={14} />Oś czasu</button></div>
      {view === 'projects' ? <div className="project-dashboard-grid">{projects.map(project => <article className="project-dashboard-card" key={project.name}><h3><Folder size={15} />{project.name}</h3><div className="project-dashboard-metrics"><span><FileText size={14} />{project.items.length} notatek</span><span><CheckSquare2 size={14} />{project.openTasks} zadań</span><span><Milestone size={14} />{project.milestones} kamieni milowych</span>{project.overdue > 0 && <strong>{project.overdue} po terminie</strong>}</div><div className="project-dashboard-recent">{project.items.slice(0, 4).map(note => <button type="button" key={note.id} onClick={() => onOpenNote(note.id)}><span>{note.title || 'Bez tytułu'}</span><small>{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(note.updatedAt)}</small></button>)}</div></article>)}{!projects.length && <div className="workspace-tool-empty"><Folder size={22} /><strong>Nie ma jeszcze grup projektów</strong><span>Utwórz foldery, aby pogrupować notatki w projekty.</span></div>}</div>
        : <div className="project-timeline-list">{projects.map(project => <section className="project-timeline-project" key={project.name}><h2><Folder size={15} />{project.name}<span>{project.tasks.length}</span></h2>{project.tasks.length ? project.tasks.map(task => <article key={task.id} className={`project-timeline-item ${task.milestone ? 'milestone' : ''} ${!task.done && task.dueDate && task.dueDate < today() ? 'overdue' : ''}`}><i aria-hidden="true" /><div><strong>{task.milestone && <Flag size={13} />} {task.text}</strong><small>{task.dueDate ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(`${task.dueDate}T12:00:00`)) : 'Bez terminu'} · {task.done ? 'Ukończone' : task.status === 'doing' ? 'W toku' : 'Do zrobienia'}</small></div><button type="button" onClick={() => onOpenNote(task.noteId)}>{task.noteTitle || 'Otwórz notatkę'} ↗</button></article>) : <p>Ten projekt nie ma jeszcze zadań ani terminów.</p>}</section>)}{!projects.length && <div className="workspace-tool-empty"><CalendarDays size={22} /><strong>Brak danych osi czasu</strong><span>Dodaj zadania z terminami i oznacz kluczowe etapy jako kamienie milowe.</span></div>}</div>}
    </div>
  </section>
}
