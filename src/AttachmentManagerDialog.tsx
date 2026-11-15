import { useMemo, useState } from 'react'
import { ArrowLeft, FileAudio2, FileText, Image, Search, ScanText, Trash2 } from 'lucide-react'
import type { Note, NoteAttachment } from './types'

export function AttachmentManagerPage({ notes, attachments, indexing, onOpenNote, onPreview, onDelete, onIndex, onClose }: {
  notes: Note[]
  attachments: NoteAttachment[]
  indexing?: string
  onOpenNote: (noteId: string) => void
  onPreview: (attachment: NoteAttachment) => void
  onDelete: (attachment: NoteAttachment) => void
  onIndex?: (attachment: NoteAttachment) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const noteNames = useMemo(() => new Map(notes.map(note => [note.id, note.title || 'Bez tytułu'])), [notes])
  const visible = useMemo(() => attachments.filter(attachment => {
    const audio = attachment.mimeType.startsWith('audio/')
    const image = attachment.mimeType.startsWith('image/')
    const typeMatch = kind === 'all' || kind === 'audio' && audio || kind === 'image' && image || kind === 'pdf' && attachment.mimeType === 'application/pdf'
    const haystack = `${attachment.fileName} ${noteNames.get(attachment.noteId)} ${attachment.transcript ?? ''} ${attachment.extractedText ?? ''}`.toLocaleLowerCase('pl')
    return typeMatch && haystack.includes(query.trim().toLocaleLowerCase('pl'))
  }), [attachments, kind, query, noteNames])
  return <section className="workspace-tool-page attachment-manager-page" aria-labelledby="attachment-manager-title">
    <header className="workspace-tool-heading"><span className="workspace-tool-mark"><FileText size={21} /></span><div><p className="eyebrow">NARZĘDZIA</p><h1 id="attachment-manager-title">Załączniki</h1><p>{attachments.length} plików · {attachments.filter(item => !notes.some(note => note.id === item.noteId)).length} bez notatki</p></div><button type="button" className="icon-button" aria-label="Wróć do notatek" title="Wróć do notatek" onClick={onClose}><ArrowLeft size={17} /></button></header>
    <div className="workspace-tool-content attachment-manager-content">
      <div className="attachment-manager-filters"><label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj w nazwach i rozpoznanym tekście…" /></label><select value={kind} onChange={event => setKind(event.target.value)} aria-label="Rodzaj załącznika"><option value="all">Wszystkie typy</option><option value="pdf">PDF</option><option value="image">Obrazy</option><option value="audio">Audio</option></select></div>
      <div className="attachment-manager-list">{visible.map(attachment => { const Icon = attachment.mimeType.startsWith('audio/') ? FileAudio2 : attachment.mimeType.startsWith('image/') ? Image : FileText; return <article className="attachment-manager-row" key={attachment.id}><Icon size={17} /><div><strong>{attachment.fileName}</strong><small>{noteNames.get(attachment.noteId) ?? 'Osierocony załącznik'}{attachment.extractedText ? ' · tekst zaindeksowany' : ''}{attachment.transcript ? ' · ma transkrypcję' : ''}</small></div>{onIndex && (attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf') && <button type="button" className="icon-button" title={indexing === attachment.id ? 'Indeksuję…' : attachment.extractedText ? 'Odśwież indeks tekstu' : 'Indeksuj tekst'} disabled={indexing === attachment.id} onClick={() => onIndex(attachment)}><ScanText size={15} /></button>}<button type="button" className="button secondary" onClick={() => onOpenNote(attachment.noteId)}>Notatka</button><button type="button" className="icon-button" title="Podgląd" onClick={() => onPreview(attachment)}><FileText size={15} /></button><button type="button" className="icon-button danger-icon" title="Usuń załącznik" onClick={() => onDelete(attachment)}><Trash2 size={15} /></button></article> })}{!visible.length && <div className="attachment-manager-empty">Brak pasujących załączników.</div>}</div>
      <footer>Indeks tekstowy oraz transkrypcje są przechowywane osobno od pliku załącznika.</footer>
    </div>
  </section>
}
