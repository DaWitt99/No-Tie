import { useState } from 'react'
import { Check, LayoutTemplate, Trash2, X } from 'lucide-react'
import type { SavedWorkspaceLayout } from './types'

export function WorkspaceLayoutsDialog({ layouts, onSave, onApply, onDelete, onClose }: {
  layouts: SavedWorkspaceLayout[]
  onSave: (name: string) => void
  onApply: (layout: SavedWorkspaceLayout) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="workspace-layout-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-layout-title">
    <header><span><LayoutTemplate size={18} /></span><div><p className="eyebrow">UKŁADY</p><h2 id="workspace-layout-title">Obszary robocze</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={17} /></button></header>
    <p>Zapisz otwarte notatki, widok siatki oraz ustawienia paneli, aby wrócić do tego układu później.</p>
    <form onSubmit={event => { event.preventDefault(); if (name.trim()) { onSave(name.trim()); setName('') } }}><input value={name} onChange={event => setName(event.target.value)} placeholder="Nazwa układu" aria-label="Nazwa układu" /><button type="submit" className="button primary" disabled={!name.trim()}>Zapisz bieżący</button></form>
    <div className="workspace-layout-list">{layouts.map(layout => <article key={layout.id}><span className="workspace-layout-icon"><LayoutTemplate size={16} /></span><div><strong>{layout.name}</strong><small>{layout.noteGridEnabled ? `${layout.noteGridIds.length} notatek w siatce` : 'Pojedyncza notatka'} · {layout.showFoldersPanel === false ? 'bez folderów' : 'foldery'} · {layout.showChat ? 'czat' : 'bez czatu'}</small></div><button type="button" className="button secondary" onClick={() => { onApply(layout); onClose() }}><Check size={14} />Otwórz</button><button type="button" className="icon-button danger-icon" aria-label={`Usuń układ ${layout.name}`} onClick={() => onDelete(layout.id)}><Trash2 size={15} /></button></article>)}{!layouts.length && <p className="empty-hint">Nie zapisano jeszcze układów.</p>}</div>
  </section></div>
}
