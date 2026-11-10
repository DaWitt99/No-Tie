import { useState } from 'react'
import { Clock3, RotateCcw, X } from 'lucide-react'
import type { Note, NoteVersion } from './types'

const dateTimeLabel = (value: number) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)

function sameVersion(left: Note, right: Note) {
  return left.title === right.title && left.content === right.content && left.folder === right.folder && left.color === right.color
    && left.favorite === right.favorite && JSON.stringify(left.tags) === JSON.stringify(right.tags)
}

export function NoteHistoryDialog({ note, versions, loading, onRestore, onClose }: {
  note: Note
  versions: NoteVersion[]
  loading: boolean
  onRestore: (version: NoteVersion) => void
  onClose: () => void
}) {
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const selectedVersion = versions.find(version => version.id === selectedVersionId) ?? versions[0]
  const currentIsSelected = selectedVersion ? sameVersion(selectedVersion.note, note) : true

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
            <div className="note-history-columns">
              <section><h3>Wybrana wersja <time>{dateTimeLabel(selectedVersion.createdAt)}</time></h3><pre>{selectedVersion.note.content || 'Pusta notatka'}</pre></section>
              <section><h3>Obecna treść</h3><pre>{note.content || 'Pusta notatka'}</pre></section>
            </div>
            <div className="note-history-actions"><span>{currentIsSelected ? 'Ta wersja jest już aktywna.' : 'Przywrócenie zapisze obecną treść jako kolejną wersję.'}</span><button type="button" className="button primary" disabled={currentIsSelected || loading} onClick={() => onRestore(selectedVersion)}><RotateCcw size={15} />Przywróć tę wersję</button></div>
          </> : <div className="note-history-empty"><Clock3 size={22} /><span>Brak zapisanych wersji tej notatki.</span></div>}
        </div>
      </div>
    </section>
  </div>
}
