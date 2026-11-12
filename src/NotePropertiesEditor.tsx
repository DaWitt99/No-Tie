import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Note } from './types'

export function NotePropertiesEditor({ note, onChange }: { note: Note; onChange: (patch: Partial<Note>) => void }) {
  const [aliases, setAliases] = useState((note.aliases ?? []).join(', '))
  const properties = note.properties ?? {}
  const visibleProperties = Object.entries(properties).filter(([key]) => !key.startsWith('no-tie-'))
  const commitAliases = () => {
    const next = [...new Set(aliases.split(',').map(alias => alias.trim()).filter(Boolean))]
    if (JSON.stringify(next) !== JSON.stringify(note.aliases ?? [])) onChange({ aliases: next })
  }
  const addProperty = () => {
    let index = 1
    while (properties[`pole-${index}`] !== undefined) index++
    onChange({ properties: { ...properties, [`pole-${index}`]: '' } })
  }
  return <details className="note-properties-editor"><summary>Właściwości notatki</summary><div className="note-properties-body">
    <label><span>Alias</span><input value={aliases} onChange={event => setAliases(event.target.value)} onBlur={commitAliases} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitAliases(); event.currentTarget.blur() } }} placeholder="np. nazwa skrócona, skrót" /></label>
    <div className="note-properties-heading"><strong>Pola własne</strong><button type="button" className="icon-button" title="Dodaj pole" aria-label="Dodaj własne pole" onClick={addProperty}><Plus size={15} /></button></div>
    {visibleProperties.map(([key, value]) => <div className="note-property-row" key={key}><input aria-label="Nazwa właściwości" value={key} onChange={event => { const next = { ...properties }; delete next[key]; next[event.target.value] = value; onChange({ properties: next }) }} /><input aria-label={`Wartość: ${key}`} value={value} onChange={event => onChange({ properties: { ...properties, [key]: event.target.value } })} placeholder="Wartość" /><button type="button" className="icon-button" title="Usuń pole" aria-label={`Usuń pole ${key}`} onClick={() => { const next = { ...properties }; delete next[key]; onChange({ properties: next }) }}><X size={14} /></button></div>)}
    {!visibleProperties.length && <small>Dodaj daty, statusy lub inne własne metadane. Zapisują się w YAML frontmatter pliku Markdown.</small>}
  </div></details>
}
