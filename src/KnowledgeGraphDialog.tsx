import { useMemo, useState } from 'react'
import { Network, X } from 'lucide-react'
import { resolveWikiTarget, wikiTargets } from './knowledge'
import type { Note } from './types'

export function KnowledgeGraphDialog({ notes, onOpen, onClose }: { notes: Note[]; onOpen: (note: Note) => void; onClose: () => void }) {
  const [folder, setFolder] = useState('')
  const [tag, setTag] = useState('')
  const folders = [...new Set(notes.map(note => note.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'))
  const tags = [...new Set(notes.flatMap(note => note.tags))].sort((a, b) => a.localeCompare(b, 'pl'))
  const visible = useMemo(() => notes.filter(note => (!folder || note.folder === folder || note.folder.startsWith(`${folder}/`)) && (!tag || note.tags.includes(tag))), [folder, notes, tag])
  const graph = useMemo(() => {
    const center = { x: 400, y: 270 }
    const ordered = [...visible].sort((a, b) => a.title.localeCompare(b.title, 'pl'))
    const positions = new Map(ordered.map((note, index) => {
      const angle = -Math.PI / 2 + index * 2 * Math.PI / Math.max(ordered.length, 1)
      const radius = ordered.length <= 1 ? 0 : ordered.length < 12 ? 190 : 215
      return [note.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }] as const
    }))
    const visibleIds = new Set(ordered.map(note => note.id))
    const edges = ordered.flatMap(source => [...new Set(wikiTargets(source.content))].map(target => resolveWikiTarget(notes, target)).filter((target): target is Note => Boolean(target && target.id !== source.id && visibleIds.has(target.id))).map(target => ({ from: source.id, to: target.id })))
    return { center, ordered, positions, edges }
  }, [notes, visible])

  function openFromKeyboard(event: React.KeyboardEvent<SVGGElement>, note: Note) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(note) }
  }

  return <div className="modal-backdrop graph-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="knowledge-graph-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-graph-title">
      <header><span className="folder-dialog-mark"><Network size={19} /></span><div><h2 id="knowledge-graph-title">Mapa powiązań</h2><p>{graph.ordered.length} notatek · {graph.edges.length} połączeń</p></div><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option value="">Wszystkie foldery</option>{folders.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>Tag<select value={tag} onChange={event => setTag(event.target.value)}><option value="">Wszystkie tagi</option>{tags.map(item => <option key={item} value={item}>{item}</option>)}</select></label><button className="icon-button" type="button" aria-label="Zamknij mapę powiązań" onClick={onClose}><X size={17} /></button></header>
      <div className="knowledge-graph-canvas">
        {graph.ordered.length ? <svg viewBox="0 0 800 540" role="img" aria-label="Graf połączeń między notatkami">
          {graph.edges.map((edge, index) => { const from = graph.positions.get(edge.from)!; const to = graph.positions.get(edge.to)!; return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="knowledge-graph-edge" /> })}
          {graph.ordered.map(note => { const point = graph.positions.get(note.id)!; const linked = graph.edges.some(edge => edge.from === note.id || edge.to === note.id); return <g key={note.id} className="knowledge-graph-node" role="button" tabIndex={0} aria-label={`Otwórz notatkę ${note.title}`} onClick={() => onOpen(note)} onKeyDown={event => openFromKeyboard(event, note)}>
            <circle cx={point.x} cy={point.y} r="25" className={linked ? 'linked' : 'orphan'} />
            <text x={point.x} y={point.y + 4}>{(note.title || 'Bez tytułu').slice(0, 14)}{note.title.length > 14 ? '…' : ''}</text>
          </g> })}
        </svg> : <div className="knowledge-graph-empty"><Network size={25} /><strong>Brak notatek w tym filtrze</strong><span>Zmień tag lub folder, aby zobaczyć inne połączenia.</span></div>}
      </div>
      <footer><span><i className="graph-legend linked" />Połączona</span><span><i className="graph-legend orphan" />Bez połączeń</span><span>Kliknij węzeł, aby otworzyć notatkę.</span></footer>
    </section>
  </div>
}
