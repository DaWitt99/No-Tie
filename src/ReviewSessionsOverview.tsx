import { ArrowUpRight, Clock3, Pencil, Plus, Repeat2 } from 'lucide-react'
import { formatReviewDuration, reviewTotalTime } from './reviews'
import type { Note, ReviewSession } from './types'

function statusLabel(status: ReviewSession['status']) {
  if (status === 'running') return 'W trakcie'
  if (status === 'paused') return 'Wstrzymana'
  if (status === 'completed') return 'Zakończona'
  return 'Gotowa'
}

export function ReviewSessionsOverview({
  sessions,
  notes,
  now,
  onOpen,
  onCreate,
  onEdit,
}: {
  sessions: ReviewSession[]
  notes: Note[]
  now: number
  onOpen: (sessionId: string) => void
  onCreate: () => void
  onEdit: (sessionId: string) => void
}) {
  const noteById = new Map(notes.map(note => [note.id, note]))

  return <section className="review-sessions-overview">
    <header className="review-overview-heading">
      <div className="review-overview-title">
        <span className="review-overview-mark"><Repeat2 size={19} /></span>
        <div><p className="eyebrow">NARZĘDZIA · POWTÓRKI</p><h1>Twoje powtórki</h1><p>Wybierz sesję, aby kontynuować naukę albo sprawdzić jej podsumowanie.</p></div>
      </div>
      <button className="button primary" onClick={onCreate}><Plus size={15} />Nowa powtórka</button>
    </header>

    {sessions.length ? <div className="review-overview-list">
      {sessions.map(session => {
        const sessionNotes = session.noteIds.map(id => noteById.get(id)).filter((note): note is Note => Boolean(note))
        return <article className="review-overview-card" key={session.id}>
          <button type="button" className="review-overview-open" onClick={() => onOpen(session.id)}>
            <span className={`review-overview-icon ${session.status}`}><Repeat2 size={17} /></span>
            <span className="review-overview-main">
              <strong>{session.title}</strong>
              <span>{sessionNotes.length} {sessionNotes.length === 1 ? 'notatka' : 'notatek'}{sessionNotes.length ? ` · ${sessionNotes.slice(0, 3).map(note => note.title || 'Bez tytułu').join(', ')}${sessionNotes.length > 3 ? ` i ${sessionNotes.length - 3} więcej` : ''}` : ''}</span>
              <small>Utworzono {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(session.createdAt)}</small>
            </span>
            <span className={`review-overview-status ${session.status}`}><i />{statusLabel(session.status)}</span>
            <span className="review-overview-time"><Clock3 size={14} />{formatReviewDuration(reviewTotalTime(session, now))}</span>
            <ArrowUpRight className="review-overview-arrow" size={16} />
          </button>
          <button type="button" className="review-overview-edit" onClick={() => onEdit(session.id)} aria-label={`Edytuj powtórkę ${session.title}`} title="Edytuj powtórkę"><Pencil size={14} /></button>
        </article>
      })}
    </div> : <div className="review-overview-empty">
      <span><Repeat2 size={22} /></span><strong>Nie masz jeszcze powtórek</strong><p>Utwórz sesję i wybierz notatki, które chcesz przejrzeć.</p><button className="button primary" onClick={onCreate}><Plus size={15} />Utwórz pierwszą powtórkę</button>
    </div>}
  </section>
}
