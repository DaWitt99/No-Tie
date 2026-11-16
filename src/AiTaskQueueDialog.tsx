import { ArrowDown, ArrowUp, Ban, Check, Clock3, LoaderCircle, X } from 'lucide-react'

export type AiTaskQueueItem = {
  id: string
  label: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export function AiTaskQueueDialog({ tasks, onMove, onCancel, onClose }: {
  tasks: AiTaskQueueItem[]
  onMove: (id: string, direction: -1 | 1) => void
  onCancel: (id: string) => void
  onClose: () => void
}) {
  const ordered = [...tasks.filter(task => task.status === 'running'), ...tasks.filter(task => task.status === 'queued'), ...tasks.filter(task => !['running', 'queued'].includes(task.status)).reverse()]
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ai-task-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-task-queue-title">
      <header><span className="folder-dialog-mark"><Clock3 size={18} /></span><div><h2 id="ai-task-queue-title">Kolejka zadań AI</h2><p>Zadania uruchamiają się po kolei. Możesz zmienić kolejność oczekujących albo anulować pracę.</p></div><button className="icon-button" type="button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header>
      <div className="ai-task-queue-list">{ordered.map((task, index) => <article key={task.id} className={`ai-task-queue-item ${task.status}`}>
        <span className="ai-task-queue-status">{task.status === 'running' ? <LoaderCircle className="spin" size={15} /> : task.status === 'completed' ? <Check size={15} /> : task.status === 'cancelled' ? <Ban size={14} /> : <Clock3 size={14} />}</span>
        <div><strong>{task.label}</strong><small>{task.status === 'queued' ? 'Oczekuje' : task.status === 'running' ? 'W toku' : task.status === 'completed' ? 'Zakończono' : task.status === 'cancelled' ? 'Anulowano' : 'Błąd'}{task.startedAt ? ` · ${Math.max(0, Math.round(((task.finishedAt ?? Date.now()) - task.startedAt) / 1000))} s` : ''}</small>{task.error && <p>{task.error}</p>}</div>
        {task.status === 'queued' && <div className="ai-task-queue-controls"><button type="button" className="icon-button" aria-label="Przesuń wyżej" title="Przesuń wyżej" disabled={ordered.slice(0, index).some(item => item.status === 'queued') === false} onClick={() => onMove(task.id, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button" aria-label="Przesuń niżej" title="Przesuń niżej" disabled={!ordered.slice(index + 1).some(item => item.status === 'queued')} onClick={() => onMove(task.id, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-button danger-icon" aria-label="Anuluj zadanie" title="Anuluj zadanie" onClick={() => onCancel(task.id)}><X size={14} /></button></div>}
        {task.status === 'running' && <button type="button" className="button secondary" onClick={() => onCancel(task.id)}><Ban size={13} />Anuluj</button>}
      </article>)}{!ordered.length && <div className="ai-task-queue-empty"><Clock3 size={20} /><strong>Kolejka jest pusta</strong><span>Uruchom zadanie AI, aby zobaczyć jego postęp tutaj.</span></div>}</div>
      <footer><span>{ordered.filter(task => task.status === 'queued').length} oczekuje · {ordered.filter(task => task.status === 'running').length} w toku</span><button className="button primary" type="button" onClick={onClose}>Gotowe</button></footer>
    </section>
  </div>
}
