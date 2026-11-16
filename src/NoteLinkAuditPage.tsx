import { useMemo } from 'react'
import { ArrowUpRight, CircleAlert, Network, Unlink } from 'lucide-react'
import type { Note } from './types'
import { resolveWikiTarget, wikiTargets } from './knowledge'

export function NoteLinkAuditPage({ notes, onOpen }: { notes: Note[]; onOpen: (noteId: string) => void }) {
  const report = useMemo(() => {
    const broken = notes.flatMap(note => [...new Set(wikiTargets(note.content))].flatMap(target => resolveWikiTarget(notes, target) ? [] : [{ note, target }]))
    const orphaned = notes.filter(note => {
      const outgoing = wikiTargets(note.content).some(target => { const resolved = resolveWikiTarget(notes, target); return Boolean(resolved && resolved.id !== note.id) })
      const incoming = notes.some(candidate => candidate.id !== note.id && wikiTargets(candidate.content).some(target => resolveWikiTarget(notes, target)?.id === note.id))
      return !outgoing && !incoming
    })
    return { broken, orphaned }
  }, [notes])
  return <section className="workspace-tool-page link-audit-page">
    <header className="workspace-tool-heading"><span className="workspace-tool-icon"><Network size={20} /></span><div><p className="eyebrow">NAWIGACJA</p><h1>Kontrola powiązań</h1><p>Sprawdź linki prowadzące do nieistniejących notatek i notatki bez połączeń.</p></div></header>
    <div className="link-audit-summary"><article><span><CircleAlert size={17} /></span><strong>{report.broken.length}</strong><small>nieprawidłowych linków</small></article><article><span><Unlink size={17} /></span><strong>{report.orphaned.length}</strong><small>notatek bez powiązań</small></article></div>
    <section className="link-audit-section"><header><div><h2>Nieprawidłowe linki</h2><p>Cel linku nie pasuje do tytułu ani aliasu żadnej notatki.</p></div></header>{report.broken.length ? <div className="link-audit-list">{report.broken.map(({ note, target }, index) => <article key={`${note.id}:${target}:${index}`}><span className="link-audit-badge">[[{target}]]</span><button type="button" onClick={() => onOpen(note.id)}>{note.title || 'Bez tytułu'}<ArrowUpRight size={13} /></button><small>{note.folder || 'Poziom główny'}</small></article>)}</div> : <p className="link-audit-clear">Wszystkie linki prowadzą do istniejących notatek.</p>}</section>
    <section className="link-audit-section"><header><div><h2>Notatki bez połączeń</h2><p>Brak linków wychodzących i przychodzących między różnymi notatkami.</p></div></header>{report.orphaned.length ? <div className="link-audit-list">{report.orphaned.map(note => <article key={note.id}><span className="link-audit-badge">Bez powiązań</span><button type="button" onClick={() => onOpen(note.id)}>{note.title || 'Bez tytułu'}<ArrowUpRight size={13} /></button><small>{note.folder || 'Poziom główny'}</small></article>)}</div> : <p className="link-audit-clear">Każda notatka jest połączona z inną notatką.</p>}</section>
  </section>
}
