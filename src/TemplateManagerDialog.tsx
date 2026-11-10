import { useState, type FormEvent } from 'react'
import { FilePlus2, Plus, Save, Trash2, X } from 'lucide-react'
import type { NoteTemplate } from './types'

const blankTemplate = (): NoteTemplate => ({ id: crypto.randomUUID(), title: '', tags: [], content: '# Nowy szablon\n\n' })

export function TemplateManagerDialog({ templates, onSave, onClose }: { templates: NoteTemplate[]; onSave: (templates: NoteTemplate[]) => void; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const [draft, setDraft] = useState<NoteTemplate>(() => templates[0] ?? blankTemplate())
  function select(template: NoteTemplate) { setSelectedId(template.id); setDraft({ ...template, tags: [...template.tags] }) }
  function addTemplate() { const template = blankTemplate(); setSelectedId(template.id); setDraft(template) }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.title.trim()) return
    const template = { ...draft, title: draft.title.trim(), tags: draft.tags.map(tag => tag.trim()).filter(Boolean) }
    onSave([...templates.filter(item => item.id !== template.id), template])
    setSelectedId(template.id); setDraft(template)
  }
  function deleteTemplate() {
    const remaining = templates.filter(item => item.id !== selectedId)
    onSave(remaining)
    select(remaining[0] ?? blankTemplate())
  }
  return <div className="modal-backdrop template-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="template-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="template-manager-title">
      <header><span className="folder-dialog-mark"><FilePlus2 size={19} /></span><div><h2 id="template-manager-title">Własne szablony</h2><p>Twórz i edytuj układy notatek Markdown.</p></div><button className="icon-button" type="button" aria-label="Zamknij szablony" onClick={onClose}><X size={17} /></button></header>
      <div className="template-manager-body"><aside className="template-manager-list"><button type="button" className="template-add" onClick={addTemplate}><Plus size={15} />Nowy szablon</button>{templates.map(template => <button type="button" key={template.id} className={selectedId === template.id ? 'active' : ''} onClick={() => select(template)}><strong>{template.title}</strong><small>{template.tags.join(', ') || 'Bez tagów'}</small></button>)}</aside>
        <form className="template-editor-form" onSubmit={submit}><label>Nazwa<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="np. Plan projektu" /></label><label>Tagi<input value={draft.tags.join(', ')} onChange={event => setDraft(current => ({ ...current, tags: event.target.value.split(',') }))} placeholder="projekt, praca" /></label><label>Treść Markdown<textarea value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} spellCheck={false} /></label><div className="template-form-actions"><button type="button" className="button danger-button" disabled={!templates.some(item => item.id === selectedId)} onClick={deleteTemplate}><Trash2 size={14} />Usuń</button><button type="submit" className="button primary" disabled={!draft.title.trim()}><Save size={14} />Zapisz szablon</button></div></form>
      </div>
    </section>
  </div>
}
