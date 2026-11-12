import { useState } from 'react'
import { Clock3, RotateCcw, X } from 'lucide-react'
import type { Note, NoteAttachment, NoteAttachmentReference, NoteVersion } from './types'
type HistoryField = 'content' | 'title' | 'folder' | 'tags' | 'aliases' | 'properties'

const dateTimeLabel = (value: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)

function sameVersion(left: Note, right: Note, leftAttachments?: NoteAttachmentReference[], rightAttachments: NoteAttachment[] = []) {
  const currentReferences = rightAttachments.map(attachment => ({ fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, contentHash: attachment.contentHash })).sort((a, b) => a.fileName.localeCompare(b.fileName, 'pl'))
  const savedReferences = leftAttachments?.slice().sort((a, b) => a.fileName.localeCompare(b.fileName, 'pl'))
  return left.title === right.title && left.content === right.content && left.folder === right.folder && left.color === right.color
    && left.favorite === right.favorite && JSON.stringify(left.tags) === JSON.stringify(right.tags)
    && JSON.stringify(left.aliases ?? []) === JSON.stringify(right.aliases ?? []) && JSON.stringify(left.properties ?? {}) === JSON.stringify(right.properties ?? {})
    && (leftAttachments === undefined || JSON.stringify(savedReferences) === JSON.stringify(currentReferences))
}

function lineDiff(left: string, right: string) {
  let before = left.split('\n')
  let after = right.split('\n')
  if (before.length * after.length > 2_000_000) {
    let prefix = 0
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
    let suffix = 0
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
    return [
      ...before.slice(0, prefix).map(text => ({ type: 'same' as const, text })),
      ...before.slice(prefix, before.length - suffix).map(text => ({ type: 'remove' as const, text })),
      ...after.slice(prefix, after.length - suffix).map(text => ({ type: 'add' as const, text })),
      ...before.slice(before.length - suffix).map(text => ({ type: 'same' as const, text })),
    ]
  }
  const width = after.length + 1
  const dp = new Uint16Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) {
    dp[i * width + j] = before[i] === after[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
  }
  const rows: { type: 'same' | 'add' | 'remove'; text: string }[] = []
  let i = 0, j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { rows.push({ type: 'same', text: before[i++] }); j++ }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) rows.push({ type: 'remove', text: before[i++] })
    else rows.push({ type: 'add', text: after[j++] })
  }
  while (i < before.length) rows.push({ type: 'remove', text: before[i++] })
  while (j < after.length) rows.push({ type: 'add', text: after[j++] })
  return rows
}

export function NoteHistoryDialog({ note, attachments, versions, loading, onRestore, onClose }: {
  note: Note
  attachments: NoteAttachment[]
  versions: NoteVersion[]
  loading: boolean
  onRestore: (version: NoteVersion, fields: HistoryField[]) => void
  onClose: () => void
}) {
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [restoreFields, setRestoreFields] = useState<HistoryField[]>(['content', 'title', 'folder', 'tags', 'aliases', 'properties'])
  const selectedVersion = versions.find(version => version.id === selectedVersionId) ?? versions[0]
  const currentIsSelected = selectedVersion ? sameVersion(selectedVersion.note, note, selectedVersion.attachments, attachments) : true

  return <div className="modal-backdrop history-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="note-history-dialog" role="dialog" aria-modal="true" aria-labelledby="note-history-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <header className="note-history-header"><span className="folder-dialog-mark"><Clock3 size={19} /></span><div><h2 id="note-history-title">Historia wersji</h2><p>{note.title || 'Bez tytułu'} · {versions.length} {versions.length === 1 ? 'zapis' : 'zapisów'}</p></div><button className="icon-button" type="button" aria-label="Zamknij historię wersji" onClick={onClose}><X size={17} /></button></header>
      <div className="note-history-body">
        <aside className="note-history-list" aria-label="Zapisane wersje">
          {versions.map(version => <button type="button" key={version.id} className={selectedVersion?.id === version.id ? 'active' : ''} onClick={() => setSelectedVersionId(version.id)}><time>{dateTimeLabel(version.createdAt)}</time><strong>{version.note.title || 'Bez tytułu'}</strong><span>{version.note.content.replace(/\s+/g, ' ').trim().slice(0, 90) || 'Pusta notatka'}</span></button>)}
          {!versions.length && !loading && <p>Historia pojawi się po pierwszych zmianach.</p>}
          {loading && <p>Wczytuję historię…</p>}
        </aside>
        <div className="note-history-comparison">
          {selectedVersion ? <>
            <div className="note-history-diff" aria-label="Różnice względem bieżącej wersji">{lineDiff(selectedVersion.note.content, note.content).map((row, index) => <div key={`${row.type}:${index}`} className={`note-diff-line ${row.type}`}><span>{row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}</span><code>{row.text || ' '}</code></div>)}</div>
            <div className="note-history-columns">
              <section><h3>Wybrana wersja <time>{dateTimeLabel(selectedVersion.createdAt)}</time></h3><pre>{selectedVersion.note.content || 'Pusta notatka'}</pre></section>
              <section><h3>Obecna treść</h3><pre>{note.content || 'Pusta notatka'}</pre></section>
            </div>
            <div className="note-history-attachment-summary"><span><strong>Załączniki w wersji:</strong> {selectedVersion.attachments === undefined ? 'brak danych dla tej starszej wersji' : selectedVersion.attachments.map(attachment => attachment.fileName).join(', ') || 'brak'}</span><span><strong>Obecne załączniki:</strong> {attachments.map(attachment => attachment.fileName).join(', ') || 'brak'}</span></div>
            <div className="note-history-actions"><div className="note-history-fields">{([['content', 'Treść'], ['title', 'Tytuł'], ['folder', 'Folder'], ['tags', 'Tagi'], ['aliases', 'Aliasy'], ['properties', 'Właściwości']] as [HistoryField, string][]).map(([field, label]) => <label key={field}><input type="checkbox" checked={restoreFields.includes(field)} onChange={event => setRestoreFields(current => event.target.checked ? [...current, field] : current.filter(item => item !== field))} />{label}</label>)}</div><span>{currentIsSelected ? 'Ta wersja jest już aktywna.' : 'Wybierz, co przywrócić.'}</span><button type="button" className="button primary" disabled={currentIsSelected || loading || !restoreFields.length} onClick={() => onRestore(selectedVersion, restoreFields)}><RotateCcw size={15} />Przywróć wybrane</button></div>
          </> : <div className="note-history-empty"><Clock3 size={22} /><span>Brak zapisanych wersji tej notatki.</span></div>}
        </div>
      </div>
    </section>
  </div>
}
