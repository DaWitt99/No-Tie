import { useMemo } from 'react'
import { Quote } from 'lucide-react'
import type { Note } from './types'
import { resolveWikiTarget } from './knowledge'

function embeddedSection(note: Note, heading = '') {
  const lines = note.content.split(/\r?\n/)
  if (!heading) return note.content.trim().slice(0, 1400)
  const normalized = heading.trim().toLocaleLowerCase('pl')
  const start = lines.findIndex(line => /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, '').trim().toLocaleLowerCase('pl') === normalized)
  if (start < 0) return `Nie znaleziono sekcji „${heading}” w tej notatce.`
  const level = lines[start].match(/^#+/)?.[0].length ?? 6
  let end = start + 1
  while (end < lines.length && !new RegExp(`^#{1,${level}}\\s+`).test(lines[end])) end++
  return lines.slice(start, end).join('\n').trim().slice(0, 1400)
}

export function NoteEmbedsPanel({ note, notes, onOpen }: { note: Note; notes: Note[]; onOpen: (note: Note) => void }) {
  const embeds = useMemo(() => {
    const body = note.content.replace(/^\s*(```+|~~~+)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
    return [...body.matchAll(/!\[\[([^\]\n]+)\]\]/g)].map(match => {
      const raw = match[1].trim()
      const [target, heading] = raw.split('#', 2)
      const [cleanTarget, label] = target.split('|', 2)
      const source = resolveWikiTarget(notes, cleanTarget.trim())
      return { key: `${raw}:${match.index}`, title: label?.trim() || source?.title || cleanTarget.trim(), source, heading: heading?.trim() ?? '' }
    })
  }, [note.content, notes])
  if (!embeds.length) return null
  return <section className="note-embeds-panel" aria-label="Osadzone fragmenty notatek">{embeds.map(embed => <article key={embed.key} className="note-embed-card"><header><Quote size={14} /><strong>{embed.heading ? `${embed.title} · ${embed.heading}` : embed.title}</strong>{embed.source && <button type="button" onClick={() => onOpen(embed.source!)}>Otwórz notatkę ↗</button>}</header><pre>{embed.source ? embeddedSection(embed.source, embed.heading) : 'Nie znaleziono powiązanej notatki.'}</pre></article>)}</section>
}
