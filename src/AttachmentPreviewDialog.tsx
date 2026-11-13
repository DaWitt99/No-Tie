import { useEffect, useState } from 'react'
import { Download, FileText, Sparkles, X } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
type PdfAnnotation = NonNullable<NoteAttachment['pdfAnnotations']>[number]

export function AttachmentPreviewDialog({ attachment, onClose, annotationsEnabled = false, transcriptTimestampsEnabled = true, initialPage = 1, onSaveAnnotations, onGenerateFlashcardsFromPage }: {
  attachment: NoteAttachment
  onClose: () => void
  annotationsEnabled?: boolean
  transcriptTimestampsEnabled?: boolean
  initialPage?: number
  onSaveAnnotations?: (attachment: NoteAttachment, annotations: PdfAnnotation[]) => void
  onGenerateFlashcardsFromPage?: (attachment: NoteAttachment, page: number) => void
}) {
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [annotationText, setAnnotationText] = useState('')
  const [annotationQuote, setAnnotationQuote] = useState('')
  const isPdf = attachment.mimeType === 'application/pdf'
  useEffect(() => setPage(Math.max(1, initialPage)), [attachment.id, initialPage])

  function saveAnnotation() {
    const text = annotationText.trim()
    if (!text || !onSaveAnnotations) return
    const next: PdfAnnotation[] = [...(attachment.pdfAnnotations ?? []), { id: crypto.randomUUID(), page, text, quote: annotationQuote.trim() || undefined, createdAt: Date.now() }]
    onSaveAnnotations(attachment, next)
    setAnnotationText('')
    setAnnotationQuote('')
  }

  return <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`attachment-preview-dialog ${isPdf && annotationsEnabled ? 'has-pdf-annotations' : ''}`} role="dialog" aria-modal="true" aria-label={`Podgląd ${attachment.fileName}`}>
      <header><div><strong>{attachment.fileName}</strong><span>{sizeLabel(attachment.size)}</span></div>{isPdf && <label className="attachment-page-picker">Strona<input aria-label="Numer strony PDF" type="number" min="1" value={page} onChange={event => setPage(Math.max(1, Number(event.target.value) || 1))} /></label>}{isPdf && onGenerateFlashcardsFromPage && <button type="button" className="button secondary" onClick={() => onGenerateFlashcardsFromPage(attachment, page)}><Sparkles size={14} />Fiszki z tej strony</button>}<a href={attachment.dataUrl} download={attachment.fileName} className="button secondary"><Download size={14} />Pobierz</a><button type="button" className="icon-button" aria-label="Zamknij podgląd" onClick={onClose}><X size={17} /></button></header>
      {attachment.mimeType.startsWith('image/') ? <img className="attachment-large-image" src={attachment.dataUrl} alt={attachment.fileName} /> : attachment.mimeType.startsWith('audio/') ? <div className="attachment-audio-preview"><audio controls autoPlay src={attachment.dataUrl} aria-label={`Odtwórz ${attachment.fileName}`} /><section className="attachment-audio-transcript" aria-label={`Transkrypcja ${attachment.fileName}`}><strong>Transkrypcja nagrania</strong>{attachment.transcript?.trim() ? <p>{attachment.transcript}</p> : <p className="attachment-audio-transcript-empty">Brak zapisanej transkrypcji.</p>}{transcriptTimestampsEnabled && attachment.transcriptSegments?.length ? <ol className="transcript-segment-list">{attachment.transcriptSegments.map((segment, index) => <li key={`${segment.startMs}-${index}`}><button type="button" onClick={event => { const player = event.currentTarget.closest('.attachment-audio-preview')?.querySelector('audio'); if (player) player.currentTime = segment.startMs / 1000 }}><time>{`${Math.floor(segment.startMs / 60000)}:${String(Math.floor(segment.startMs / 1000) % 60).padStart(2, '0')}`}</time>{segment.speaker && <b>{segment.speaker}: </b>}{segment.text}</button></li>)}</ol> : null}</section></div> : isPdf ? <div className="pdf-preview-layout"><iframe title={`Podgląd ${attachment.fileName}`} src={`${attachment.dataUrl}#page=${page}`} />{annotationsEnabled && <aside className="pdf-annotation-panel"><div className="pdf-annotation-heading"><FileText size={16} /><strong>Adnotacje</strong></div><label>Strona<input type="number" min="1" value={page} onChange={event => setPage(Math.max(1, Number(event.target.value) || 1))} /></label><label>Cytat (opcjonalnie)<textarea rows={2} value={annotationQuote} onChange={event => setAnnotationQuote(event.target.value)} placeholder="Fragment dokumentu" /></label><label>Notatka<textarea rows={3} value={annotationText} onChange={event => setAnnotationText(event.target.value)} placeholder="Dodaj własną uwagę" /></label><button type="button" className="button primary" disabled={!annotationText.trim()} onClick={saveAnnotation}>Zapisz adnotację</button><div className="pdf-annotation-list">{(attachment.pdfAnnotations ?? []).map(annotation => <article key={annotation.id}><button type="button" className="pdf-annotation-page" onClick={() => setPage(annotation.page)}>Strona {annotation.page}</button>{annotation.quote && <blockquote>{annotation.quote}</blockquote>}<p>{annotation.text}</p></article>)}{!attachment.pdfAnnotations?.length && <small>Adnotacje są zapisywane w metadanych załącznika.</small>}</div></aside>}</div> : <iframe title={`Podgląd ${attachment.fileName}`} src={attachment.dataUrl} />}
    </section>
  </div>
}
