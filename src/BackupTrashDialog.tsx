import { useState } from 'react'
import { Archive, Download, HardDriveDownload, RotateCcw, Trash2, X } from 'lucide-react'
import type { AutoBackupInfo } from './storage'
import type { TrashEntry } from './types'

const dateTime = (value: number) => new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function BackupTrashDialog({ backups, trash, busy, onCreateBackup, onDownloadBackup, onRestoreBackup, onDeleteBackup, onRestoreTrash, onDeleteTrash, onEmptyTrash, onClose }: {
  backups: AutoBackupInfo[]
  trash: TrashEntry[]
  busy: boolean
  onCreateBackup: () => void
  onDownloadBackup: (fileName: string) => void
  onRestoreBackup: (fileName: string) => void
  onDeleteBackup: (fileName: string) => void
  onRestoreTrash: (entryId: string) => void
  onDeleteTrash: (entryId: string) => void
  onEmptyTrash: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'backups' | 'trash'>('backups')
  const [restoreTarget, setRestoreTarget] = useState('')
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="backup-trash-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-trash-title" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <header><span className="folder-dialog-mark">{tab === 'backups' ? <Archive size={19} /> : <Trash2 size={19} />}</span><div><h2 id="backup-trash-title">Kopie zapasowe i kosz</h2><p>Kopie są automatycznie rotowane; usunięte notatki można odzyskać przez 30 dni.</p></div><button className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header>
      <div className="backup-trash-tabs" role="tablist"><button role="tab" aria-selected={tab === 'backups'} className={tab === 'backups' ? 'active' : ''} onClick={() => setTab('backups')}>Kopie zapasowe <span>{backups.length}</span></button><button role="tab" aria-selected={tab === 'trash'} className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>Kosz <span>{trash.length}</span></button></div>
      {tab === 'backups' ? <>
        <div className="backup-trash-toolbar"><span>Automatyczne kopie tworzą się raz dziennie podczas uruchomienia aplikacji. Zachowujemy 7 najnowszych.</span><button className="button primary" disabled={busy} onClick={onCreateBackup}><HardDriveDownload size={15} />Utwórz kopię teraz</button></div>
        <div className="backup-trash-list">{backups.map(backup => <article key={backup.fileName}><Archive size={16} /><div><strong>{dateTime(backup.createdAt)}</strong><small>{backup.fileName} · {sizeLabel(backup.size)}</small></div><button className="icon-button" title="Pobierz kopię" aria-label={`Pobierz kopię ${backup.fileName}`} onClick={() => onDownloadBackup(backup.fileName)}><Download size={15} /></button><button className="icon-button" title="Przywróć kopię" aria-label={`Przywróć kopię ${backup.fileName}`} disabled={busy} onClick={() => setRestoreTarget(backup.fileName)}><RotateCcw size={15} /></button><button className="icon-button danger-icon" title="Usuń kopię" aria-label={`Usuń kopię ${backup.fileName}`} onClick={() => onDeleteBackup(backup.fileName)}><Trash2 size={15} /></button></article>)}{!backups.length && <p className="backup-trash-empty">Nie ma jeszcze kopii. Możesz utworzyć ją ręcznie.</p>}</div>
        {restoreTarget && <div className="backup-restore-confirm"><strong>Przywrócić tę kopię?</strong><span>Zawartość obecnej biblioteki zostanie zastąpiona zawartością kopii. Przed dalszymi zmianami utwórz kopię bieżących danych.</span><div><button className="button secondary" onClick={() => setRestoreTarget('')}>Anuluj</button><button className="button danger-button" disabled={busy} onClick={() => { onRestoreBackup(restoreTarget); setRestoreTarget('') }}><RotateCcw size={14} />Zastąp bibliotekę</button></div></div>}
      </> : <>
        <div className="backup-trash-toolbar"><span>Notatki trafiają do kosza razem z załącznikami i zachowują swoje foldery.</span><button className="button danger-button" disabled={!trash.length || busy} onClick={onEmptyTrash}><Trash2 size={15} />Opróżnij kosz</button></div>
        <div className="backup-trash-list">{trash.map(entry => <article key={entry.id}><Trash2 size={16} /><div><strong>{entry.note.title || 'Bez tytułu'}</strong><small>{entry.note.folder || 'Bez folderu'} · usunięto {dateTime(entry.deletedAt)}</small></div><button className="icon-button" title="Przywróć notatkę" aria-label={`Przywróć ${entry.note.title}`} disabled={busy} onClick={() => onRestoreTrash(entry.id)}><RotateCcw size={15} /></button><button className="icon-button danger-icon" title="Usuń trwale" aria-label={`Usuń trwale ${entry.note.title}`} disabled={busy} onClick={() => onDeleteTrash(entry.id)}><Trash2 size={15} /></button></article>)}{!trash.length && <p className="backup-trash-empty">Kosz jest pusty.</p>}</div>
      </>}
    </section>
  </div>
}
