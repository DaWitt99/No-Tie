import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Link2, Search, X } from 'lucide-react'
import type { Note } from './types'

export function NoteLinkDialog({ notes, currentNoteId, onSelect, onClose, purpose = 'link' }: {
  notes: Note[]
  currentNoteId: string
  onSelect: (note: Note) => void
  onClose: () => void
  purpose?: 'link' | 'embed'
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => {
    const needle = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl')
    return notes.filter(note => note.id !== currentNoteId && (!needle || `${note.title} ${note.aliases?.join(' ') ?? ''} ${note.folder} ${note.tags.join(' ')}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
  }, [currentNoteId, notes, query])

  useEffect(() => { requestAnimationFrame(() => input.current?.focus()) }, [])

  return <div className="modal-backdrop note-link-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="note-link-dialog" role="dialog" aria-modal="true" aria-labelledby="note-link-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <header><span className="folder-dialog-mark"><Link2 size={19} /></span><div><h2 id="note-link-title">{purpose === 'embed' ? 'Osadź notatkę' : 'Wstaw łącze do notatki'}</h2><p>{purpose === 'embed' ? 'Wybierz notatkę. Jej czytelny podgląd pojawi się bezpośrednio pod bieżącym akapitem.' : 'Wybierz notatkę, do której ma prowadzić odsyłacz.'}</p></div><button className="icon-button" type="button" aria-label="Zamknij wybór notatki" onClick={onClose}><X size={17} /></button></header>
      <label className="note-link-search"><Search size={16} /><input ref={input} value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="Szukaj po tytule, folderze lub tagu…" aria-label="Filtruj notatki do połączenia" /></label>
      <div className="note-link-results">
        {results.length ? results.map(note => <button type="button" key={note.id} onClick={() => onSelect(note)}><span><strong>{note.title || 'Bez tytułu'}</strong><small>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</small></span><ArrowUpRight size={15} /></button>) : <p>Nie znaleziono notatek do połączenia.</p>}
      </div>
      <footer>{purpose === 'embed' ? <>Podgląd zostanie osadzony w miejscu bieżącego akapitu i będzie aktualizowany razem z notatką źródłową.</> : <>Po wstawieniu odsyłacz zapisze się jako <code>[[Nazwa notatki]]</code>.</>}</footer>
    </section>
  </div>
}
