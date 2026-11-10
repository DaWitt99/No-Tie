import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import type { Note } from './types'

const noteDate = (value: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(value)
const noteExcerpt = (note: Note) => note.content.replace(/^#+\s*/gm, '').replace(/[>*_`!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)

export function NoteSearchDialog({
  query,
  tag,
  folder,
  tags,
  folders,
  results,
  activeIndex,
  onQueryChange,
  onTagChange,
  onFolderChange,
  onActiveIndexChange,
  onSelect,
  onClose,
}: {
  query: string
  tag: string
  folder: string
  tags: string[]
  folders: string[]
  results: Note[]
  activeIndex: number
  onQueryChange: (value: string) => void
  onTagChange: (value: string) => void
  onFolderChange: (value: string) => void
  onActiveIndexChange: (value: number) => void
  onSelect: (note: Note) => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const activeResult = Math.min(activeIndex, Math.max(0, results.length - 1))

  useEffect(() => { requestAnimationFrame(() => input.current?.focus()) }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      onActiveIndexChange((activeResult + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      onActiveIndexChange((activeResult - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[activeResult]) {
      event.preventDefault()
      onSelect(results[activeResult])
    }
  }

  return <div className="modal-backdrop quick-search-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="quick-search-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-search-title" onKeyDown={handleKeyDown}>
      <h2 id="quick-search-title" className="sr-only">Szybkie wyszukiwanie notatek</h2>
      <div className="quick-search-input-row"><Search size={19} /><input ref={input} value={query} onChange={event => { onQueryChange(event.currentTarget.value); onActiveIndexChange(0) }} placeholder="Szukaj w tytułach i treści…" aria-label="Szukaj we wszystkich notatkach" /><kbd>↑ ↓</kbd><button type="button" className="icon-button" aria-label="Zamknij wyszukiwanie" onClick={onClose}><X size={17} /></button></div>
      <div className="quick-search-filters">
        <label><span>Tag</span><select value={tag} onChange={event => { onTagChange(event.currentTarget.value); onActiveIndexChange(0) }} aria-label="Filtruj wyniki po tagu"><option value="">Wszystkie tagi</option>{tags.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>Folder</span><select value={folder} onChange={event => { onFolderChange(event.currentTarget.value); onActiveIndexChange(0) }} aria-label="Filtruj wyniki po folderze"><option value="">Wszystkie foldery</option><option value="__root__">Bez folderu</option>{folders.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="quick-search-results" role="listbox" aria-label="Wyniki wyszukiwania">
        {results.length ? results.map((note, index) => <button type="button" role="option" aria-selected={index === activeResult} className={`quick-search-result ${index === activeResult ? 'active' : ''}`} key={note.id} onMouseEnter={() => onActiveIndexChange(index)} onClick={() => onSelect(note)}>
          <span className="quick-search-result-icon"><Search size={15} /></span><span className="quick-search-result-main"><strong>{note.title || 'Bez tytułu'}</strong><span>{noteExcerpt(note) || 'Pusta notatka'}</span><small>{note.folder || 'Bez folderu'}{note.tags.length ? ` · ${note.tags.join(', ')}` : ''}</small></span><time>{noteDate(note.updatedAt)}</time>
        </button>) : <div className="quick-search-empty">Brak pasujących notatek. Spróbuj zmienić zapytanie lub filtry.</div>}
      </div>
      <footer className="quick-search-footer"><span>{results.length} {results.length === 1 ? 'wynik' : 'wyników'}</span><span><kbd><ArrowUp size={11} /><ArrowDown size={11} /></kbd> wybierz <kbd>Enter</kbd> otwórz <kbd>Esc</kbd> zamknij</span></footer>
    </section>
  </div>
}
