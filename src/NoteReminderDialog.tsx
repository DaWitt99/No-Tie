import { useState, type FormEvent } from 'react'
import { Bell, X } from 'lucide-react'
import type { Note } from './types'

export function NoteReminderDialog({ note, onSave, onClose }: { note: Note; onSave: (value: string) => void; onClose: () => void }) {
  const current = note.properties?.['no-tie-remind-at'] ?? ''
  const [value, setValue] = useState(current)
  function submit(event: FormEvent) { event.preventDefault(); onSave(value); onClose() }
  return <div className="modal-backdrop note-reminder-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="folder-dialog note-reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="note-reminder-title"><div className="folder-dialog-mark"><Bell size={19} /></div><button type="button" className="icon-button app-lock-close" aria-label="Zamknij" onClick={onClose}><X size={16} /></button><h2 id="note-reminder-title">Przypomnij o notatce</h2><p>{note.title || 'Bez tytułu'}</p><form onSubmit={submit}><label htmlFor="note-reminder-date">Termin</label><input id="note-reminder-date" type="datetime-local" value={value} onChange={event => setValue(event.target.value)} /><div className="folder-dialog-actions"><button type="button" className="button secondary" onClick={() => { onSave(''); onClose() }}>Usuń przypomnienie</button><button type="submit" className="button primary" disabled={!value}>Zapisz</button></div></form></section></div>
}
