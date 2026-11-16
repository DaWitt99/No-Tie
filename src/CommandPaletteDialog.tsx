import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Command, FileText, Search, X } from 'lucide-react'

export type PaletteCommand = { id: string; title: string; detail: string; group: string; run: () => void }

export function CommandPaletteDialog({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl')
    if (!needle) return commands
    return commands.filter(command => `${command.title} ${command.detail} ${command.group}`.toLocaleLowerCase('pl').includes(needle))
  }, [commands, query])
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1))

  useEffect(() => { requestAnimationFrame(() => input.current?.focus()) }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown' && filtered.length) { event.preventDefault(); setActiveIndex(value => (value + 1) % filtered.length) }
    else if (event.key === 'ArrowUp' && filtered.length) { event.preventDefault(); setActiveIndex(value => (value - 1 + filtered.length) % filtered.length) }
    else if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); filtered[active].run(); onClose() }
  }

  return <div className="modal-backdrop command-palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="command-palette-dialog" role="dialog" aria-modal="true" aria-label="Paleta poleceń" onKeyDown={handleKeyDown}>
      <label className="command-palette-search"><Command size={18} /><input ref={input} value={query} onChange={event => { setQuery(event.target.value); setActiveIndex(0) }} placeholder="Otwórz widok, notatkę lub narzędzie…" aria-label="Szukaj polecenia" /><kbd>Ctrl ⇧ P</kbd><button type="button" className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={16} /></button></label>
      <div className="command-palette-results" role="listbox" aria-label="Polecenia">
        {filtered.length ? filtered.map((command, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? 'active' : ''} key={command.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => { command.run(); onClose() }}>
          <span className="command-palette-icon">{command.group === 'Notatki' ? <FileText size={15} /> : <Search size={15} />}</span><span><strong>{command.title}</strong><small>{command.detail}</small></span><em>{command.group}</em>
        </button>) : <p className="command-palette-empty">Brak pasujących poleceń.</p>}
      </div>
      <footer><span>{filtered.length} poleceń</span><span><kbd><ArrowUp size={10} /><ArrowDown size={10} /></kbd> wybierz <kbd>Enter</kbd> otwórz <kbd>Esc</kbd> zamknij</span></footer>
    </section>
  </div>
}
