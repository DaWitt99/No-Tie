import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Link2, Save, Sparkles, X } from 'lucide-react'
import type { NoteAttachment } from './types'

const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
type PdfAnnotation = NonNullable<NoteAttachment['pdfAnnotations']>[number]
type AttachmentMetadata = Pick<NoteAttachment, 'author' | 'documentDate' | 'description'>
const timestampLabel = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`

export function AttachmentPreviewDialog({ attachment, onClose, annotationsEnabled = false, transcriptTimestampsEnabled = true, initialPage = 1, initialQuote = '', onSaveAnnotations, onSaveMetadata, onInsertDocumentLink, onGenerateFlashcardsFromPage }: {
  attachment: NoteAttachment
  onClose: () => void
  annotationsEnabled?: boolean
  transcriptTimestampsEnabled?: boolean
  initialPage?: number
  initialQuote?: string
  onSaveAnnotations?: (attachment: NoteAttachment, annotations: PdfAnnotation[]) => void
  onSaveMetadata?: (attachment: NoteAttachment, metadata: AttachmentMetadata) => void
  onInsertDocumentLink?: (attachment: NoteAttachment, page: number, fragment?: string) => void
  onGenerateFlashcardsFromPage?: (attachment: NoteAttachment, page: number) => void
}) {
  const hasMetadata = Boolean(attachment.author || attachment.documentDate || attachment.description)
  const [page, setPage] = useState(Math.max(1, initialPage))
  const [annotationText, setAnnotationText] = useState('')
  const [annotationQuote, setAnnotationQuote] = useState('')
  const [author, setAuthor] = useState(attachment.author ?? '')
  const [documentDate, setDocumentDate] = useState(attachment.documentDate ?? '')
  const [description, setDescription] = useState(attachment.description ?? '')
  const [linkFragment, setLinkFragment] = useState(initialQuote)
  const [metadataOpen, setMetadataOpen] = useState(hasMetadata)
  const audioPlayer = useRef<HTMLAudioElement>(null)
  const isPdf = attachment.mimeType === 'application/pdf'
  useEffect(() => {
    setPage(Math.max(1, initialPage))
    setAuthor(attachment.author ?? '')
    setDocumentDate(attachment.documentDate ?? '')
    setDescription(attachment.description ?? '')
    setLinkFragment(initialQuote)
    if (attachment.author || attachment.documentDate || attachment.description) setMetadataOpen(true)
  }, [attachment.id, attachment.author, attachment.documentDate, attachment.description, initialPage])

  function saveAnnotation() {
    const text = annotationText.trim()
    if (!text || !onSaveAnnotations) return
    const next: PdfAnnotation[] = [...(attachment.pdfAnnotations ?? []), { id: crypto.randomUUID(), page, text, quote: annotationQuote.trim() || undefined, createdAt: Date.now() }]
    onSaveAnnotations(attachment, next)
    setAnnotationText('')
    setAnnotationQuote('')
  }

  function saveMetadata() {
    if (!onSaveMetadata) return
    onSaveMetadata(attachment, { author: author.trim() || undefined, documentDate: documentDate || undefined, description: description.trim() || undefined })
  }

  function jumpToSegment(startMs: number) {
    const player = audioPlayer.current
    if (!player) return
    player.currentTime = startMs / 1000
    void player.play().catch(() => {})
  }

  return <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`attachment-preview-dialog ${isPdf && annotationsEnabled ? 'has-pdf-annotations' : ''}`} role="dialog" aria-modal="true" aria-label={`Podgląd ${attachment.fileName}`}>
      <header>
        <div><strong>{attachment.fileName}</strong><span>{sizeLabel(attachment.size)}</span></div>
        {isPdf && <label className="attachment-page-picker">Strona<input aria-label="Numer strony PDF" type="number" min="1" value={page} onChange={event => setPage(Math.max(1, Number(event.target.value) || 1))} /></label>}
        {isPdf && onInsertDocumentLink && <button type="button" className="button secondary attachment-page-link-button" onClick={() => onInsertDocumentLink(attachment, page)}><Link2 size={14} />Link do strony</button>}
        {isPdf && onGenerateFlashcardsFromPage && <button type="button" className="button secondary" onClick={() => onGenerateFlashcardsFromPage(attachment, page)}><Sparkles size={14} />Fiszki z tej strony</button>}
        <a href={attachment.dataUrl} download={attachment.fileName} className="button secondary"><Download size={14} />Pobierz</a>
        <button type="button" className="icon-button" aria-label="Zamknij podgląd" onClick={onClose}><X size={17} /></button>
      </header>

      {onSaveMetadata && <details className="attachment-metadata-editor" open={metadataOpen} onToggle={event => setMetadataOpen(event.currentTarget.open)}>
        <summary>Metadane załącznika <span>{[author, documentDate, description].filter(Boolean).length ? '· zapisane informacje' : '· dodaj autora, datę lub opis'}</span></summary>
        <div className="attachment-metadata-fields">
          <label>Autor<input value={author} onChange={event => setAuthor(event.target.value)} placeholder="np. Jan Kowalski" /></label>
          <label>Data dokumentu<input type="date" value={documentDate} onChange={event => setDocumentDate(event.target.value)} /></label>
          <label className="attachment-description-field">Opis<textarea value={description} onChange={event => setDescription(event.target.value)} rows={2} placeholder="Krótki opis, źródło lub kontekst" /></label>
          <button type="button" className="button primary" onClick={saveMetadata}><Save size={13} />Zapisz metadane</button>
        </div>
      </details>}

      {isPdf && onInsertDocumentLink && <details className="attachment-source-link-tools">
        <summary>Utwórz odnośnik do strony lub fragmentu</summary>
        <div><label>Fragment tekstu (opcjonalnie)<textarea value={linkFragment} onChange={event => setLinkFragment(event.target.value)} rows={2} placeholder="Wklej cytat albo charakterystyczny fragment strony" /></label><button type="button" className="button secondary" onClick={() => onInsertDocumentLink(attachment, page, linkFragment)}><Link2 size={13} />Wstaw odnośnik · strona {page}</button></div>
      </details>}

      {initialQuote && <p className="attachment-preview-fragment"><strong>Fragment źródłowy</strong><span>{initialQuote}</span></p>}
      {attachment.mimeType.startsWith('image/') ? <img className="attachment-large-image" src={attachment.dataUrl} alt={attachment.fileName} />
        : attachment.mimeType.startsWith('audio/') ? <div className="attachment-audio-preview"><audio ref={audioPlayer} controls autoPlay src={attachment.dataUrl} aria-label={`Odtwórz ${attachment.fileName}`} /><section className="attachment-audio-transcript" aria-label={`Transkrypcja ${attachment.fileName}`}><strong>Transkrypcja nagrania</strong>{attachment.transcript?.trim() ? <p>{attachment.transcript}</p> : <p className="attachment-audio-transcript-empty">Brak zapisanej transkrypcji.</p>}{transcriptTimestampsEnabled && attachment.transcriptSegments?.length ? <ol className="transcript-segment-list">{attachment.transcriptSegments.map((segment, index) => <li key={`${segment.startMs}-${index}`}><button type="button" onClick={() => jumpToSegment(segment.startMs)}><time>{timestampLabel(segment.startMs)}</time>{segment.speaker && <b>{segment.speaker}: </b>}{segment.text}</button></li>)}</ol> : null}</section></div>
        : attachment.mimeType.startsWith('video/') ? <div className="attachment-video-preview"><video controls autoPlay src={attachment.dataUrl} aria-label={`Odtwórz ${attachment.fileName}`} /></div>
          : isPdf ? <div className="pdf-preview-layout"><iframe title={`Podgląd ${attachment.fileName}`} src={`${attachment.dataUrl}#page=${page}${initialQuote ? `&search=${encodeURIComponent(initialQuote)}` : ''}`} />{annotationsEnabled && <aside className="pdf-annotation-panel"><div className="pdf-annotation-heading"><FileText size={16} /><strong>Adnotacje</strong></div><label>Strona<input type="number" min="1" value={page} onChange={event => setPage(Math.max(1, Number(event.target.value) || 1))} /></label><label>Cytat / fragment (opcjonalnie)<textarea rows={2} value={annotationQuote} onChange={event => setAnnotationQuote(event.target.value)} placeholder="Wklej fragment dokumentu" /></label><div className="pdf-annotation-actions"><button type="button" className="button secondary" disabled={!onInsertDocumentLink} onClick={() => onInsertDocumentLink?.(attachment, page, annotationQuote)}><Link2 size={13} />Wstaw link do fragmentu</button></div><label>Notatka<textarea rows={3} value={annotationText} onChange={event => setAnnotationText(event.target.value)} placeholder="Dodaj własną uwagę" /></label><button type="button" className="button primary" disabled={!annotationText.trim()} onClick={saveAnnotation}>Zapisz adnotację</button><div className="pdf-annotation-list">{(attachment.pdfAnnotations ?? []).map(annotation => <article key={annotation.id}><div><button type="button" className="pdf-annotation-page" onClick={() => setPage(annotation.page)}>Strona {annotation.page}</button>{annotation.quote && <button type="button" className="pdf-annotation-link" onClick={() => onInsertDocumentLink?.(attachment, annotation.page, annotation.quote)} title="Wstaw odnośnik do zapisanego cytatu"><Link2 size={12} /></button>}</div>{annotation.quote && <blockquote>{annotation.quote}</blockquote>}<p>{annotation.text}</p></article>)}{!attachment.pdfAnnotations?.length && <small>Adnotacje są zapisywane przy załączniku.</small>}</div></aside>}</div>
            : <iframe title={`Podgląd ${attachment.fileName}`} src={attachment.dataUrl} />}
    </section>
  </div>
}
