import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Code2, Eye, FilePlus2, Folder, Tag } from 'lucide-react'
import type { Note, NoteAsset, NoteTemplate } from './types'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(module => ({ default: module.MarkdownEditor })))
const noop = () => {}

export function CreateNotePage({ templates, folders, initialFolder, folderTemplateDefaults = {}, onSetFolderTemplateDefault, notes, assets, onCreate, onClose }: {
  templates: NoteTemplate[]
  folders: string[]
  initialFolder: string
  folderTemplateDefaults?: Record<string, string>
  onSetFolderTemplateDefault?: (folder: string, templateId: string | undefined) => void
  notes: Note[]
  assets: NoteAsset[]
  onCreate: (template: NoteTemplate | undefined, folder: string) => void
  onClose: () => void
}) {
  const [templateId, setTemplateId] = useState('')
  const [folder, setFolder] = useState(initialFolder)
  const [viewMode, setViewMode] = useState<'rendered' | 'markdown'>('rendered')
  const template = templates.find(item => item.id === templateId)
  useEffect(() => {
    const defaultId = folderTemplateDefaults[folder] ?? ''
    setTemplateId(templates.some(item => item.id === defaultId) ? defaultId : '')
  }, [folder, folderTemplateDefaults, templates])
  const content = template?.content ?? '# Nowa notatka\n\nZacznij pisać…\n'
  const folderOptions = useMemo(() => [...new Set([...folders, initialFolder].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')), [folders, initialFolder])
  const previewId = `create-note-preview-${template?.id ?? 'blank'}`

  return <section className="create-note-page">
    <header className="create-note-page-heading">
      <span className="create-note-page-mark"><FilePlus2 size={21} /></span>
      <div><p className="eyebrow">NOTATKI</p><h1>Nowa notatka</h1><p>Wybierz miejsce i szablon. Podgląd pokazuje całą treść przed utworzeniem.</p></div>
    </header>

    <div className="create-note-page-layout">
      <aside className="create-note-settings-card">
        <div className="create-note-settings-heading"><span><Folder size={15} /></span><div><h2>Ustawienia</h2><p>Wybierz folder i układ notatki.</p></div></div>
        <label className="create-note-page-field"><span>Folder</span><select value={folder} onChange={event => setFolder(event.target.value)}><option value="">Poziom główny</option>{folderOptions.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
        <label className="create-note-page-field"><span>Szablon</span><select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">Pusta notatka</option>{templates.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        {onSetFolderTemplateDefault && <button type="button" className={`create-note-default-template ${folderTemplateDefaults[folder] === templateId && templateId ? 'active' : ''}`} disabled={!templateId} onClick={() => onSetFolderTemplateDefault(folder, folderTemplateDefaults[folder] === templateId ? undefined : templateId)}>{folderTemplateDefaults[folder] === templateId && templateId ? 'Domyślny szablon tego folderu' : 'Ustaw jako domyślny w folderze'}</button>}
        {template && <div className="create-note-template-details"><strong>{template.title}</strong><div><Tag size={13} />{template.tags.length ? template.tags.map(tag => <span className="create-note-template-tag" key={tag}>{tag}</span>) : <span className="create-note-template-no-tags">Bez tagów</span>}</div></div>}
        <div className="create-note-settings-tip"><FilePlus2 size={15} /><span>Możesz sprawdzić treść w podglądzie wizualnym albo w Markdown.</span></div>
      </aside>

      <section className="create-note-preview-panel" aria-label="Podgląd szablonu">
        <header className="create-note-preview-heading">
          <div><p className="eyebrow">PODGLĄD SZABLONU</p><h2>{template?.title ?? 'Nowa notatka'}</h2></div>
          <div className="view-mode-toggle create-note-view-toggle" role="group" aria-label="Tryb podglądu">
            <button type="button" className={`view-mode-button ${viewMode === 'rendered' ? 'active' : ''}`} aria-label="Widok podstawowy" title="Widok podstawowy" aria-pressed={viewMode === 'rendered'} onClick={() => setViewMode('rendered')}><Eye size={16} /></button>
            <button type="button" className={`view-mode-button ${viewMode === 'markdown' ? 'active' : ''}`} aria-label="Widok Markdown" title="Widok Markdown" aria-pressed={viewMode === 'markdown'} onClick={() => setViewMode('markdown')}><Code2 size={16} /></button>
          </div>
        </header>
        <div className={`create-note-preview-content ${viewMode === 'markdown' ? 'is-markdown' : ''}`}>
          {viewMode === 'markdown' ? <pre>{content}</pre> : <div className="create-note-rendered-preview"><Suspense fallback={<div className="editor-loading">Przygotowuję podgląd…</div>}><MarkdownEditor key={`${previewId}:${content}`} noteId={previewId} markdown={content} assets={[]} attachments={[]} revision={0} onChange={noop} onSelectionChange={noop} onOpenNote={noop} onOpenAttachment={noop} notes={notes} allAssets={assets} noteActions={[]} onNoteAction={noop} readOnly /></Suspense></div>}
        </div>
      </section>
    </div>

    <footer className="create-note-page-footer"><button type="button" className="button secondary" onClick={onClose}>Anuluj</button><button type="button" className="button primary" onClick={() => onCreate(template, folder)}><FilePlus2 size={15} />Utwórz notatkę</button></footer>
  </section>
}
