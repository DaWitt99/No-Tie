import { lazy, Suspense, useState, type FormEvent } from 'react'
import { ArrowLeft, Code2, Eye, FilePlus2, Plus, Save, Trash2 } from 'lucide-react'
import type { Note, NoteAsset, NoteTemplate } from './types'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(module => ({ default: module.MarkdownEditor })))
const noop = () => {}

const blankTemplate = (): NoteTemplate => ({ id: crypto.randomUUID(), title: '', tags: [], content: '# Nowy szablon\n\n' })

export function TemplateManagerDialog({ templates, notes, assets, onSave, onClose }: { templates: NoteTemplate[]; notes: Note[]; assets: NoteAsset[]; onSave: (templates: NoteTemplate[]) => void; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const [draft, setDraft] = useState<NoteTemplate>(() => templates[0] ?? blankTemplate())
  const [viewMode, setViewMode] = useState<'rendered' | 'markdown'>('rendered')
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
  return <section className="template-manager-page" aria-labelledby="template-manager-title">
      <header><span className="folder-dialog-mark"><FilePlus2 size={19} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="template-manager-title">Szablony notatek</h1><p>Twórz i edytuj układy notatek Markdown.</p></div><button className="icon-button" type="button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
      <div className="template-manager-body"><aside className="template-manager-list"><button type="button" className="template-add" onClick={addTemplate}><Plus size={15} />Nowy szablon</button>{templates.map(template => <button type="button" key={template.id} className={selectedId === template.id ? 'active' : ''} onClick={() => select(template)}><strong>{template.title}</strong><small>{template.tags.join(', ') || 'Bez tagów'}</small></button>)}</aside>
        <form className="template-editor-form" onSubmit={submit}><label>Nazwa<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="np. Plan projektu" /></label><label>Tagi<input value={draft.tags.join(', ')} onChange={event => setDraft(current => ({ ...current, tags: event.target.value.split(',') }))} placeholder="projekt, praca" /></label>
          <section className="template-content-field" aria-labelledby="template-content-title">
            <div className="template-content-heading"><span id="template-content-title">Treść szablonu</span><div className="view-mode-toggle" role="group" aria-label="Tryb podglądu szablonu">
              <button type="button" className={`view-mode-button ${viewMode === 'rendered' ? 'active' : ''}`} aria-label="Widok podstawowy" title="Widok podstawowy" aria-pressed={viewMode === 'rendered'} onClick={() => setViewMode('rendered')}><Eye size={15} /></button>
              <button type="button" className={`view-mode-button ${viewMode === 'markdown' ? 'active' : ''}`} aria-label="Widok Markdown" title="Widok Markdown" aria-pressed={viewMode === 'markdown'} onClick={() => setViewMode('markdown')}><Code2 size={15} /></button>
            </div></div>
            <div className={`template-content-display ${viewMode === 'markdown' ? 'is-markdown' : ''}`}>
              {viewMode === 'markdown' ? <textarea aria-label="Treść Markdown szablonu" value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} spellCheck={false} /> : <div className="template-content-preview"><Suspense fallback={<div className="editor-loading">Przygotowuję podgląd…</div>}><MarkdownEditor key={`${draft.id}:${draft.content}`} noteId={`template-preview-${draft.id}`} markdown={draft.content} assets={[]} attachments={[]} revision={0} onChange={noop} onSelectionChange={noop} onOpenNote={noop} onOpenAttachment={noop} notes={notes} allAssets={assets} noteActions={[]} onNoteAction={noop} readOnly /></Suspense></div>}
            </div>
          </section>
          <div className="template-form-actions"><button type="button" className="button danger-button" disabled={!templates.some(item => item.id === selectedId)} onClick={deleteTemplate}><Trash2 size={14} />Usuń</button><button type="submit" className="button primary" disabled={!draft.title.trim()}><Save size={14} />Zapisz szablon</button></div></form>
      </div>
  </section>
}
