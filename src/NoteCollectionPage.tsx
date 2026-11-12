import { Clock3, Heart, Star } from 'lucide-react'
import type { Note } from './types'

export function NoteCollectionPage({ kind, notes, recentIds, onOpen }: {
  kind: 'recent' | 'favorites'
  notes: Note[]
  recentIds: string[]
  onOpen: (noteId: string) => void
}) {
  const favorites = kind === 'favorites'
  const entries = favorites
    ? notes.filter(note => note.favorite).sort((a, b) => b.updatedAt - a.updatedAt)
    : recentIds.map(id => notes.find(note => note.id === id)).filter((note): note is Note => Boolean(note)).slice(0, 60)
  return <section className="note-collection-page">
    <header className="note-collection-heading">
      <span className="note-collection-mark">{favorites ? <Heart size={20} /> : <Clock3 size={20} />}</span>
      <div><p className="eyebrow">NOTATKI</p><h1>{favorites ? 'Ulubione' : 'Ostatnie'}</h1><p>{favorites ? 'Notatki oznaczone gwiazdką.' : 'Ostatnio otwierane notatki.'}</p></div>
    </header>
    {entries.length ? <div className="note-collection-list">{entries.map(note => <button type="button" key={note.id} onClick={() => onOpen(note.id)}>
      <span className="note-collection-item-icon">{favorites ? <Star size={16} fill="currentColor" /> : <Clock3 size={16} />}</span>
      <span className="note-collection-item-main"><strong>{note.title || 'Bez tytułu'}</strong><small>{note.folder || 'Poziom główny'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</small></span>
      <span className="note-collection-date">{new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(note.updatedAt)}</span>
    </button>)}</div> : <div className="note-collection-empty">{favorites ? 'Nie oznaczono jeszcze ulubionych notatek.' : 'Ostatnio otwierane notatki pojawią się tutaj.'}</div>}
  </section>
}
