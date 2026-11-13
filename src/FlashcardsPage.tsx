import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Bell, Bold, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Code2, Flame, ImagePlus, Italic, Layers, Pause, Pencil, Play, Plus, Search, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
import type { Flashcard, FlashcardImageOcclusion, FlashcardKind, Note } from './types'
import type { FlashcardGrade } from './flashcards'
import { resolveWikiTarget } from './knowledge'

type FlashcardDeck = { id: string; name: string; noteIds: string[]; includeUnlinkedCards: boolean }
type FlashcardSort = 'due' | 'hardest' | 'question' | 'recent'
type SessionMode = 'due' | 'all'
type FlashcardEdit = Pick<Flashcard, 'question' | 'answer' | 'kind' | 'tags' | 'imageOcclusion'>
type RegeneratedContent = { question: string; answer: string }
type SimilarFlashcardMatch = { firstId: string; secondId: string; score: number }

const DECK_STORAGE_KEY = 'no-tie-flashcard-decks'
const FLASHCARD_REMINDER_KEY = 'no-tie-flashcard-reminder'
const FLASHCARD_GOAL_KEY = 'no-tie-flashcard-daily-goal'
const CLOZE_PATTERN = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi
const REVIEW_INTERVALS: Record<string, number> = { hour: 60 * 60_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }

function readDecks(): FlashcardDeck[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is FlashcardDeck => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.noteIds) && item.noteIds.every((id: unknown) => typeof id === 'string') && typeof item.includeUnlinkedCards === 'boolean')) : []
  } catch { return [] }
}

function readReminderPreference() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FLASHCARD_REMINDER_KEY) ?? '{}')
    if (value && typeof value === 'object') {
      const item = value as { enabled?: unknown; time?: unknown }
      return { enabled: item.enabled === true, time: typeof item.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) ? item.time : '09:00' }
    }
  } catch { /* Use the default reminder settings when browser storage is unavailable. */ }
  return { enabled: false, time: '09:00' }
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeQuestion(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function hasCloze(value: string) { return /\{\{c\d+::[\s\S]*?\}\}/i.test(value) }
function hasOcclusionAnswers(value?: FlashcardImageOcclusion) { return Boolean(value?.imageDataUrl && value.regions.length && value.regions.every(region => region.label.trim())) }

function dateTimeLocal(value: number) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clozeText(value: string, reveal: boolean) {
  return value.replace(CLOZE_PATTERN, (_match, answer: string, hint?: string) => reveal ? answer : `[${hint || '…'}]`)
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function markdownToSafeHtml(value: string) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\((data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)\)/gi, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
}

function RichCardContent({ value, className = '' }: { value: string; className?: string }) {
  return <div className={`flashcard-rich-content ${className}`} dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(value) }} />
}

