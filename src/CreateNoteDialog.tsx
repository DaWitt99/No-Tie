import { useEffect, useRef, useState } from 'react'
import { FilePlus2, X } from 'lucide-react'
import type { NoteTemplate } from './types'

export function CreateNoteDialog({ templates, folders, initialFolder, onCreate, onClose }: {
  templates: NoteTemplate[]
  folders: string[]
  initialFolder: string
  onCreate: (template: NoteTemplate | undefined, folder: string) => void
  onClose: () => void
}) {
  const [templateId, setTemplateId] = useState('')
  const [folder, setFolder] = useState(initialFolder)
  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => { requestAnimationFrame(() => selectRef.current?.focus()) }, [])
  const template = templates.find(item => item.id === templateId)
  return <div className="modal-backdrop create-note-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="create-note-dialog" role="dialog" aria-modal="true" aria-labelledby="create-note-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <header><span className="folder-dialog-mark"><FilePlus2 size={19} /></span><div><h2 id="create-note-title">Nowa notatka</h2><p>Wybierz folder i opcjonalny szablon.</p></div><button className="icon-button" type="button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header>
      <label className="create-note-field"><span>Folder</span><select value={folder} onChange={event => setFolder(event.target.value)}><option value="">Poziom główny</option>{folders.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
      <label className="create-note-field"><span>Szablon</span><select ref={selectRef} value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">Pusta notatka</option>{templates.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      {template && <div className="create-note-template-preview"><strong>{template.title}</strong><span>{template.tags.length ? template.tags.map(tag => `#${tag}`).join(' ') : 'Bez tagów'}</span></div>}
      <footer><button type="button" className="button secondary" onClick={onClose}>Anuluj</button><button type="button" className="button primary" onClick={() => onCreate(template, folder)}>Utwórz notatkę</button></footer>
    </section>
  </div>
}
