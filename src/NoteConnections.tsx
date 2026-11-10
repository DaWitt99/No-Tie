import { ArrowDownLeft, ArrowUpRight, Network } from 'lucide-react'
import { backlinksFor, resolveWikiTarget, wikiTargets } from './knowledge'
import type { Note } from './types'

export function NoteConnections({ note, notes, onOpen, onShowGraph }: {
  note: Note
  notes: Note[]
  onOpen: (note: Note) => void
  onShowGraph: () => void
}) {
  const outgoing = [...new Set(wikiTargets(note.content))].map(target => ({ target, note: resolveWikiTarget(notes, target) }))
  const incoming = backlinksFor(notes, note)
  return <div className="note-connections-wrap">
    <details className="note-connections">
      <summary><Network size={15} /><span>Powiązania</span><small>{incoming.length + outgoing.length ? `${incoming.length} przychodzących · ${outgoing.length} wychodzących` : 'Notatka bez połączeń'}</small></summary>
      <div className="note-connections-content">
        <section><h3><ArrowDownLeft size={14} />Linkują do tej notatki</h3>{incoming.length ? incoming.map(item => <button key={item.id} onClick={() => onOpen(item)}>{item.title || 'Bez tytułu'}</button>) : <p>Brak odsyłaczy zwrotnych.</p>}</section>
        <section><h3><ArrowUpRight size={14} />Linki z tej notatki</h3>{outgoing.length ? outgoing.map((item, index) => item.note
          ? <button key={`${item.note.id}:${index}`} onClick={() => onOpen(item.note!)}>{item.note.title || 'Bez tytułu'}</button>
          : <span className="unresolved-link" key={`${item.target}:${index}`}>{item.target} <small>nie znaleziono</small></span>) : <p>Ta notatka nie prowadzi do innych.</p>}</section>
      </div>
    </details>
    <button type="button" className="note-graph-button" onClick={onShowGraph}><Network size={14} />Mapa</button>
  </div>
}
