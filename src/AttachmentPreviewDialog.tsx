import { Download, X } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function AttachmentPreviewDialog({ attachment, onClose }: { attachment: NoteAttachment; onClose: () => void }) {
  return <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="attachment-preview-dialog" role="dialog" aria-modal="true" aria-label={`Podgląd ${attachment.fileName}`}>
      <header><div><strong>{attachment.fileName}</strong><span>{sizeLabel(attachment.size)}</span></div><a href={attachment.dataUrl} download={attachment.fileName} className="button secondary"><Download size={14} />Pobierz</a><button type="button" className="icon-button" aria-label="Zamknij podgląd" onClick={onClose}><X size={17} /></button></header>
      {attachment.mimeType.startsWith('image/') ? <img className="attachment-large-image" src={attachment.dataUrl} alt={attachment.fileName} /> : attachment.mimeType.startsWith('audio/') ? <div className="attachment-audio-preview"><audio controls autoPlay src={attachment.dataUrl} aria-label={`Odtwórz ${attachment.fileName}`} /></div> : <iframe title={`Podgląd ${attachment.fileName}`} src={attachment.dataUrl} />}
    </section>
  </div>
}
