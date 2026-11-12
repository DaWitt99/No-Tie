import { useMemo } from 'react'
import { Copy, Merge, X } from 'lucide-react'
import type { Note } from './types'

function tokens(value: string) { return new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').match(/[\p{L}\p{N}]{3,}/gu) ?? []) }
function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  return intersection / (left.size + right.size - intersection || 1)
}

export function DuplicateManagerDialog({ notes, onOpen, onMerge, onClose }: { notes: Note[]; onOpen: (id: string) => void; onMerge: (targetId: string, sourceId: string) => void; onClose: () => void }) {
  const pairs = useMemo(() => {
    const prepared = notes.map(note => ({ note, content: tokens(note.content), title: tokens(note.title) }))
    const result: { first: Note; second: Note; score: number; exact: boolean }[] = []
    for (let i = 0; i < prepared.length; i += 1) for (let j = i + 1; j < prepared.length; j += 1) {
      const first = prepared[i]!, second = prepared[j]!
      const exact = first.note.content.trim().replace(/\s+/g, ' ') === second.note.content.trim().replace(/\s+/g, ' ')
        && first.note.title.trim().toLocaleLowerCase('pl') === second.note.title.trim().toLocaleLowerCase('pl')
      const contentScore = similarity(first.content, second.content)
      const titleScore = similarity(first.title, second.title)
      const score = exact ? 1 : contentScore * .8 + titleScore * .2
      if (exact || score >= .82 && (titleScore >= .5 || contentScore >= .9)) result.push({ first: first.note, second: second.note, score, exact })
    }
    return result.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score).slice(0, 100)
  }, [notes])
  return <div className="modal-backdrop duplicate-manager-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="duplicate-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-manager-title"><header><span className="folder-dialog-mark"><Copy size={19} /></span><div><h2 id="duplicate-manager-title">Podobne notatki</h2><p>{pairs.length} par do sprawdzenia</p></div><button type="button" className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header><p className="duplicate-manager-help">Porównuję tytuły i treść. Przed scaleniem wybierz notatkę, która ma pozostać główna.</p><div className="duplicate-manager-list">{pairs.map(pair => <article className="duplicate-pair" key={`${pair.first.id}:${pair.second.id}`}><span className="duplicate-score">{pair.exact ? 'Identyczne' : `${Math.round(pair.score * 100)}% podobieństwa`}</span><div><button type="button" onClick={() => onOpen(pair.first.id)}>{pair.first.title || 'Bez tytułu'} <small>{pair.first.folder || 'Bez folderu'}</small></button><button type="button" onClick={() => onOpen(pair.second.id)}>{pair.second.title || 'Bez tytułu'} <small>{pair.second.folder || 'Bez folderu'}</small></button></div><button type="button" className="button secondary" onClick={() => onMerge(pair.first.id, pair.second.id)} title="Dołącz drugą treść do pierwszej"><Merge size={14} />Scal do pierwszej</button><button type="button" className="button secondary" onClick={() => onMerge(pair.second.id, pair.first.id)} title="Dołącz pierwszą treść do drugiej"><Merge size={14} />Scal do drugiej</button></article>)}{!pairs.length && <div className="duplicate-manager-empty">Nie znaleziono podobnych notatek.</div>}</div></section></div>
}