function FlashcardContentField({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState('')

  function insertAtSelection(text: string, selectionOffset = text.length) {
    const element = textarea.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`)
    window.requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + selectionOffset, start + selectionOffset)
    })
  }

  function wrapSelection(before: string, after: string) {
    const element = textarea.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    const selected = value.slice(start, end) || 'tekst'
    onChange(`${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`)
    window.requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function addImage(file?: File) {
    if (!file) return
    setImageError('')
    if (file.size > 4 * 1024 * 1024) {
      setImageError('Obraz musi mieć maksymalnie 4 MB.')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setImageError('Nie udało się wczytać obrazu.')
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        const name = file.name.replace(/[\[\]()]/g, ' ').trim() || 'obraz'
        insertAtSelection(`![${name}](${reader.result})`)
      } else setImageError('Ten format obrazu nie jest obsługiwany.')
    }
    reader.readAsDataURL(file)
  }

  return <div className="flashcard-content-field">
    <label><span>{label}</span><textarea ref={textarea} value={value} onChange={event => onChange(event.target.value)} rows={rows} /></label>
    <div className="flashcard-format-tools" aria-label={`Formatowanie: ${label}`}>
      <button type="button" aria-label="Pogrubienie" title="Pogrubienie" onClick={() => wrapSelection('**', '**')}><Bold size={14} /></button>
      <button type="button" aria-label="Kursywa" title="Kursywa" onClick={() => wrapSelection('*', '*')}><Italic size={14} /></button>
      <button type="button" aria-label="Kod" title="Kod" onClick={() => wrapSelection('`', '`')}><Code2 size={14} /></button>
      <button type="button" aria-label="Wstaw obraz" title="Wstaw obraz" onClick={() => imageInput.current?.click()}><ImagePlus size={14} /></button>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={event => { addImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      <small>Markdown · obrazy do 4 MB</small>
    </div>
    {imageError && <small className="flashcard-form-error" role="alert">{imageError}</small>}
  </div>
}

function imagePoint(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
}

function FlashcardOcclusionImage({ value, reveal, fallback, className = '' }: { value: FlashcardImageOcclusion; reveal: boolean; fallback: string; className?: string }) {
  return <div className={`flashcard-occlusion-image ${className}`}>
    <img src={value.imageDataUrl} alt={value.fileName} draggable={false} />
    {value.regions.map((region, index) => <span key={region.id} className={`flashcard-occlusion-mask ${reveal ? 'revealed' : ''}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><span>{reveal ? region.label || fallback : `Luka ${index + 1}`}</span></span>)}
  </div>
}

function FlashcardImageOcclusionField({ value, onChange }: { value?: FlashcardImageOcclusion; onChange: (value: FlashcardImageOcclusion | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [imageError, setImageError] = useState('')

  function readImage(file?: File) {
    if (!file) return
    setImageError('')
    if (file.size > 4 * 1024 * 1024) { setImageError('Obraz musi mieć maksymalnie 4 MB.'); return }
    const reader = new FileReader()
    reader.onerror = () => setImageError('Nie udało się wczytać obrazu.')
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) onChange({ imageDataUrl: reader.result, fileName: file.name, regions: [] })
      else setImageError('Ten format obrazu nie jest obsługiwany.')
    }
    reader.readAsDataURL(file)
  }
  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!value) return
    const point = imagePoint(event)
    setStart(point)
    setDraft({ ...point, width: 0, height: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start) return
    const point = imagePoint(event)
    setDraft({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) })
  }
  function finishDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start || !value) return
    const point = imagePoint(event)
    const region = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }
    if (region.width >= .018 && region.height >= .018) onChange({ ...value, regions: [...value.regions, { ...region, id: crypto.randomUUID(), label: '' }] })
    setStart(null)
    setDraft(null)
  }

  return <div className="flashcard-occlusion-editor">
    <div className="flashcard-occlusion-heading"><strong>Zakryj fragmenty obrazu</strong><button type="button" className="button secondary" onClick={() => input.current?.click()}>{value ? 'Zmień obraz' : 'Wybierz obraz'}</button><input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={event => { readImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></div>
    {imageError && <small className="flashcard-form-error" role="alert">{imageError}</small>}
    {value ? <>
      <div className="flashcard-occlusion-draw-area" onPointerDown={beginDraw} onPointerMove={moveDraw} onPointerUp={finishDraw} onPointerCancel={() => { setStart(null); setDraft(null) }}>
        <FlashcardOcclusionImage value={value} reveal={false} fallback="Odpowiedź" />
        {draft && <span className="flashcard-occlusion-mask draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}
      </div>
      <small className="flashcard-occlusion-help">Przeciągnij po obrazie, aby dodać zakryty obszar. Wpisz odpowiedź dla każdej luki.</small>
      {!!value.regions.length && <div className="flashcard-occlusion-region-list">{value.regions.map((region, index) => <label key={region.id}><span>Luka {index + 1}</span><input value={region.label} onChange={event => onChange({ ...value, regions: value.regions.map(item => item.id === region.id ? { ...item, label: event.target.value } : item) })} placeholder="Odpowiedź dla tego obszaru" /><button type="button" className="icon-button danger-icon" aria-label={`Usuń lukę ${index + 1}`} onClick={() => onChange({ ...value, regions: value.regions.filter(item => item.id !== region.id) })}><X size={14} /></button></label>)}</div>}
      {value.regions.length > 0 && !hasOcclusionAnswers(value) && <small className="flashcard-form-error" role="status">Wpisz odpowiedź dla każdej zakrytej luki.</small>}
      <button type="button" className="link-button" onClick={() => onChange(undefined)}>Usuń obraz</button>
    </> : <p className="flashcard-occlusion-help">Wybierz PNG, JPG, GIF lub WebP do 4 MB, a następnie przeciągnij po obrazie, aby zakryć elementy.</p>}
  </div>
}

export function FlashcardsPage({ cards, notes, onCreate, onUpdate, onReview, onSetDueAt, onToggleSuspend, onDelete, onRegenerate, onFindSimilar, onOpenNote }: {
  cards: readonly Flashcard[]
  notes: Note[]
  onCreate: (noteId: string, question: string, answer: string, kind: FlashcardKind, tags: string[], imageOcclusion?: FlashcardImageOcclusion) => void
  onUpdate: (id: string, edit: FlashcardEdit) => void
  onReview: (id: string, grade: FlashcardGrade) => void
  onSetDueAt: (id: string, dueAt: number) => void
  onToggleSuspend: (id: string) => void
  onDelete: (id: string) => void
  onRegenerate?: (card: Flashcard) => Promise<RegeneratedContent>
  onFindSimilar?: (cards: readonly Flashcard[]) => Promise<SimilarFlashcardMatch[]>
  onOpenNote: (noteId: string) => void
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [cardKind, setCardKind] = useState<FlashcardKind>('basic')
  const [cardOcclusion, setCardOcclusion] = useState<FlashcardImageOcclusion | undefined>()
  const [tagsDraft, setTagsDraft] = useState('')
  const [tab, setTab] = useState<'review' | 'cards'>('review')
  const [now, setNow] = useState(() => Date.now())
  const [excludedNoteIds, setExcludedNoteIds] = useState<string[]>([])
  const [includeUnlinkedCards, setIncludeUnlinkedCards] = useState(true)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<FlashcardSort>('due')
  const [decks, setDecks] = useState<FlashcardDeck[]>(readDecks)
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [deckName, setDeckName] = useState('')
  const [sessionLimit, setSessionLimit] = useState(20)
  const [sessionMode, setSessionMode] = useState<SessionMode>('due')
  const [shuffleSession, setShuffleSession] = useState(true)
  const [sessionQueue, setSessionQueue] = useState<string[] | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionCompleted, setSessionCompleted] = useState(0)
  const [editingCardId, setEditingCardId] = useState('')
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editKind, setEditKind] = useState<FlashcardKind>('basic')
  const [editOcclusion, setEditOcclusion] = useState<FlashcardImageOcclusion | undefined>()
  const [editTags, setEditTags] = useState('')
  const [regeneratingId, setRegeneratingId] = useState('')
  const [regenerateError, setRegenerateError] = useState('')
  const [similarMatches, setSimilarMatches] = useState<SimilarFlashcardMatch[] | null>(null)
  const [similarBusy, setSimilarBusy] = useState(false)
  const [similarError, setSimilarError] = useState('')
  const [dailyGoal, setDailyGoal] = useState(() => {
    const value = Number(localStorage.getItem(FLASHCARD_GOAL_KEY) ?? '20')
    return Number.isFinite(value) ? Math.max(1, Math.min(200, Math.round(value))) : 20
  })
  const [reminderEnabled, setReminderEnabled] = useState(() => readReminderPreference().enabled)
  const [reminderTime, setReminderTime] = useState(() => readReminderPreference().time)

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { try { localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks)) } catch { /* Decks remain available in memory if storage is full. */ } }, [decks])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_GOAL_KEY, String(dailyGoal)) } catch { /* Keep the goal in memory if storage is unavailable. */ } }, [dailyGoal])
  useEffect(() => {
    const previous = readReminderPreference()
    try { localStorage.setItem(FLASHCARD_REMINDER_KEY, JSON.stringify({ ...previous, enabled: reminderEnabled, time: reminderTime })) } catch { /* Reminders stay available in memory until the page closes. */ }
  }, [reminderEnabled, reminderTime])

  const excludedIds = useMemo(() => new Set(excludedNoteIds), [excludedNoteIds])
  const sourceFilteredCards = useMemo(() => cards.filter(card => {
    const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
    return note ? !excludedIds.has(note.id) : includeUnlinkedCards
  }), [cards, notes, excludedIds, includeUnlinkedCards])
  const unlinkedCardCount = useMemo(() => cards.filter(card => !card.noteId || !resolveWikiTarget(notes, card.noteId)).length, [cards, notes])
  const activeCards = useMemo(() => sourceFilteredCards.filter(card => !card.suspended), [sourceFilteredCards])
  const due = useMemo(() => activeCards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt), [activeCards, now])
  const currentId = sessionQueue?.[0]
  const current = currentId ? sourceFilteredCards.find(card => card.id === currentId) : undefined
  const currentNote = current && current.noteId ? resolveWikiTarget(notes, current.noteId) : undefined
  const selectedCount = notes.length - excludedNoteIds.filter(id => notes.some(note => note.id === id)).length
  const allNotesSelected = selectedCount === notes.length
  const sourceFilterLabel = allNotesSelected && includeUnlinkedCards ? 'Wszystkie' : `${selectedCount} notatek · bez notatki ${includeUnlinkedCards ? 'włączone' : 'wyłączone'}`
  const visibleCards = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pl')
    const matches = sourceFilteredCards.filter(card => {
      if (!term) return true
      const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
      return `${card.question}\n${card.answer}\n${note?.title ?? ''}\n${note?.folder ?? ''}\n${card.tags?.join(' ') ?? ''}`.toLocaleLowerCase('pl').includes(term)
    })
    return [...matches].sort((a, b) => sortBy === 'question' ? a.question.localeCompare(b.question, 'pl')
      : sortBy === 'hardest' ? a.ease - b.ease || b.lapses - a.lapses
        : sortBy === 'recent' ? (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0)
          : a.dueAt - b.dueAt)
  }, [sourceFilteredCards, query, notes, sortBy])
  useEffect(() => { setSimilarMatches(null) }, [visibleCards])

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const reviewEvents = sourceFilteredCards.flatMap(card => card.reviewHistory ?? [])
  const eventsToday = reviewEvents.filter(event => event.at >= dayStart.getTime())
  const legacyReviewsToday = sourceFilteredCards.filter(card => !card.reviewHistory?.length && (card.lastReviewedAt ?? 0) >= dayStart.getTime()).length
  const reviewsToday = eventsToday.length + legacyReviewsToday
  const successfulReviews = reviewEvents.filter(event => event.grade !== 'again').length
  const successRate = reviewEvents.length ? Math.round(successfulReviews / reviewEvents.length * 100) : undefined
  const masteredCount = sourceFilteredCards.filter(card => card.intervalDays >= 7 || card.repetitions >= 4).length
  const activityByDay = new Map<string, number>()
  for (const event of reviewEvents) {
    const key = localDateKey(new Date(event.at))
    activityByDay.set(key, (activityByDay.get(key) ?? 0) + 1)
  }
  for (const card of sourceFilteredCards) {
    if (!card.reviewHistory?.length && card.lastReviewedAt) {
      const key = localDateKey(new Date(card.lastReviewedAt))
      activityByDay.set(key, (activityByDay.get(key) ?? 0) + 1)
    }
  }
  const activeDays = new Set(activityByDay.keys())
  const todayKey = localDateKey(new Date())
  const streakCursor = new Date()
  streakCursor.setHours(0, 0, 0, 0)
  if (!activeDays.has(todayKey)) streakCursor.setDate(streakCursor.getDate() - 1)
  let studyStreak = 0
  while (activeDays.has(localDateKey(streakCursor))) { studyStreak += 1; streakCursor.setDate(streakCursor.getDate() - 1) }
  const calendarStart = new Date()
  calendarStart.setHours(0, 0, 0, 0)
  calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7) - 77)
  const activityCalendar: { key: string; title: string; count: number; level: number; monthLabel: string }[] = []
  const calendarCursor = new Date(calendarStart)
  while (calendarCursor <= dayStart) {
    const key = localDateKey(calendarCursor)
    const count = activityByDay.get(key) ?? 0
    activityCalendar.push({ key, title: `${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(calendarCursor)} · ${count} powtórek`, count, level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4, monthLabel: calendarCursor.getDate() === 1 || activityCalendar.length === 0 ? new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(calendarCursor) : '' })
    calendarCursor.setDate(calendarCursor.getDate() + 1)
  }
  const eligibleForSession = sessionMode === 'due' ? due : activeCards

  function cardNote(card: Flashcard) { return card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined }
  function notePath(note: Note | undefined) { return note ? `${note.folder || 'Bez folderu'} / ${note.title || 'Bez tytułu'}` : 'Brak notatki' }
  function toggleSourceNote(id: string) {
    setSelectedDeckId('')
    setSessionQueue(null)
    setExcludedNoteIds(current => current.includes(id) ? current.filter(note => note !== id) : [...current, id])
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || !noteId || (cardKind === 'basic' && !answer.trim()) || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion))) return
    onCreate(noteId, question.trim(), answer.trim(), cardKind, tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean), cardOcclusion)
    setQuestion(''); setAnswer(''); setTagsDraft(''); setCardOcclusion(undefined)
  }
  function startSession() {
    let selected = [...eligibleForSession]
    if (shuffleSession) {
      for (let index = selected.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[selected[index], selected[swap]] = [selected[swap]!, selected[index]!]
      }
    }
    selected = selected.slice(0, sessionLimit)
    setSessionQueue(selected.map(card => card.id))
    setSessionTotal(selected.length)
    setSessionCompleted(0)
    setShowAnswer(false)
  }
  function grade(value: FlashcardGrade) {
    if (!current) return
    onReview(current.id, value)
    setSessionQueue(queue => queue?.slice(1) ?? null)
    setSessionCompleted(count => count + 1)
    setShowAnswer(false)
    setNow(Date.now())
  }
  function postpone(id: string, interval: string) {
    const duration = REVIEW_INTERVALS[interval]
    if (!duration) return
    onSetDueAt(id, Date.now() + duration)
    setNow(Date.now())
    if (sessionQueue?.[0] === id) setSessionQueue(queue => queue?.slice(1) ?? null)
  }
  function setManualDue(id: string, value: string) {
    const dueAt = new Date(value).getTime()
    if (!Number.isFinite(dueAt)) return
    onSetDueAt(id, dueAt)
    setNow(Date.now())
    if (sessionQueue?.[0] === id) setSessionQueue(queue => queue?.slice(1) ?? null)
  }
  function chooseDeck(id: string) {
    setSelectedDeckId(id)
    setSessionQueue(null)
    const deck = decks.find(item => item.id === id)
    if (!deck) {
      setExcludedNoteIds([])
      setIncludeUnlinkedCards(true)
      return
    }
    setExcludedNoteIds(notes.filter(note => !deck.noteIds.includes(note.id)).map(note => note.id))
    setIncludeUnlinkedCards(deck.includeUnlinkedCards)
  }
  function saveDeck() {
    const name = deckName.trim()
    if (!name) return
    const deck: FlashcardDeck = { id: crypto.randomUUID(), name, noteIds: notes.filter(note => !excludedIds.has(note.id)).map(note => note.id), includeUnlinkedCards }
    setDecks(current => [...current, deck])
    setSelectedDeckId(deck.id)
    setDeckName('')
  }
  function beginEdit(card: Flashcard) {
    setEditingCardId(card.id)
    setEditQuestion(card.question)
    setEditAnswer(card.answer)
    setEditKind(card.kind === 'image-occlusion' ? 'image-occlusion' : card.kind === 'cloze' ? 'cloze' : 'basic')
    setEditOcclusion(card.imageOcclusion)
    setEditTags(card.tags?.join(', ') ?? '')
  }
  function saveEdit(card: Flashcard) {
    if (!editQuestion.trim() || (editKind === 'basic' && !editAnswer.trim()) || (editKind === 'cloze' && !hasCloze(editQuestion)) || (editKind === 'image-occlusion' && !hasOcclusionAnswers(editOcclusion))) return
    onUpdate(card.id, { question: editQuestion.trim(), answer: editAnswer.trim(), kind: editKind, tags: editTags.split(',').map(tag => tag.trim()).filter(Boolean), imageOcclusion: editKind === 'image-occlusion' ? editOcclusion : undefined })
    setEditingCardId('')
  }
  async function checkSimilarCards() {
    if (!onFindSimilar || similarBusy) return
    setSimilarError('')
    setSimilarBusy(true)
    try { setSimilarMatches(await onFindSimilar(visibleCards)) }
    catch (error) { setSimilarError(error instanceof Error ? error.message : 'Nie udało się porównać pytań.') }
    finally { setSimilarBusy(false) }
  }
  async function setReminder(value: boolean) {
    if (value && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* The app can still show an in-app reminder. */ }
    }
    setReminderEnabled(value)
  }
  async function regenerate(card: Flashcard) {
    if (!onRegenerate || regeneratingId) return
    setRegenerateError('')
    setRegeneratingId(card.id)
    try {
      const regenerated = await onRegenerate(card)
      const normalized = normalizeQuestion(regenerated.question)
      const duplicate = cards.some(item => item.id !== card.id && item.noteId === card.noteId && normalizeQuestion(item.question) === normalized)
      if (duplicate) throw new Error('AI wygenerowało pytanie, które już istnieje dla tej notatki.')
      onUpdate(card.id, { question: regenerated.question, answer: regenerated.answer, kind: 'basic', tags: card.tags ?? [] })
    } catch (error) { setRegenerateError(error instanceof Error ? error.message : 'Nie udało się poprawić fiszki.') }
    finally { setRegeneratingId('') }
  }

  return (<section className="flashcards-page" aria-labelledby="flashcards-title">
    <header className="flashcards-page-heading"><span className="folder-dialog-mark"><Brain size={19} /></span><div><h1 id="flashcards-title">Fiszki</h1><p>{due.length} do powtórki · {sourceFilteredCards.length} w wybranych źródłach · {selectedCount} notatek</p></div></header>

    <section className="flashcard-stats" aria-label="Statystyki nauki">
      <article><span>Do powtórki</span><strong>{due.length}</strong></article>
      <article><span>Powtórki dzisiaj</span><strong>{reviewsToday}</strong></article>
      <article><span>Skuteczność</span><strong>{successRate === undefined ? '—' : `${successRate}%`}</strong></article>
      <article><span>Utrwalone</span><strong>{masteredCount}</strong></article>
    </section>

    <section className="flashcard-learning-tools" aria-label="Cel i przypomnienia nauki">
      <div className="flashcard-daily-goal"><div className="flashcard-learning-heading"><span><Flame size={15} />Seria: {studyStreak} {studyStreak === 1 ? 'dzień' : 'dni'}</span><label>Cel dzienny<input aria-label="Dzienny cel powtórek" type="number" min="1" max="200" value={dailyGoal} onChange={event => setDailyGoal(Math.max(1, Math.min(200, Number(event.target.value) || 1)))} /></label></div><div className="flashcard-goal-progress"><span style={{ width: `${Math.min(100, reviewsToday / dailyGoal * 100)}%` }} /></div><small>{reviewsToday} z {dailyGoal} powtórek dzisiaj</small></div>
      <div className="flashcard-reminder-settings"><div className="flashcard-learning-heading"><span><Bell size={15} />Przypomnienie</span><label className="flashcard-reminder-toggle"><input type="checkbox" checked={reminderEnabled} onChange={event => void setReminder(event.target.checked)} /><span>{reminderEnabled ? 'Włączone' : 'Wyłączone'}</span></label></div><label className="flashcard-reminder-time">Codziennie o <input type="time" value={reminderTime} disabled={!reminderEnabled} onChange={event => setReminderTime(event.target.value)} /></label><small>Powiadomienie pojawia się przy kartach do powtórki, gdy aplikacja jest uruchomiona.</small></div>
    </section>

    <section className="flashcard-activity" aria-label="Kalendarz aktywności nauki"><div className="flashcard-activity-heading"><span><CalendarDays size={15} />Aktywność z ostatnich 12 tygodni</span><small>{activityCalendar.reduce((sum, day) => sum + day.count, 0)} powtórek</small></div><div className="flashcard-activity-months">{activityCalendar.filter(day => day.monthLabel).map(day => <span key={day.key}>{day.monthLabel}</span>)}</div><div className="flashcard-activity-grid">{activityCalendar.map(day => <span key={day.key} role="img" title={day.title} aria-label={day.title} data-level={day.level} />)}</div><div className="flashcard-activity-legend"><span>Mniej</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>Więcej</span></div></section>

    <details className="flashcard-note-filter"><summary><strong>Notatki źródłowe</strong><span>{sourceFilterLabel}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="flashcard-note-options"><button type="button" onClick={() => { setExcludedNoteIds([]); setIncludeUnlinkedCards(true); setSelectedDeckId(''); setSessionQueue(null) }}>Wszystkie notatki i fiszki</button>{notes.map(note => <button type="button" key={note.id} className="flashcard-note-option" aria-pressed={!excludedIds.has(note.id)} onClick={() => toggleSourceNote(note.id)}><span className="flashcard-note-option-mark" aria-hidden="true">{!excludedIds.has(note.id) && <Check size={11} />}</span><span>{note.folder ? `${note.folder} / ` : ''}{note.title || 'Bez tytułu'}</span></button>)}<button type="button" className="flashcard-note-option" aria-pressed={includeUnlinkedCards} onClick={() => { setIncludeUnlinkedCards(value => !value); setSelectedDeckId(''); setSessionQueue(null) }}><span className="flashcard-note-option-mark" aria-hidden="true">{includeUnlinkedCards && <Check size={11} />}</span><span>Fiszki bez notatki ({unlinkedCardCount})</span></button></div></details>

    <div className="flashcard-deck-tools"><label><Layers size={15} /><select aria-label="Zapisana talia" value={selectedDeckId} onChange={event => chooseDeck(event.target.value)}><option value="">Bieżący wybór źródeł</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><input aria-label="Nazwa nowej talii" value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="Nazwa talii" /><button type="button" className="button secondary" disabled={!deckName.trim()} onClick={saveDeck}>Zapisz talię</button>{selectedDeckId && <button type="button" className="icon-button" aria-label="Usuń zapisaną talię" title="Usuń talię" onClick={() => { setDecks(current => current.filter(deck => deck.id !== selectedDeckId)); setSelectedDeckId('') }}><Trash2 size={15} /></button>}</div>

    <div className="backup-trash-tabs"><button type="button" className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Powtarzaj <span>{due.length}</span></button><button type="button" className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>Karty <span>{sourceFilteredCards.length}</span>{sourceFilteredCards.some(card => card.suspended) && <small className="flashcard-suspended-count">{sourceFilteredCards.filter(card => card.suspended).length} wstrzymanych</small>}</button></div>

    {tab === 'review' ? <div className="flashcard-review-workspace">
      {sessionQueue === null ? <div className="flashcard-session-setup"><div className="flashcard-session-heading"><span className="flashcard-session-mark"><Shuffle size={17} /></span><div><h2>Sesja nauki</h2><p>Wybierz karty i rozpocznij powtórkę.</p></div></div><div className="flashcard-session-controls"><label>Zakres<select value={sessionMode} onChange={event => setSessionMode(event.target.value as SessionMode)}><option value="due">Tylko do powtórki ({due.length})</option><option value="all">Wszystkie karty ({sourceFilteredCards.length})</option></select></label><label>Liczba kart<select value={sessionLimit} onChange={event => setSessionLimit(Number(event.target.value))}>{[5, 10, 20, 50, 100].map(count => <option key={count} value={count}>{count}</option>)}</select></label><label className="flashcard-shuffle-toggle"><input type="checkbox" checked={shuffleSession} onChange={event => setShuffleSession(event.target.checked)} /><span>Mieszaj kolejność</span></label></div><button type="button" className="button primary" disabled={!eligibleForSession.length} onClick={startSession}><Brain size={15} />Rozpocznij sesję ({Math.min(sessionLimit, eligibleForSession.length)})</button></div>
        : current ? <div className="flashcard-review">
          <div className="flashcard-review-progress"><span>{sessionCompleted + 1} / {sessionTotal}</span><button type="button" className="link-button" onClick={() => setSessionQueue(null)}>Zakończ sesję</button></div>
          {currentNote ? <button type="button" className="flashcard-note-path" onClick={() => onOpenNote(currentNote.id)}>{notePath(currentNote)}</button> : <small>{notePath(currentNote)}</small>}
          {current.tags?.length ? <small className="flashcard-review-tags">{current.tags.join(', ')}</small> : null}
          <RichCardContent className="flashcard-review-question" value={current.kind === 'cloze' ? clozeText(current.question, false) : current.question} />
          {current.kind === 'image-occlusion' && current.imageOcclusion && <FlashcardOcclusionImage value={current.imageOcclusion} reveal={showAnswer} fallback={current.answer || 'Odpowiedź'} className="flashcard-review-occlusion" />}
          {showAnswer ? <>{current.kind === 'image-occlusion' ? current.answer && <RichCardContent className="flashcard-answer" value={current.answer} /> : <RichCardContent className="flashcard-answer" value={current.kind === 'cloze' ? `${clozeText(current.question, true)}${current.answer.trim() ? `\n\n${current.answer}` : ''}` : current.answer} />}<p>Jak łatwo przypomniałeś sobie odpowiedź?</p><div className="flashcard-grades"><button onClick={() => grade('again')}>Ponownie <small>10 min</small></button><button onClick={() => grade('hard')}>Trudne</button><button onClick={() => grade('good')}>Dobrze</button><button onClick={() => grade('easy')}>Łatwe</button></div><label className="flashcard-postpone-control"><Clock3 size={14} /><span>Odłóż</span><select aria-label="Odłóż aktualną fiszkę" defaultValue="" onChange={event => { postpone(current.id, event.target.value); event.target.value = '' }}><option value="" disabled>Wybierz termin</option><option value="hour">1 godzinę</option><option value="day">Do jutra</option><option value="week">7 dni</option><option value="month">30 dni</option></select></label><label className="flashcard-date-control"><span>Ustaw dokładny termin</span><input aria-label="Dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(current.dueAt)} onChange={event => setManualDue(current.id, event.target.value)} /></label></> : <button className="button primary" onClick={() => setShowAnswer(true)}>Pokaż odpowiedź <ChevronRight size={15} /></button>}
        </div> : <div className="flashcard-session-complete"><Check size={23} /><h2>{sessionCompleted ? 'Sesja zakończona' : 'Brak kart w tej sesji'}</h2><p>{sessionCompleted} z {sessionTotal} kart sprawdzono.</p><button type="button" className="button primary" onClick={() => setSessionQueue(null)}>Ustaw kolejną sesję</button></div>}
      </div> : <>
        <form className="flashcard-create-form" onSubmit={submit}>
          <select aria-label="Notatka dla karty" value={noteId} onChange={event => setNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.folder ? `${note.folder} / ` : ''}{note.title || 'Bez tytułu'}</option>)}</select>
          <label className="flashcard-kind-select"><span>Typ karty</span><select value={cardKind} onChange={event => { const kind = event.target.value as FlashcardKind; setCardKind(kind); if (kind === 'image-occlusion' && !question.trim()) setQuestion('Nazwij zakryte elementy.'); if (kind !== 'image-occlusion') setCardOcclusion(undefined) }}><option value="basic">Pytanie i odpowiedź</option><option value="cloze">Uzupełnij lukę</option><option value="image-occlusion">Zakrywanie obrazu</option></select></label>
          <FlashcardContentField label={cardKind === 'cloze' ? 'Tekst z luką, np. Stolica Francji to {{c1::Paryż}}.' : 'Pytanie'} value={question} onChange={setQuestion} />
          {cardKind === 'basic' ? <FlashcardContentField label="Odpowiedź" value={answer} onChange={setAnswer} /> : cardKind === 'cloze' ? <p className="flashcard-cloze-help">Oznacz ukrywane fragmenty składnią <code>{'{{c1::odpowiedź}}'}</code>. Możesz dodać kilka luk.</p> : <><FlashcardImageOcclusionField value={cardOcclusion} onChange={setCardOcclusion} /><FlashcardContentField label="Dodatkowa odpowiedź (opcjonalna)" value={answer} onChange={setAnswer} /></>}
          <input className="flashcard-tags-input" aria-label="Tagi fiszki" value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} placeholder="Tagi, oddziel przecinkami" />
          <button className="button primary" disabled={!noteId || !question.trim() || (cardKind === 'basic' && !answer.trim()) || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion))}><Plus size={15} />Dodaj fiszkę</button>
        </form>
        <div className="flashcard-card-toolbar"><label className="flashcard-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj w pytaniach, odpowiedziach i notatkach" /></label><label className="flashcard-sort"><span>Sortuj</span><select value={sortBy} onChange={event => setSortBy(event.target.value as FlashcardSort)}><option value="due">Termin powtórki</option><option value="hardest">Najtrudniejsze</option><option value="question">Pytanie A–Z</option><option value="recent">Ostatnio powtarzane</option></select></label>{onFindSimilar && <button type="button" className="button secondary flashcard-similar-button" title="Porównanie korzysta z modelu embeddingów ustawionego w Ollama." disabled={similarBusy || visibleCards.length < 2} onClick={() => void checkSimilarCards()}>{similarBusy ? <><Sparkles className="spin" size={14} />Porównuję…</> : <><Sparkles size={14} />Wykryj podobne</>}</button>}<span className="flashcard-result-count">{visibleCards.length} kart</span></div>
        {similarError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{similarError}</p>}
        {similarMatches && <section className="flashcard-similar-results" aria-label="Podobne fiszki"><div className="flashcard-similar-heading"><strong>Podobne pytania · podobieństwo semantyczne</strong><button type="button" className="link-button" onClick={() => setSimilarMatches(null)}>Ukryj</button></div>{similarMatches.length ? similarMatches.map(match => { const first = cards.find(card => card.id === match.firstId); const second = cards.find(card => card.id === match.secondId); if (!first || !second) return null; return <article key={`${match.firstId}:${match.secondId}`}><button type="button" onClick={() => beginEdit(first)}><small>{notePath(cardNote(first))}</small>{first.question}</button><span>{Math.round(match.score * 100)}%</span><button type="button" onClick={() => beginEdit(second)}><small>{notePath(cardNote(second))}</small>{second.question}</button></article> }) : <p>Nie znaleziono podobnych pytań w wybranym zestawie.</p>}</section>}
        {regenerateError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{regenerateError}</p>}
        <div className="flashcard-list">{visibleCards.map(card => {
          const note = cardNote(card)
          const isEditing = editingCardId === card.id
          return <article key={card.id} className={isEditing ? 'is-editing' : ''}>
            {isEditing ? <div className="flashcard-edit-card">
              <div className="flashcard-edit-heading"><strong>Edytuj fiszkę</strong><button type="button" className="icon-button" aria-label="Anuluj edycję" onClick={() => setEditingCardId('')}><X size={15} /></button></div>
              <label className="flashcard-kind-select"><span>Typ karty</span><select value={editKind} onChange={event => { const kind = event.target.value as FlashcardKind; setEditKind(kind); if (kind !== 'image-occlusion') setEditOcclusion(undefined); else if (!editQuestion.trim()) setEditQuestion('Nazwij zakryte elementy.') }}><option value="basic">Pytanie i odpowiedź</option><option value="cloze">Uzupełnij lukę</option><option value="image-occlusion">Zakrywanie obrazu</option></select></label>
              <FlashcardContentField label={editKind === 'cloze' ? 'Tekst z luką' : 'Pytanie'} value={editQuestion} onChange={setEditQuestion} />
              {editKind === 'basic' ? <FlashcardContentField label="Odpowiedź" value={editAnswer} onChange={setEditAnswer} /> : editKind === 'cloze' ? <p className="flashcard-cloze-help">Użyj składni <code>{'{{c1::odpowiedź}}'}</code> w treści pytania.</p> : <><FlashcardImageOcclusionField value={editOcclusion} onChange={setEditOcclusion} /><FlashcardContentField label="Dodatkowa odpowiedź (opcjonalna)" value={editAnswer} onChange={setEditAnswer} /></>}
              <input className="flashcard-tags-input" aria-label="Tagi fiszki" value={editTags} onChange={event => setEditTags(event.target.value)} placeholder="Tagi, oddziel przecinkami" />
              <div className="flashcard-edit-actions"><button type="button" className="button secondary" onClick={() => setEditingCardId('')}>Anuluj</button><button type="button" className="button primary" disabled={!editQuestion.trim() || (editKind === 'basic' && !editAnswer.trim()) || (editKind === 'cloze' && !hasCloze(editQuestion)) || (editKind === 'image-occlusion' && !hasOcclusionAnswers(editOcclusion))} onClick={() => saveEdit(card)}>Zapisz zmiany</button></div>
            </div> : <>
              <div className="flashcard-list-content"><RichCardContent value={card.kind === 'cloze' ? clozeText(card.question, false) : card.question} />{card.kind === 'image-occlusion' && card.imageOcclusion && <FlashcardOcclusionImage value={card.imageOcclusion} reveal={false} fallback="Odpowiedź" className="flashcard-image-occlusion-preview" />}<div className="flashcard-card-meta">{note ? <button type="button" className="flashcard-note-path" title={notePath(note)} onClick={() => onOpenNote(note.id)}>{notePath(note)}</button> : <small>Brak notatki</small>}<small>{card.suspended ? 'wstrzymana · ' : ''}{card.tags?.length ? `${card.tags.join(', ')} · ` : ''}{card.dueAt <= now ? 'do powtórzenia' : `następna: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(card.dueAt)}`}{card.kind === 'cloze' ? ' · luka' : card.kind === 'image-occlusion' ? ' · zakrywanie obrazu' : ''}</small></div></div>
              <div className="flashcard-row-actions"><button type="button" className="icon-button" aria-label="Edytuj fiszkę" title="Edytuj" onClick={() => beginEdit(card)}><Pencil size={15} /></button>{onRegenerate && card.kind === 'basic' && <button type="button" className="icon-button" aria-label="Popraw fiszkę przy pomocy AI" title="Popraw przy pomocy AI" disabled={Boolean(regeneratingId)} onClick={() => void regenerate(card)}>{regeneratingId === card.id ? <Sparkles className="spin" size={15} /> : <Sparkles size={15} />}</button>}<button type="button" className="icon-button" aria-label={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} title={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} onClick={() => onToggleSuspend(card.id)}>{card.suspended ? <Play size={15} /> : <Pause size={15} />}</button><label className="flashcard-postpone-mini"><Clock3 size={13} /><select aria-label="Odłóż fiszkę" defaultValue="" onChange={event => { postpone(card.id, event.target.value); event.target.value = '' }}><option value="" disabled>Odłóż</option><option value="hour">+1 godz.</option><option value="day">Jutro</option><option value="week">+7 dni</option><option value="month">+30 dni</option></select></label><label className="flashcard-date-mini"><input aria-label="Ustaw dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(card.dueAt)} onChange={event => setManualDue(card.id, event.target.value)} /></label><button type="button" className="icon-button danger-icon" title="Usuń fiszkę" aria-label="Usuń fiszkę" onClick={() => onDelete(card.id)}><X size={15} /></button></div>
            </>}
          </article>
        })}{!visibleCards.length && <p className="flashcard-list-empty">Nie ma kart pasujących do wyszukiwania i wybranych filtrów.</p>}</div>
      </>}
    </section>
  )
}
