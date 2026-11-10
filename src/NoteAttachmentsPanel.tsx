import { useRef, useState } from 'react'
import { FileText, ImagePlus, Trash2, X } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function NoteAttachmentsPanel({ attachments, onAdd, onRemove }: { attachments: NoteAttachment[]; onAdd: (files: File[]) => void; onRemove: (attachment: NoteAttachment) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<NoteAttachment | null>(null)
  return <section className="note-attachments-panel" aria-label="Załączniki notatki">
    <div className="note-attachments-heading"><div><strong>Załączniki</strong><span>{attachments.length} plików</span></div><button type="button" className="button secondary" onClick={() => input.current?.click()}><ImagePlus size={14} />Dodaj plik</button><input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,.pdf" multiple hidden onChange={event => { if (event.currentTarget.files?.length) onAdd(Array.from(event.currentTarget.files)); event.currentTarget.value = '' }} /></div>
    {attachments.length ? <div className="note-attachments-grid">{attachments.map(attachment => <article className="attachment-card" key={attachment.id}><button className="attachment-preview-button" type="button" onClick={() => setPreview(attachment)} aria-label={`Podgląd: ${attachment.fileName}`}>{attachment.mimeType.startsWith('image/') ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="attachment-pdf-icon"><FileText size={25} /><small>PDF</small></span>}<span className="attachment-file-name">{attachment.fileName}</span><small>{sizeLabel(attachment.size)}</small></button><button className="attachment-delete" type="button" aria-label={`Usuń załącznik ${attachment.fileName}`} onClick={() => onRemove(attachment)}><Trash2 size={14} /></button></article>)}</div> : <p className="attachment-empty">Dodaj obraz lub plik PDF, aby mieć go przy tej notatce.</p>}
    {preview && <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null) }}><section className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-label={`Podgląd ${preview.fileName}`}><header><div><strong>{preview.fileName}</strong><span>{sizeLabel(preview.size)}</span></div><a href={preview.dataUrl} download={preview.fileName} className="button secondary">Pobierz</a><button type="button" className="icon-button" aria-label="Zamknij podgląd" onClick={() => setPreview(null)}><X size={17} /></button></header>{preview.mimeType.startsWith('image/') ? <img className="attachment-large-image" src={preview.dataUrl} alt={preview.fileName} /> : <iframe title={`Podgląd ${preview.fileName}`} src={preview.dataUrl} />}</section></div>}
  </section>
}
