import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Note } from './types'

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const monthTitle = (date: Date) => new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(date)

export function DailyNotesDialog({ notes, onSelect, onClose }: { notes: Note[]; onSelect: (date: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [today] = useState(() => dateKey(new Date()))
  const noteDates = useMemo(() => new Set(notes.map(note => note.dailyDate).filter((value): value is string => Boolean(value))), [notes])
  const startOffset = (month.getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - startOffset + 1))
  return <div className="modal-backdrop daily-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="daily-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-notes-title">
      <header><span className="folder-dialog-mark"><CalendarDays size={19} /></span><div><h2 id="daily-notes-title">Notatki dzienne</h2><p>Wybierz datę, aby otworzyć lub utworzyć wpis.</p></div><button className="icon-button" type="button" aria-label="Zamknij kalendarz" onClick={onClose}><X size={17} /></button></header>
      <div className="daily-calendar-controls"><button type="button" className="icon-button" aria-label="Poprzedni miesiąc" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong>{monthTitle(month)}</strong><button type="button" className="icon-button" aria-label="Następny miesiąc" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={17} /></button><button className="button secondary" type="button" onClick={() => onSelect(today)}>Dzisiaj</button></div>
      <div className="daily-calendar-grid" role="grid" aria-label={monthTitle(month)}>
        {['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map(day => <span className="daily-weekday" key={day}>{day}</span>)}
        {days.map(date => { const key = dateKey(date); const inMonth = date.getMonth() === month.getMonth(); return <button type="button" role="gridcell" key={key} className={`daily-day ${inMonth ? '' : 'outside'} ${key === today ? 'today' : ''} ${noteDates.has(key) ? 'has-daily-note' : ''}`} aria-label={`${date.toLocaleDateString('pl-PL')}${noteDates.has(key) ? ', ma notatkę' : ''}`} onClick={() => onSelect(key)}><span>{date.getDate()}</span>{noteDates.has(key) && <i />}</button> })}
      </div>
      <footer><span><i className="daily-note-dot" />Dzień z zapisaną notatką</span><span>Wpisy są zwykłymi notatkami Markdown.</span></footer>
    </section>
  </div>
}
