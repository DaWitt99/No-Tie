import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { Bell, Bold, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Code2, Flame, ImagePlus, Italic, Layers, Maximize2, Minimize2, Pause, Pencil, Play, Plus, Search, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { FLASHCARD_STUDY_MODES, type Flashcard, type FlashcardImageOcclusion, type FlashcardKind, type FlashcardStudyMode, type FlashcardTemplate, type FlashcardTrashEntry, type Note, type NoteAttachment } from './types'
import type { FlashcardGrade, FlashcardReviewMeta } from './flashcards'
import { resolveWikiTarget } from './knowledge'

type FlashcardDeck = { id: string; name: string; noteIds: string[]; includeUnlinkedCards: boolean; cardIds?: string[]; dynamicRule?: { tag?: string; noteId?: string; dueOnly?: boolean } }
type FlashcardSort = 'due' | 'hardest' | 'question' | 'recent'
type FlashcardPageSize = 10 | 25 | 50 | 100
type SessionMode = 'due' | 'all' | 'weak'
type AnswerMode = FlashcardStudyMode
export type FlashcardAiAction = 'evaluate' | 'distractors' | 'quality' | 'coverage' | 'tags' | 'example' | 'mnemonic' | 'difficulty'
type FlashcardEdit = Partial<Flashcard>
type RegeneratedContent = { question: string; answer: string }
type SimilarFlashcardMatch = { firstId: string; secondId: string; score: number }

const DECK_STORAGE_KEY = 'no-tie-flashcard-decks'
const FLASHCARD_REMINDER_KEY = 'no-tie-flashcard-reminder'
const FLASHCARD_GOAL_KEY = 'no-tie-flashcard-daily-goal'
const CLOZE_PATTERN = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi
const REVIEW_INTERVALS: Record<string, number> = { hour: 60 * 60_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }
const FLASHCARD_TEMPLATE_PROMPTS: Record<FlashcardTemplate, string> = {
  definition: 'Czym jest …?',
  'cause-effect': 'Co powoduje … i jakie są tego skutki?',
  comparison: 'Czym różni się … od …?',
  vocabulary: 'Co oznacza termin …?',
  process: 'Jak przebiega proces …?',
  formula: 'Jaki wzór opisuje …?',
}

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
  let html = escapeHtml(value)
    .replace(/!\[([^\]]*)\]\((data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)\)/gi, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula: string) => katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false }))
  html = html.replace(/\$([^\n$]+?)\$/g, (_match, formula: string) => katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false }))
  const lines = html.split('<br />')
  const formatted: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]?.trim() ?? ''
    const separator = lines[index + 1]?.trim() ?? ''
    if (!/^\|.+\|$/.test(heading) || !/^\|[\s:|-]+\|$/.test(separator)) { formatted.push(lines[index] ?? ''); continue }
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
    const head = cells(heading).map(cell => '<th>' + cell + '</th>').join('')
    const body: string[] = []
    index += 2
    while (index < lines.length && /^\|.+\|$/.test(lines[index]?.trim() ?? '')) {
      body.push('<tr>' + cells(lines[index] ?? '').map(cell => '<td>' + cell + '</td>').join('') + '</tr>')
      index += 1
    }
    index -= 1
    formatted.push('<table><thead><tr>' + head + '</tr></thead><tbody>' + body.join('') + '</tbody></table>')
  }
  html = formatted.join('<br />')
  return html
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
      <small>Markdown · LaTeX $…$ · tabele · obrazy do 4 MB</small>
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

function FlashcardMediaClip({ attachment, clip }: { attachment?: NoteAttachment; clip?: Flashcard['mediaClip'] }) {
  if (!attachment) return null
  const startAt = Math.max(0, clip?.startMs ?? 0) / 1000
  const stopAt = clip?.endMs !== undefined ? clip.endMs / 1000 : undefined
  const onLoadedMetadata = (event: SyntheticEvent<HTMLMediaElement>) => { event.currentTarget.currentTime = startAt }
  const onTimeUpdate = (event: SyntheticEvent<HTMLMediaElement>) => { if (stopAt !== undefined && event.currentTarget.currentTime >= stopAt) event.currentTarget.pause() }
  const media = { controls: true, src: attachment.dataUrl, onLoadedMetadata, onTimeUpdate }
  return <div className="flashcard-media-clip"><small>{attachment.fileName}{clip ? ' · ' + Math.round(startAt) + '–' + (stopAt === undefined ? 'koniec' : Math.round(stopAt)) + ' s' : ''}</small>{attachment.mimeType.startsWith('audio/') ? <audio {...media} /> : <video preload="metadata" {...media} />}</div>
}

function textLines(value: string) { return value.split('\n').map(item => item.trim()).filter(Boolean) }
function parseGlossary(value: string) {
  return value.split('\n').flatMap(line => {
    const split = line.indexOf('=')
    if (split <= 0) return []
    const term = line.slice(0, split).trim()
    const definition = line.slice(split + 1).trim()
    return term && definition ? [{ term, definition }] : []
  })
}

function safeJsonValue(value: string): unknown {
  const fenced = value.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i)?.[1]
  const raw = fenced?.trim() ?? value.trim()
  try { return JSON.parse(raw) } catch {
    const start = raw.search(/[\[{]/)
    const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'))
    if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)) } catch { return raw } }
    return raw
  }
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

export function FlashcardsPage({ cards, notes, attachments = [], trash = [], onCreate, onUpdate, onReview, onSetDueAt, onToggleSuspend, onDelete, onRestoreTrash, onPurgeTrash, onRegenerate, onFindSimilar, onAiAssist, onOpenNote }: {
  cards: readonly Flashcard[]
  notes: Note[]
  attachments?: NoteAttachment[]
  trash?: FlashcardTrashEntry[]
  onCreate: (noteId: string, question: string, answer: string, kind: FlashcardKind, tags: string[], imageOcclusion?: FlashcardImageOcclusion, metadata?: Partial<Flashcard>) => void
  onUpdate: (id: string, edit: FlashcardEdit) => void
  onReview: (id: string, grade: FlashcardGrade, metadata?: FlashcardReviewMeta) => void
  onSetDueAt: (id: string, dueAt: number) => void
  onToggleSuspend: (id: string) => void
  onDelete: (card: Flashcard) => void
  onRestoreTrash?: (id: string) => void
  onPurgeTrash?: (id: string) => void
  onRegenerate?: (card: Flashcard) => Promise<RegeneratedContent>
  onFindSimilar?: (cards: readonly Flashcard[]) => Promise<SimilarFlashcardMatch[]>
  onAiAssist?: (action: FlashcardAiAction, card?: Flashcard, input?: string) => Promise<string>
  onOpenNote: (noteId: string) => void
}) {
  const [noteId, setNoteId] = useState(notes[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [cardKind, setCardKind] = useState<FlashcardKind>('basic')
  const [studyModeDraft, setStudyModeDraft] = useState<FlashcardStudyMode>('flip')
  const [trueFalseAnswerDraft, setTrueFalseAnswerDraft] = useState(true)
  const [cardOcclusion, setCardOcclusion] = useState<FlashcardImageOcclusion | undefined>()
  const [tagsDraft, setTagsDraft] = useState('')
  const [templateDraft, setTemplateDraft] = useState<FlashcardTemplate>('definition')
  const [hintsDraft, setHintsDraft] = useState('')
  const [variantsDraft, setVariantsDraft] = useState('')
  const [sequenceDraft, setSequenceDraft] = useState('')
  const [numericValue, setNumericValue] = useState('')
  const [numericTolerance, setNumericTolerance] = useState('0')
  const [numericUnit, setNumericUnit] = useState('')
  const [mediaAttachmentId, setMediaAttachmentId] = useState('')
  const [mediaStart, setMediaStart] = useState('0')
  const [mediaEnd, setMediaEnd] = useState('')
  const [relatedDraft, setRelatedDraft] = useState<string[]>([])
  const [glossaryDraft, setGlossaryDraft] = useState('')
  const [tab, setTab] = useState<'review' | 'cards' | 'create' | 'progress' | 'trash'>('review')
  const [now, setNow] = useState(() => Date.now())
  const [excludedNoteIds, setExcludedNoteIds] = useState<string[]>([])
  const [includeUnlinkedCards, setIncludeUnlinkedCards] = useState(true)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<FlashcardSort>('due')
  const [cardsPerPage, setCardsPerPage] = useState<FlashcardPageSize>(25)
  const [cardsPage, setCardsPage] = useState(1)
  const [decks, setDecks] = useState<FlashcardDeck[]>(readDecks)
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [deckName, setDeckName] = useState('')
  const [deckCreateMode, setDeckCreateMode] = useState<'sources' | 'selected' | 'dynamic'>('sources')
  const [dynamicDeckTag, setDynamicDeckTag] = useState('')
  const [dynamicDeckNote, setDynamicDeckNote] = useState('')
  const [dynamicDueOnly, setDynamicDueOnly] = useState(false)
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [bulkTagDraft, setBulkTagDraft] = useState('')
  const [bulkDueDays, setBulkDueDays] = useState(1)
  const [sessionLimit, setSessionLimit] = useState(20)
  const [sessionMode, setSessionMode] = useState<SessionMode>('due')
  const [shuffleSession, setShuffleSession] = useState(true)
  const [answerMode, setAnswerMode] = useState<AnswerMode>('flip')
  const [timeSized, setTimeSized] = useState(false)
  const [sessionMinutes, setSessionMinutes] = useState(15)
  const [weakOnly, setWeakOnly] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [showAnswer, setShowAnswer] = useState(false)
  const [sessionQueue, setSessionQueue] = useState<string[] | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionCompleted, setSessionCompleted] = useState(0)
  const [examDeadline, setExamDeadline] = useState<number | null>(null)
  const [breakDeadline, setBreakDeadline] = useState<number | null>(null)
  const [answerInput, setAnswerInput] = useState('')
  const [choiceValue, setChoiceValue] = useState('')
  const [answerSubmitted, setAnswerSubmitted] = useState(false)
  const [hintLevel, setHintLevel] = useState(0)
  const [sequenceOrder, setSequenceOrder] = useState<string[]>([])
  const [confidence, setConfidence] = useState(3)
  const [examExpired, setExamExpired] = useState(false)
  const [aiEvaluation, setAiEvaluation] = useState('')
  const [aiBusy, setAiBusy] = useState('')
  const [aiReport, setAiReport] = useState('')
  const [aiReportExpanded, setAiReportExpanded] = useState(false)
  const [aiError, setAiError] = useState('')
  const answerStartedAt = useRef(Date.now())
  const [editingCardId, setEditingCardId] = useState('')
  const [editQuestion, setEditQuestion] = useState('')
  const [editAnswer, setEditAnswer] = useState('')
  const [editKind, setEditKind] = useState<FlashcardKind>('basic')
  const [editOcclusion, setEditOcclusion] = useState<FlashcardImageOcclusion | undefined>()
  const [editTags, setEditTags] = useState('')
  const [editMetadata, setEditMetadata] = useState<FlashcardEdit>({})
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
  const [studyWeekdays, setStudyWeekdays] = useState<number[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('no-tie-flashcard-weekdays') ?? '[1,2,3,4,5]'); return Array.isArray(value) ? value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : [1, 2, 3, 4, 5] } catch { return [1, 2, 3, 4, 5] }
  })
  const [examDate, setExamDate] = useState(() => localStorage.getItem('no-tie-flashcard-exam-date') ?? '')
  const [masteryRules, setMasteryRules] = useState<Record<string, number>>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('no-tie-flashcard-mastery-rules') ?? '{}'); return value && typeof value === 'object' ? value as Record<string, number> : {} } catch { return {} }
  })

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), examDeadline || breakDeadline ? 1000 : 60_000); return () => window.clearInterval(timer) }, [examDeadline, breakDeadline])
  useEffect(() => { try { localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks)) } catch { /* Decks remain available in memory if storage is full. */ } }, [decks])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_GOAL_KEY, String(dailyGoal)) } catch { /* Keep the goal in memory if storage is unavailable. */ } }, [dailyGoal])
  useEffect(() => {
    const previous = readReminderPreference()
    try { localStorage.setItem(FLASHCARD_REMINDER_KEY, JSON.stringify({ ...previous, enabled: reminderEnabled, time: reminderTime })) } catch { /* Reminders stay available in memory until the page closes. */ }
  }, [reminderEnabled, reminderTime])
  useEffect(() => { try { localStorage.setItem('no-tie-flashcard-weekdays', JSON.stringify(studyWeekdays)) } catch { /* Weekday preferences stay available until the page closes. */ } }, [studyWeekdays])
  useEffect(() => { try { localStorage.setItem('no-tie-flashcard-exam-date', examDate) } catch { /* Keep the exam date in memory if storage is unavailable. */ } }, [examDate])
  useEffect(() => { try { localStorage.setItem('no-tie-flashcard-mastery-rules', JSON.stringify(masteryRules)) } catch { /* Keep mastery rules in memory if storage is unavailable. */ } }, [masteryRules])

  const excludedIds = useMemo(() => new Set(excludedNoteIds), [excludedNoteIds])
  const sourceFilteredCards = useMemo(() => cards.filter(card => {
    const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
    return note ? !excludedIds.has(note.id) : includeUnlinkedCards
  }), [cards, notes, excludedIds, includeUnlinkedCards])
  const unlinkedCardCount = useMemo(() => cards.filter(card => !card.noteId || !resolveWikiTarget(notes, card.noteId)).length, [cards, notes])
  const selectedDeck = decks.find(deck => deck.id === selectedDeckId)
  const deckFilteredCards = useMemo(() => sourceFilteredCards.filter(card => {
    if (!selectedDeck) return true
    if (selectedDeck.cardIds) return selectedDeck.cardIds.includes(card.id)
    if (selectedDeck.dynamicRule) {
      const rule = selectedDeck.dynamicRule
      if (rule.tag && !card.tags?.includes(rule.tag)) return false
      if (rule.noteId && card.noteId !== rule.noteId) return false
      if (rule.dueOnly && card.dueAt > now) return false
      return true
    }
    const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
    return note ? selectedDeck.noteIds.includes(note.id) : selectedDeck.includeUnlinkedCards
  }), [sourceFilteredCards, selectedDeck, notes, now])
  const taggedCards = useMemo(() => tagFilter ? deckFilteredCards.filter(card => card.tags?.includes(tagFilter)) : deckFilteredCards, [deckFilteredCards, tagFilter])
  const activeCards = useMemo(() => taggedCards.filter(card => !card.suspended), [taggedCards])
  const due = useMemo(() => activeCards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt), [activeCards, now])
  const currentId = sessionQueue?.[0]
  const current = currentId ? deckFilteredCards.find(card => card.id === currentId) : undefined
  const currentNote = current && current.noteId ? resolveWikiTarget(notes, current.noteId) : undefined
  const selectedCount = notes.length - excludedNoteIds.filter(id => notes.some(note => note.id === id)).length
  const allNotesSelected = selectedCount === notes.length
  const sourceFilterLabel = allNotesSelected && includeUnlinkedCards ? 'Wszystkie' : `${selectedCount} notatek · bez notatki ${includeUnlinkedCards ? 'włączone' : 'wyłączone'}`
  const visibleCards = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pl')
    const matches = taggedCards.filter(card => {
      if (!term) return true
      const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
      return `${card.question}\n${card.answer}\n${note?.title ?? ''}\n${note?.folder ?? ''}\n${card.tags?.join(' ') ?? ''}`.toLocaleLowerCase('pl').includes(term)
    })
    return [...matches].sort((a, b) => sortBy === 'question' ? a.question.localeCompare(b.question, 'pl')
      : sortBy === 'hardest' ? a.ease - b.ease || b.lapses - a.lapses
        : sortBy === 'recent' ? (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0)
          : a.dueAt - b.dueAt)
  }, [taggedCards, query, notes, sortBy])
  const pageCount = Math.max(1, Math.ceil(visibleCards.length / cardsPerPage))
  const currentCardsPage = Math.min(cardsPage, pageCount)
  const firstVisibleCard = (currentCardsPage - 1) * cardsPerPage
  const lastVisibleCard = Math.min(firstVisibleCard + cardsPerPage, visibleCards.length)
  const pageCards = visibleCards.slice(firstVisibleCard, lastVisibleCard)
  useEffect(() => { setCardsPage(1) }, [query, tagFilter, selectedDeckId, excludedNoteIds, includeUnlinkedCards])
  useEffect(() => { setSimilarMatches(null) }, [visibleCards])

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const reviewEvents = taggedCards.flatMap(card => card.reviewHistory ?? [])
  const eventsToday = reviewEvents.filter(event => event.at >= dayStart.getTime())
  const legacyReviewsToday = taggedCards.filter(card => !card.reviewHistory?.length && (card.lastReviewedAt ?? 0) >= dayStart.getTime()).length
  const reviewsToday = eventsToday.length + legacyReviewsToday
  const successfulReviews = reviewEvents.filter(event => event.grade !== 'again').length
  const successRate = reviewEvents.length ? Math.round(successfulReviews / reviewEvents.length * 100) : undefined
  const isMastered = (card: Flashcard) => {
    const deckTarget = selectedDeck ? masteryRules['deck:' + selectedDeck.id] : undefined
    const configured = (card.tags ?? []).map(tag => masteryRules[tag]).filter((value): value is number => Number.isFinite(value))
    const target = Math.max(1, Math.min(50, Math.round(deckTarget ?? (configured.length ? Math.max(...configured) : 4))))
    return card.repetitions >= target
  }
  const masteredCount = taggedCards.filter(isMastered).length
  const activityByDay = new Map<string, number>()
  for (const event of reviewEvents) {
    const key = localDateKey(new Date(event.at))
    activityByDay.set(key, (activityByDay.get(key) ?? 0) + 1)
  }
  for (const card of taggedCards) {
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
  const averageResponseMs = Math.round(reviewEvents.reduce((total, event) => total + (event.responseMs ?? 25_000), 0) / Math.max(1, reviewEvents.length))
  const weakCards = activeCards.filter(card => card.lapses > 0 || card.ease < 2.2 || card.reviewHistory?.slice(-2).some(event => event.grade === 'again' || event.grade === 'hard'))
  const weakCardIds = new Set(weakCards.map(card => card.id))
  const activeModeCards = activeCards.filter(card => (card.studyMode ?? 'flip') === answerMode)
  const dueModeCards = activeModeCards.filter(card => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)
  const weakModeCards = activeModeCards.filter(card => weakCardIds.has(card.id))
  const eligibleBase = sessionMode === 'due' ? dueModeCards : sessionMode === 'weak' ? weakModeCards : activeModeCards
  const eligibleForSession = weakOnly ? eligibleBase.filter(card => weakCardIds.has(card.id)) : eligibleBase
  const sessionCardLimit = timeSized ? Math.max(1, Math.min(100, Math.floor(sessionMinutes * 60_000 / Math.max(5_000, averageResponseMs)))) : sessionLimit
  const activeMedia = current?.mediaClip ? attachments.find(item => item.id === current.mediaClip?.attachmentId) : undefined
  const availableTags = [...new Set(cards.flatMap(card => card.tags ?? []))].sort((a, b) => a.localeCompare(b, 'pl'))
  const examDaysRemaining = examDate ? Math.max(0, Math.ceil((new Date(examDate + 'T23:59:59').getTime() - now) / 86_400_000)) : 0
  const examDailyTarget = examDaysRemaining ? Math.ceil(Math.max(0, taggedCards.length - masteredCount) / examDaysRemaining) : 0
  const trueFalseStatement = useMemo(() => {
    if (!current) return { answer: '', isTrue: true }
    if (current.studyMode === 'true-false') return { answer: current.answer, isTrue: current.trueFalseAnswer ?? true }
    const otherAnswers = cards.filter(card => card.id !== current.id && card.answer.trim()).map(card => card.answer).filter(answer => ![current.answer, ...(current.answerVariants ?? [])].some(correct => normalizeQuestion(correct) === normalizeQuestion(answer)))
    const isTrue = (current.id.charCodeAt(current.id.length - 1) || 0) % 2 === 0 || !otherAnswers.length
    const wrongAnswer = otherAnswers[(current.id.charCodeAt(0) || 0) % Math.max(1, otherAnswers.length)]
    return { answer: isTrue ? current.answer : wrongAnswer ?? current.answer, isTrue }
  }, [current?.id, current?.studyMode, current?.trueFalseAnswer, current?.answer, cards])
  const choiceOptions = useMemo(() => {
    if (!current) return []
    const answers = [current.answer, ...(current.answerVariants ?? []), ...(current.aiDistractors ?? []), ...cards.filter(card => card.id !== current.id).map(card => card.answer)]
    const unique = [...new Map(answers.filter(value => value.trim()).map(value => [normalizeQuestion(value), value])).values()].slice(0, 4)
    for (let index = unique.length - 1; index > 0; index -= 1) {
      const swap = (current.id.charCodeAt(index % current.id.length) + index * 7) % (index + 1)
      ;[unique[index], unique[swap]] = [unique[swap]!, unique[index]!]
    }
    return unique
  }, [current?.id, cards])
  useEffect(() => {
    if (!currentId) return
    answerStartedAt.current = Date.now()
    setShowAnswer(false); setAnswerSubmitted(false); setAnswerInput(''); setChoiceValue(''); setHintLevel(0); setConfidence(3); setAiEvaluation(''); setAiError('')
    setSequenceOrder([...(current?.sequenceItems ?? [])].sort(() => Math.random() - .5))
  }, [currentId])
  useEffect(() => {
    if (examDeadline && now >= examDeadline) {
      setExamDeadline(null); setExamExpired(true); setSessionQueue([]); setShowAnswer(false)
    }
    if (breakDeadline && now >= breakDeadline) setBreakDeadline(null)
  }, [now, examDeadline, breakDeadline])

  function cardNote(card: Flashcard) { return card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined }
  function notePath(note: Note | undefined) { return note ? `${note.folder || 'Bez folderu'} / ${note.title || 'Bez tytułu'}` : 'Brak notatki' }
  function toggleSourceNote(id: string) {
    setSelectedDeckId('')
    setSessionQueue(null)
    setExcludedNoteIds(current => current.includes(id) ? current.filter(note => note !== id) : [...current, id])
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    const sequenceItems = textLines(sequenceDraft)
    const numeric = numericValue.trim() ? Number(numericValue) : Number.NaN
    const selectedAttachment = attachments.find(item => item.id === mediaAttachmentId && item.noteId === noteId)
    if (!question.trim() || !noteId || (cardKind === 'basic' && !answer.trim()) || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion)) || (cardKind === 'sequence' && sequenceItems.length < 2) || (cardKind === 'numeric' && !Number.isFinite(numeric)) || (cardKind === 'audio' && !selectedAttachment?.mimeType.startsWith('audio/')) || (cardKind === 'video' && !selectedAttachment?.mimeType.startsWith('video/'))) return
    const mediaClip = selectedAttachment ? { attachmentId: selectedAttachment.id, startMs: Math.max(0, Number(mediaStart) || 0) * 1000, endMs: mediaEnd.trim() ? Math.max(Number(mediaStart) || 0, Number(mediaEnd) || 0) * 1000 : undefined } : undefined
    onCreate(noteId, question.trim(), answer.trim(), cardKind, tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean), cardOcclusion, {
      template: templateDraft,
      studyMode: studyModeDraft,
      trueFalseAnswer: studyModeDraft === 'true-false' ? trueFalseAnswerDraft : undefined,
      hints: textLines(hintsDraft),
      answerVariants: textLines(variantsDraft),
      sequenceItems: cardKind === 'sequence' ? sequenceItems : undefined,
      numericAnswer: cardKind === 'numeric' ? { value: numeric, tolerance: Math.max(0, Number(numericTolerance) || 0), unit: numericUnit.trim() } : undefined,
      mediaClip: ['audio', 'video'].includes(cardKind) ? mediaClip : undefined,
      relatedCardIds: relatedDraft,
      glossaryTerms: parseGlossary(glossaryDraft),
    })
    setQuestion(''); setAnswer(''); setTab('cards'); setStudyModeDraft('flip'); setTrueFalseAnswerDraft(true); setTagsDraft(''); setCardOcclusion(undefined); setHintsDraft(''); setVariantsDraft(''); setSequenceDraft(''); setNumericValue(''); setNumericTolerance('0'); setNumericUnit(''); setMediaAttachmentId(''); setMediaStart('0'); setMediaEnd(''); setRelatedDraft([]); setGlossaryDraft('')
  }
  function startSession() {
    let selected = [...eligibleForSession]
    if (shuffleSession) {
      for (let index = selected.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[selected[index], selected[swap]] = [selected[swap]!, selected[index]!]
      }
    }
    selected = selected.slice(0, sessionCardLimit)
    setSessionQueue(selected.map(card => card.id))
    setSessionTotal(selected.length)
    setSessionCompleted(0)
    setShowAnswer(false)
    setAnswerSubmitted(false)
    setExamExpired(false)
    setExamDeadline(answerMode === 'timed-exam' ? Date.now() + sessionMinutes * 60_000 : null)
    setBreakDeadline(null)
  }
  function grade(value: FlashcardGrade) {
    if (!current) return
    onReview(current.id, value, { confidence, responseMs: Math.max(0, Date.now() - answerStartedAt.current), studyWeekdays })
    if (sessionQueue?.length === 1) {
      setExamDeadline(null)
      if (sessionTotal > 1) setBreakDeadline(Date.now() + 5 * 60_000)
    }
    setSessionQueue(queue => queue?.slice(1) ?? null)
    setSessionCompleted(count => count + 1)
    setShowAnswer(false)
    setAnswerSubmitted(false)
    setNow(Date.now())
  }
  function submitReviewAnswer(overrideValue?: string) {
    if (!current) return
    const selectedValue = overrideValue ?? choiceValue
    if (answerMode === 'true-false') {
      setAiEvaluation(selectedValue === String(trueFalseStatement.isTrue) ? 'Poprawna odpowiedź.' : 'Niepoprawna odpowiedź.')
      setAnswerSubmitted(true); setShowAnswer(true); return
    }
    if (answerMode === 'multiple-choice') {
      const correct = [current.answer, ...(current.answerVariants ?? [])].some(value => normalizeQuestion(value) === normalizeQuestion(selectedValue))
      setAiEvaluation(correct ? 'Poprawna odpowiedź.' : 'Niepoprawna odpowiedź.')
      setAnswerSubmitted(true); setShowAnswer(true); return
    }
    if (current.kind === 'sequence') {
      const correct = (current.sequenceItems ?? []).every((item, index) => item === sequenceOrder[index])
      setAiEvaluation(correct ? 'Kolejność jest poprawna.' : 'Kolejność nie jest poprawna.')
      setAnswerSubmitted(true); setShowAnswer(true); return
    }
    if (current.kind === 'numeric' && current.numericAnswer) {
      const value = Number(answerInput.trim().replace(',', '.').replace(current.numericAnswer.unit, '').trim())
      const correct = Number.isFinite(value) && Math.abs(value - current.numericAnswer.value) <= current.numericAnswer.tolerance
      setAiEvaluation(correct ? 'Wynik mieści się w tolerancji.' : 'Wynik poza tolerancją.')
      setAnswerSubmitted(true); setShowAnswer(true); return
    }
    setAnswerSubmitted(true)
    setShowAnswer(true)
  }
  async function checkDescriptiveAnswer() {
    if (!current || !answerInput.trim()) return
    setAiEvaluation('')
    if (onAiAssist) await runAi('evaluate', current, answerInput)
    setAnswerSubmitted(true)
    setShowAnswer(true)
  }
  function postpone(id: string, interval: string) {
    const duration = REVIEW_INTERVALS[interval]
    if (!duration) return
    onSetDueAt(id, Date.now() + duration)
    setNow(Date.now())
    if (sessionQueue?.[0] === id) { setSessionQueue(queue => queue?.slice(1) ?? null); if (sessionQueue.length === 1) setExamDeadline(null) }
  }
  function setManualDue(id: string, value: string) {
    const dueAt = new Date(value).getTime()
    if (!Number.isFinite(dueAt)) return
    onSetDueAt(id, dueAt)
    setNow(Date.now())
    if (sessionQueue?.[0] === id) { setSessionQueue(queue => queue?.slice(1) ?? null); if (sessionQueue.length === 1) setExamDeadline(null) }
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
    if (deck.cardIds || deck.dynamicRule) {
      setExcludedNoteIds([])
      setIncludeUnlinkedCards(true)
    } else {
      setExcludedNoteIds(notes.filter(note => !deck.noteIds.includes(note.id)).map(note => note.id))
      setIncludeUnlinkedCards(deck.includeUnlinkedCards)
    }
  }
  function saveDeck() {
    const name = deckName.trim()
    if (!name) return
    const deck: FlashcardDeck = {
      id: crypto.randomUUID(), name,
      noteIds: deckCreateMode === 'sources' ? notes.filter(note => !excludedIds.has(note.id)).map(note => note.id) : [],
      includeUnlinkedCards: deckCreateMode === 'sources' ? includeUnlinkedCards : true,
      cardIds: deckCreateMode === 'selected' ? [...selectedCardIds] : undefined,
      dynamicRule: deckCreateMode === 'dynamic' ? { tag: dynamicDeckTag || undefined, noteId: dynamicDeckNote || undefined, dueOnly: dynamicDueOnly } : undefined,
    }
    if (deckCreateMode === 'selected' && !deck.cardIds?.length) return
    setDecks(current => [...current, deck])
    setSelectedDeckId(deck.id)
    setDeckName('')
  }
  function beginEdit(card: Flashcard) {
    setEditingCardId(card.id)
    setEditQuestion(card.question)
    setEditAnswer(card.answer)
    setEditKind(card.kind ?? 'basic')
    setEditOcclusion(card.imageOcclusion)
    setEditTags(card.tags?.join(', ') ?? '')
    setEditMetadata({
      template: card.template, studyMode: card.studyMode ?? 'flip', trueFalseAnswer: card.trueFalseAnswer ?? true, hints: card.hints ?? [], answerVariants: card.answerVariants ?? [],
      sequenceItems: card.sequenceItems ?? [], numericAnswer: card.numericAnswer, mediaClip: card.mediaClip,
      aiDistractors: card.aiDistractors ?? [], difficulty: card.difficulty, example: card.example,
      mnemonic: card.mnemonic, relatedCardIds: card.relatedCardIds ?? [], glossaryTerms: card.glossaryTerms ?? [],
    })
  }
  function saveEdit(card: Flashcard) {
    const media = editMetadata.mediaClip ? attachments.find(item => item.id === editMetadata.mediaClip?.attachmentId && item.noteId === card.noteId) : undefined
    if (!editQuestion.trim() || (editKind === 'basic' && !editAnswer.trim()) || (editKind === 'cloze' && !hasCloze(editQuestion)) || (editKind === 'image-occlusion' && !hasOcclusionAnswers(editOcclusion)) || (editKind === 'sequence' && (editMetadata.sequenceItems?.length ?? 0) < 2) || (editKind === 'numeric' && !Number.isFinite(editMetadata.numericAnswer?.value)) || (editKind === 'audio' && !media?.mimeType.startsWith('audio/')) || (editKind === 'video' && !media?.mimeType.startsWith('video/'))) return
    onUpdate(card.id, {
      ...editMetadata, question: editQuestion.trim(), answer: editAnswer.trim(), kind: editKind,
      tags: editTags.split(',').map(tag => tag.trim()).filter(Boolean),
      imageOcclusion: editKind === 'image-occlusion' ? editOcclusion : undefined,
      sequenceItems: editKind === 'sequence' ? editMetadata.sequenceItems : undefined,
      numericAnswer: editKind === 'numeric' ? editMetadata.numericAnswer : undefined,
      mediaClip: editKind === 'audio' || editKind === 'video' ? editMetadata.mediaClip : undefined,
    })
    setEditingCardId('')
  }
  function moveSequenceItem(index: number, direction: -1 | 1) {
    setSequenceOrder(current => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }
  function openRelatedCard(card: Flashcard) {
    setTab('review')
    setSelectedDeckId('')
    setExcludedNoteIds([])
    setIncludeUnlinkedCards(true)
    setTagFilter('')
    setSessionQueue([card.id])
    setSessionTotal(1)
    setSessionCompleted(0)
    setAnswerMode(card.studyMode ?? 'flip')
    setShowAnswer(false)
    setExamDeadline(null)
    setBreakDeadline(null)
  }
  async function runAi(action: FlashcardAiAction, card?: Flashcard, input?: string) {
    if (!onAiAssist || aiBusy) return ''
    setAiError(''); setAiBusy(action)
    try {
      const result = await onAiAssist(action, card, input)
      const parsed = safeJsonValue(result)
      if (action === 'evaluate') setAiEvaluation(result.trim())
      else if (action === 'quality' || action === 'coverage') { setAiReport(result.trim()); setAiReportExpanded(false) }
      else if (action === 'distractors' && card) {
        const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { distractors?: unknown }).distractors) ? (parsed as { distractors: unknown[] }).distractors : []
        onUpdate(card.id, { aiDistractors: values.filter((value): value is string => typeof value === 'string').slice(0, 8) })
      } else if (action === 'tags') {
        const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.entries(parsed as Record<string, unknown>).map(([id, tags]) => ({ id, tags })) : []
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          const item = entry as { id?: unknown; tags?: unknown }
          if (typeof item.id === 'string' && Array.isArray(item.tags)) onUpdate(item.id, { tags: [...new Set(item.tags.filter((tag): tag is string => typeof tag === 'string'))] })
        }
      } else if (card && (action === 'example' || action === 'mnemonic')) {
        const content = typeof parsed === 'string' ? parsed : parsed && typeof parsed === 'object' ? String((parsed as Record<string, unknown>).text ?? (parsed as Record<string, unknown>)[action] ?? result) : result
        onUpdate(card.id, action === 'example' ? { example: content } : { mnemonic: content })
      } else if (action === 'difficulty' && card) {
        const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
        const difficulty = input as Flashcard['difficulty']
        onUpdate(card.id, { question: typeof value.question === 'string' ? value.question : card.question, answer: typeof value.answer === 'string' ? value.answer : card.answer, difficulty })
      }
      return result
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Nie udało się wykonać akcji AI.')
      return ''
    } finally { setAiBusy('') }
  }
  function mergeCards(first: Flashcard, second: Flashcard) {
    onUpdate(first.id, {
      answer: [first.answer, second.answer].filter(Boolean).join('\n\n'),
      tags: [...new Set([...(first.tags ?? []), ...(second.tags ?? [])])],
      answerVariants: [...new Set([...(first.answerVariants ?? []), ...(second.answerVariants ?? [])])],
      relatedCardIds: [...new Set([...(first.relatedCardIds ?? []), ...(second.relatedCardIds ?? [])])],
      reviewHistory: [...(first.reviewHistory ?? []), ...(second.reviewHistory ?? [])].sort((a, b) => a.at - b.at).slice(-500),
      dueAt: Math.min(first.dueAt, second.dueAt),
      intervalDays: Math.min(first.intervalDays, second.intervalDays),
      repetitions: Math.min(first.repetitions, second.repetitions),
      lapses: first.lapses + second.lapses,
    })
    onDelete(second)
  }
  function applyBulk(action: 'add-tag' | 'remove-tag' | 'suspend' | 'resume' | 'shift-due' | 'delete') {
    const selected = cards.filter(card => selectedCardIds.includes(card.id))
    for (const card of selected) {
      if (action === 'delete') onDelete(card)
      else if (action === 'suspend') onUpdate(card.id, { suspended: true })
      else if (action === 'resume') onUpdate(card.id, { suspended: false })
      else if (action === 'shift-due') onSetDueAt(card.id, Math.max(Date.now(), card.dueAt + bulkDueDays * 86_400_000))
      else {
        const tags = bulkTagDraft.split(',').map(tag => tag.trim()).filter(Boolean)
        onUpdate(card.id, { tags: action === 'add-tag' ? [...new Set([...(card.tags ?? []), ...tags])] : (card.tags ?? []).filter(tag => !tags.includes(tag)) })
      }
    }
    setSelectedCardIds([])
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
    <header className="flashcards-page-heading"><span className="folder-dialog-mark"><Brain size={19} /></span><div><h1 id="flashcards-title">Fiszki</h1><p>{due.length} do powtórki · {sourceFilteredCards.length} w wybranych źródłach · {selectedCount} notatek</p></div><button type="button" className={`flashcard-trash-shortcut${tab === 'trash' ? ' active' : ''}`} aria-label={`Otwórz kosz fiszek, ${trash.length} elementów`} aria-pressed={tab === 'trash'} title={`Kosz fiszek (${trash.length})`} onClick={() => setTab('trash')}><Trash2 size={17} />{trash.length > 0 && <span>{trash.length}</span>}</button></header>

    {aiReport && <aside className={`flashcard-ai-report-notification${aiReportExpanded ? ' is-expanded' : ''}`} aria-label="Powiadomienie o raporcie AI">
      <div className="flashcard-ai-report-notification-status" role="status" aria-live="polite"><span className="flashcard-ai-report-notification-mark"><Sparkles size={16} /></span><span><strong>Raport AI gotowy</strong><small>{aiReportExpanded ? 'Pełna analiza' : 'Rozwiń, aby przeczytać całość'}</small></span></div>
      <div className="flashcard-ai-report-notification-actions"><button type="button" className="button secondary" aria-expanded={aiReportExpanded} aria-controls="flashcard-ai-report-content" onClick={() => setAiReportExpanded(value => !value)}>{aiReportExpanded ? <><Minimize2 size={14} />Zwiń</> : <><Maximize2 size={14} />Rozwiń</>}</button><button type="button" className="icon-button" aria-label="Usuń powiadomienie o raporcie AI" title="Usuń powiadomienie" onClick={() => { setAiReport(''); setAiReportExpanded(false) }}><X size={16} /></button></div>
      <div id="flashcard-ai-report-content" className="flashcard-ai-report-notification-content" hidden={!aiReportExpanded}><RichCardContent value={aiReport} /></div>
    </aside>}

    <nav className="flashcard-view-tabs" aria-label="Widoki fiszek">
      <button type="button" className={tab === 'review' ? 'active' : ''} aria-pressed={tab === 'review'} onClick={() => setTab('review')}>Nauka <span>{due.length}</span></button>
      <button type="button" className={tab === 'cards' ? 'active' : ''} aria-pressed={tab === 'cards'} onClick={() => setTab('cards')}>Karty <span>{deckFilteredCards.length}</span></button>
      <button type="button" className={tab === 'create' ? 'active' : ''} aria-pressed={tab === 'create'} onClick={() => setTab('create')}>Dodaj</button>
      <button type="button" className={tab === 'progress' ? 'active' : ''} aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Postępy</button>
    </nav>

    {tab === 'progress' ? <section className="flashcard-page-panel flashcard-progress-panel" aria-label="Postępy i planowanie">
      <header className="flashcard-panel-heading"><div><h2>Postępy i planowanie</h2><p>Seria {studyStreak} dni · {reviewsToday}/{dailyGoal} powtórek dzisiaj · {due.length} do powtórki</p></div></header>
      <div className="flashcard-progress-content">
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

    <section className="flashcard-planning-tools" aria-label="Plan nauki">
      <div><strong>Dni nauki</strong><div className="flashcard-weekdays">{['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'].map((day, index) => <label key={day}><input type="checkbox" checked={studyWeekdays.includes(index)} onChange={() => setStudyWeekdays(value => value.includes(index) ? value.filter(item => item !== index) : [...value, index].sort())} /><span>{day}</span></label>)}</div><small>Terminy powtórek przesuną się na wybrane dni.</small></div>
      <div><strong>Plan do egzaminu</strong><label>Data egzaminu <input type="date" value={examDate} onChange={event => setExamDate(event.target.value)} /></label><small>{examDate ? examDaysRemaining ? examDaysRemaining + ' dni · około ' + examDailyTarget + ' nowych kart dziennie' : 'Data egzaminu już minęła.' : 'Ustaw datę, aby wyliczyć tempo nauki.'}</small></div>
      <div className="flashcard-mastery-rules"><strong>Utrwalenie kart według tagu i talii</strong>{selectedDeck && <label>{selectedDeck.name}<select aria-label={'Liczba powtórek do utrwalenia w talii: ' + selectedDeck.name} value={masteryRules['deck:' + selectedDeck.id] ?? 4} onChange={event => setMasteryRules(value => ({ ...value, ['deck:' + selectedDeck.id]: Number(event.target.value) }))}>{[2, 3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count} powtórek</option>)}</select></label>}{availableTags.length ? availableTags.slice(0, 8).map(tag => <label key={tag}>{tag}<select aria-label={'Liczba powtórek do utrwalenia: ' + tag} value={masteryRules[tag] ?? 4} onChange={event => setMasteryRules(value => ({ ...value, [tag]: Number(event.target.value) }))}>{[2, 3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count} powtórek</option>)}</select></label>) : <small>Dodaj tagi, aby ustawić reguły.</small>}</div>
    </section>

    <section className="flashcard-activity" aria-label="Kalendarz aktywności nauki"><div className="flashcard-activity-heading"><span><CalendarDays size={15} />Aktywność z ostatnich 12 tygodni</span><small>{activityCalendar.reduce((sum, day) => sum + day.count, 0)} powtórek</small></div><div className="flashcard-activity-months">{activityCalendar.filter(day => day.monthLabel).map(day => <span key={day.key}>{day.monthLabel}</span>)}</div><div className="flashcard-activity-grid">{activityCalendar.map(day => <span key={day.key} role="img" title={day.title} aria-label={day.title} data-level={day.level} />)}</div><div className="flashcard-activity-legend"><span>Mniej</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>Więcej</span></div></section>
      </div>
    </section> : tab === 'create' ? <section className="flashcard-page-panel flashcard-create-panel" aria-label="Dodaj fiszkę">
      <header className="flashcard-panel-heading"><div><h2>Dodaj fiszkę</h2><p>Wybierz rodzaj karty i wpisz pytanie z odpowiedzią.</p></div></header>
        <form className="flashcard-create-form" onSubmit={submit}>
          <select aria-label="Notatka dla karty" value={noteId} onChange={event => { setNoteId(event.target.value); setMediaAttachmentId('') }}>{notes.map(note => <option key={note.id} value={note.id}>{note.folder ? note.folder + ' / ' : ''}{note.title || 'Bez tytułu'}</option>)}</select>
          <label className="flashcard-kind-select"><span>Typ karty</span><select value={cardKind} onChange={event => { const kind = event.target.value as FlashcardKind; setCardKind(kind); if (kind === 'image-occlusion' && !question.trim()) setQuestion('Nazwij zakryte elementy.'); if (kind !== 'image-occlusion') setCardOcclusion(undefined) }}><option value="basic">Pytanie i odpowiedź</option><option value="cloze">Uzupełnij lukę</option><option value="image-occlusion">Zakrywanie obrazu</option><option value="sequence">Kolejność kroków</option><option value="numeric">Wynik liczbowy</option><option value="audio">Fragment audio</option><option value="video">Fragment wideo</option></select></label>
          <label className="flashcard-kind-select"><span>Typ nauki</span><select value={studyModeDraft} onChange={event => setStudyModeDraft(event.target.value as FlashcardStudyMode)}>{FLASHCARD_STUDY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
          {studyModeDraft === 'true-false' && <label className="flashcard-kind-select"><span>Poprawna ocena stwierdzenia</span><select value={String(trueFalseAnswerDraft)} onChange={event => setTrueFalseAnswerDraft(event.target.value === 'true')}><option value="true">Prawda</option><option value="false">Fałsz</option></select></label>}
          <FlashcardContentField label={cardKind === 'cloze' ? 'Tekst z luką, np. Stolica Francji to {{c1::Paryż}}.' : 'Pytanie'} value={question} onChange={setQuestion} />
          {cardKind === 'cloze' ? <p className="flashcard-cloze-help">Użyj <code>{'{{c1::odpowiedź}}'}</code> dla luki. Treść może zawierać LaTeX między znakami $…$ lub $$…$$ oraz tabele Markdown.</p> : null}
          {cardKind === 'image-occlusion' && <FlashcardImageOcclusionField value={cardOcclusion} onChange={setCardOcclusion} />}
          {cardKind === 'sequence' && <label className="flashcard-metadata-field">Prawidłowa kolejność, jeden element w wierszu<textarea value={sequenceDraft} onChange={event => setSequenceDraft(event.target.value)} rows={5} placeholder="Krok pierwszy&#10;Krok drugi&#10;Krok trzeci" /></label>}
          {cardKind === 'numeric' && <div className="flashcard-numeric-fields"><label>Wartość<input type="number" step="any" value={numericValue} onChange={event => setNumericValue(event.target.value)} /></label><label>Tolerancja ±<input type="number" min="0" step="any" value={numericTolerance} onChange={event => setNumericTolerance(event.target.value)} /></label><label>Jednostka<input value={numericUnit} onChange={event => setNumericUnit(event.target.value)} placeholder="np. kg" /></label></div>}
          {cardKind === 'audio' || cardKind === 'video' ? <div className="flashcard-media-fields"><label>Załącznik<select value={mediaAttachmentId} onChange={event => setMediaAttachmentId(event.target.value)}><option value="">Wybierz z załączników notatki</option>{attachments.filter(item => item.noteId === noteId && (cardKind === 'audio' ? item.mimeType.startsWith('audio/') : item.mimeType.startsWith('video/'))).map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label><label>Początek (s)<input type="number" min="0" step="0.1" value={mediaStart} onChange={event => setMediaStart(event.target.value)} /></label><label>Koniec (s)<input type="number" min="0" step="0.1" value={mediaEnd} onChange={event => setMediaEnd(event.target.value)} placeholder="do końca" /></label></div> : null}
          {cardKind !== 'cloze' && <FlashcardContentField label={cardKind === 'numeric' ? 'Wyjaśnienie (opcjonalne)' : cardKind === 'image-occlusion' ? 'Dodatkowa odpowiedź (opcjonalna)' : 'Odpowiedź'} value={answer} onChange={setAnswer} />}
          <details className="flashcard-metadata-editor"><summary>Podpowiedzi, warianty, szablon i powiązania</summary>
            <label>Szablon karty<select value={templateDraft} onChange={event => { const template = event.target.value as FlashcardTemplate; setTemplateDraft(template); if (!question.trim()) setQuestion(FLASHCARD_TEMPLATE_PROMPTS[template]) }}><option value="definition">Definicja</option><option value="cause-effect">Przyczyna i skutek</option><option value="comparison">Porównanie</option><option value="vocabulary">Słownictwo</option><option value="process">Proces</option><option value="formula">Wzór</option></select></label>
            <label>Podpowiedzi progresywne, jedna na wiersz<textarea value={hintsDraft} onChange={event => setHintsDraft(event.target.value)} rows={3} /></label>
            <label>Akceptowane warianty odpowiedzi, jeden na wiersz<textarea value={variantsDraft} onChange={event => setVariantsDraft(event.target.value)} rows={3} /></label>
            <label>Tagi fiszki<input value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} placeholder="Tagi, oddziel przecinkami" /></label>
            <label>Karty powiązane<select multiple value={relatedDraft} onChange={event => setRelatedDraft([...event.currentTarget.selectedOptions].map(option => option.value))}>{cards.map(card => <option key={card.id} value={card.id}>{card.question.slice(0, 100)}</option>)}</select></label>
            <label>Słowniczek: termin = definicja<textarea value={glossaryDraft} onChange={event => setGlossaryDraft(event.target.value)} rows={3} placeholder="mitoza = podział jądra komórkowego" /></label>
          </details>
          <button className="button primary" disabled={!noteId || !question.trim() || (cardKind === 'basic' && !answer.trim()) || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion)) || (cardKind === 'sequence' && textLines(sequenceDraft).length < 2) || (cardKind === 'numeric' && (!numericValue.trim() || !Number.isFinite(Number(numericValue))) ) || (cardKind === 'audio' && !attachments.some(item => item.id === mediaAttachmentId && item.noteId === noteId && item.mimeType.startsWith('audio/'))) || (cardKind === 'video' && !attachments.some(item => item.id === mediaAttachmentId && item.noteId === noteId && item.mimeType.startsWith('video/')))}><Plus size={15} />Dodaj fiszkę</button>
        </form>
    </section> :

    tab === 'review' ? <div className="flashcard-review-workspace">
      {sessionQueue === null && (
        <section className="flashcard-page-panel flashcard-scope-panel" aria-label="Zakres fiszek i talie">
      <header className="flashcard-panel-heading"><div><h2>Zakres i talie</h2><p>{sourceFilterLabel} · {selectedCount} notatek · {deckFilteredCards.length} kart w zakresie</p></div></header>
      <div className="flashcard-scope-content">
        <div className="flashcard-source-options-heading"><strong>Notatki źródłowe</strong><span>{sourceFilterLabel}</span></div><div className="flashcard-note-options"><button type="button" onClick={() => { setExcludedNoteIds([]); setIncludeUnlinkedCards(true); setSelectedDeckId(''); setSessionQueue(null) }}>Wszystkie notatki i fiszki</button>{notes.map(note => <button type="button" key={note.id} className="flashcard-note-option" aria-pressed={!excludedIds.has(note.id)} onClick={() => toggleSourceNote(note.id)}><span className="flashcard-note-option-mark" aria-hidden="true">{!excludedIds.has(note.id) && <Check size={11} />}</span><span>{note.folder ? `${note.folder} / ` : ''}{note.title || 'Bez tytułu'}</span></button>)}<button type="button" className="flashcard-note-option" aria-pressed={includeUnlinkedCards} onClick={() => { setIncludeUnlinkedCards(value => !value); setSelectedDeckId(''); setSessionQueue(null) }}><span className="flashcard-note-option-mark" aria-hidden="true">{includeUnlinkedCards && <Check size={11} />}</span><span>Fiszki bez notatki ({unlinkedCardCount})</span></button></div>

    <div className="flashcard-deck-tools"><label><Layers size={15} /><select aria-label="Zapisana talia" value={selectedDeckId} onChange={event => chooseDeck(event.target.value)}><option value="">Bieżący wybór źródeł</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><label className="flashcard-deck-mode"><span>Nowa talia</span><select value={deckCreateMode} onChange={event => setDeckCreateMode(event.target.value as typeof deckCreateMode)}><option value="sources">Źródła zaznaczone</option><option value="selected">Zaznaczone karty ({selectedCardIds.length})</option><option value="dynamic">Reguły dynamiczne</option></select></label>{deckCreateMode === 'dynamic' && <><select aria-label="Tag dynamicznej talii" value={dynamicDeckTag} onChange={event => setDynamicDeckTag(event.target.value)}><option value="">Dowolny tag</option>{availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select><select aria-label="Notatka dynamicznej talii" value={dynamicDeckNote} onChange={event => setDynamicDeckNote(event.target.value)}><option value="">Dowolna notatka</option>{notes.map(note => <option key={note.id} value={note.id}>{note.title || 'Bez tytułu'}</option>)}</select><label><input type="checkbox" checked={dynamicDueOnly} onChange={event => setDynamicDueOnly(event.target.checked)} />Tylko do powtórki</label></>}<input aria-label="Nazwa nowej talii" value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="Nazwa talii" /><button type="button" className="button secondary" disabled={!deckName.trim() || (deckCreateMode === 'selected' && !selectedCardIds.length)} onClick={saveDeck}>Zapisz talię</button>{selectedDeckId && <button type="button" className="icon-button" aria-label="Usuń zapisaną talię" title="Usuń talię" onClick={() => { setDecks(current => current.filter(deck => deck.id !== selectedDeckId)); setSelectedDeckId('') }}><Trash2 size={15} /></button>}</div>
      </div>
    </section>
      )}
      {sessionQueue === null ? <div className="flashcard-session-setup"><div className="flashcard-session-heading"><span className="flashcard-session-mark"><Shuffle size={17} /></span><div><h2>Sesja nauki</h2><p>Wybierz zakres i czas. Sesja obejmie tylko karty typu „{FLASHCARD_STUDY_MODES.find(mode => mode.value === answerMode)?.label}”.</p></div></div><div className="flashcard-session-controls"><label>Zakres<select value={sessionMode} onChange={event => setSessionMode(event.target.value as SessionMode)}><option value="due">Tylko do powtórki ({dueModeCards.length})</option><option value="all">Wszystkie karty ({activeModeCards.length})</option><option value="weak">Słabe karty ({weakModeCards.length})</option></select></label><label>Typ kart<select value={answerMode} onChange={event => setAnswerMode(event.target.value as AnswerMode)}>{FLASHCARD_STUDY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label><label>Liczba kart<select value={sessionLimit} disabled={timeSized} onChange={event => setSessionLimit(Number(event.target.value))}>{[5, 10, 20, 50, 100].map(count => <option key={count} value={count}>{count}</option>)}</select></label></div><section className="flashcard-page-panel flashcard-session-options-panel"><header className="flashcard-panel-heading"><div><h3>Dodatkowe ustawienia sesji</h3><p>Ustaw limit czasu, kolejność i priorytet słabych kart.</p></div></header><div className="flashcard-session-option-controls"><label className="flashcard-shuffle-toggle"><input type="checkbox" checked={timeSized} onChange={event => setTimeSized(event.target.checked)} /><span>Sesja na czas</span></label>{(timeSized || answerMode === 'timed-exam') && <label>Czas<select value={sessionMinutes} onChange={event => setSessionMinutes(Number(event.target.value))}>{[5, 10, 15, 20, 30, 45, 60].map(count => <option key={count} value={count}>{count} min</option>)}</select></label>}<label className="flashcard-shuffle-toggle"><input type="checkbox" checked={shuffleSession} onChange={event => setShuffleSession(event.target.checked)} /><span>Mieszaj kolejność</span></label><label className="flashcard-shuffle-toggle"><input type="checkbox" checked={weakOnly} onChange={event => setWeakOnly(event.target.checked)} /><span>Skup się na słabych kartach</span></label></div></section><small>Szacunkowo: około {sessionCardLimit} kart przy średnim czasie odpowiedzi {Math.round(averageResponseMs / 1000)} s.</small><button type="button" className="button primary" disabled={!eligibleForSession.length} onClick={startSession}><Brain size={15} />Rozpocznij sesję ({Math.min(sessionCardLimit, eligibleForSession.length)})</button></div>
        : current ? <div className="flashcard-review">
          <div className="flashcard-review-progress"><span>{sessionCompleted + 1} / {sessionTotal}</span><button type="button" className="link-button" onClick={() => { setSessionQueue(null); setExamDeadline(null); setBreakDeadline(null) }}>Zakończ sesję</button></div>
          {examDeadline && <div className="flashcard-exam-timer" role="timer">Egzamin · {Math.floor(Math.max(0, examDeadline - now) / 60_000)}:{String(Math.floor(Math.max(0, examDeadline - now) / 1000) % 60).padStart(2, '0')}</div>}
          {currentNote ? <button type="button" className="flashcard-note-path" onClick={() => onOpenNote(currentNote.id)}>{notePath(currentNote)}</button> : <small>{notePath(currentNote)}</small>}
          {current.tags?.length ? <small className="flashcard-review-tags">{current.tags.join(', ')}</small> : null}
          {answerMode !== 'true-false' && <RichCardContent className="flashcard-review-question" value={current.kind === 'cloze' ? clozeText(current.question, false) : current.question} />}
          {current.kind === 'image-occlusion' && current.imageOcclusion && <FlashcardOcclusionImage value={current.imageOcclusion} reveal={showAnswer} fallback={current.answer || 'Odpowiedź'} className="flashcard-review-occlusion" />}
          <FlashcardMediaClip attachment={activeMedia} clip={current.mediaClip} />
          {!showAnswer && current.hints?.length ? <div className="flashcard-progressive-hints">{hintLevel > 0 && <RichCardContent value={current.hints.slice(0, hintLevel).join('\n\n')} />}<button type="button" className="link-button" disabled={hintLevel >= current.hints.length} onClick={() => setHintLevel(value => Math.min(current.hints?.length ?? 0, value + 1))}>{hintLevel >= current.hints.length ? 'Wszystkie podpowiedzi pokazane' : 'Pokaż podpowiedź ' + (hintLevel + 1) + ' / ' + current.hints.length}</button></div> : null}
          {showAnswer ? <>{current.kind === 'image-occlusion' ? current.answer && <RichCardContent className="flashcard-answer" value={current.answer} /> : <RichCardContent className="flashcard-answer" value={current.kind === 'cloze' ? `${clozeText(current.question, true)}${current.answer.trim() ? `\n\n${current.answer}` : ''}` : current.answer} />}{current.kind === 'sequence' && !current.answer && <RichCardContent className="flashcard-answer" value={(current.sequenceItems ?? []).join(' → ')} />}{current.kind === 'numeric' && !current.answer && current.numericAnswer && <RichCardContent className="flashcard-answer" value={String(current.numericAnswer.value) + ' ' + current.numericAnswer.unit} />}{answerSubmitted && aiError && <p className="flashcard-form-error" role="alert">{aiError}</p>}{answerSubmitted && aiEvaluation && <p className="flashcard-answer-feedback">{aiEvaluation}</p>}
            {current.example && <div className="flashcard-answer-extra"><strong>Przykład</strong><RichCardContent value={current.example} /></div>}
            {current.mnemonic && <div className="flashcard-answer-extra"><strong>Skojarzenie</strong><RichCardContent value={current.mnemonic} /></div>}
            {current.glossaryTerms?.length ? <dl className="flashcard-glossary">{current.glossaryTerms.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}</dl> : null}
            {current.relatedCardIds?.length ? <div className="flashcard-related-cards"><strong>Powiązane karty</strong>{current.relatedCardIds.map(id => cards.find(card => card.id === id)).filter((card): card is Flashcard => Boolean(card)).map(card => <button type="button" key={card.id} onClick={() => openRelatedCard(card)}>{card.question}</button>)}</div> : null}
            <label className="flashcard-confidence">Pewność przed oceną: <strong>{confidence}/5</strong><input type="range" min="1" max="5" value={confidence} onChange={event => setConfidence(Number(event.target.value))} /></label>
            <p>Jak łatwo przypomniałeś sobie odpowiedź?</p><div className="flashcard-grades"><button onClick={() => grade('again')}>Ponownie <small>10 min</small></button><button onClick={() => grade('hard')}>Trudne</button><button onClick={() => grade('good')}>Dobrze</button><button onClick={() => grade('easy')}>Łatwe</button></div><label className="flashcard-postpone-control"><Clock3 size={14} /><span>Odłóż</span><select aria-label="Odłóż aktualną fiszkę" defaultValue="" onChange={event => { postpone(current.id, event.target.value); event.target.value = '' }}><option value="" disabled>Wybierz termin</option><option value="hour">1 godzinę</option><option value="day">Do jutra</option><option value="week">7 dni</option><option value="month">30 dni</option></select></label><label className="flashcard-date-control"><span>Ustaw dokładny termin</span><input aria-label="Dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(current.dueAt)} onChange={event => setManualDue(current.id, event.target.value)} /></label></>  : current.kind === 'sequence' ? <div className="flashcard-answer-input"><strong>Ułóż elementy we właściwej kolejności</strong>{sequenceOrder.map((item, index) => <div className="flashcard-sequence-row" key={index}><span>{index + 1}. {item}</span><button type="button" disabled={index === 0} onClick={() => moveSequenceItem(index, -1)}>↑</button><button type="button" disabled={index === sequenceOrder.length - 1} onClick={() => moveSequenceItem(index, 1)}>↓</button></div>)}<button type="button" className="button primary" onClick={() => submitReviewAnswer()}>Sprawdź kolejność</button></div>
            : current.kind === 'numeric' && current.numericAnswer ? <div className="flashcard-answer-input"><label>Wynik<input inputMode="decimal" value={answerInput} onChange={event => setAnswerInput(event.target.value)} placeholder={current.numericAnswer.unit || 'Liczba'} /></label><small>Tolerancja ±{current.numericAnswer.tolerance} {current.numericAnswer.unit}</small><button type="button" className="button primary" disabled={!answerInput.trim()} onClick={() => submitReviewAnswer()}>Sprawdź wynik</button></div>
              : answerMode === 'multiple-choice' ? <div className="flashcard-answer-input"><strong>Wybierz odpowiedź</strong>{choiceOptions.map(option => <button type="button" className={choiceValue === option ? 'flashcard-choice selected' : 'flashcard-choice'} key={option} aria-pressed={choiceValue === option} onClick={() => setChoiceValue(option)}>{option}</button>)}{choiceOptions.length < 4 && onAiAssist && <button type="button" className="link-button" disabled={aiBusy === 'distractors'} onClick={() => void runAi('distractors', current)}>Wygeneruj dystraktory AI</button>}<button type="button" className="button primary" disabled={!choiceValue} onClick={() => submitReviewAnswer()}>Sprawdź</button></div>
                : answerMode === 'true-false' ? <div className="flashcard-answer-input">{current.studyMode === 'true-false' ? <RichCardContent value={current.question} /> : <RichCardContent value={`${current.question} — ${trueFalseStatement.answer}`} />}<button type="button" className="button secondary" onClick={() => submitReviewAnswer('true')}>Prawda</button><button type="button" className="button secondary" onClick={() => submitReviewAnswer('false')}>Fałsz</button></div>
                  : answerMode === 'explain' || answerMode === 'timed-exam' ? <div className="flashcard-answer-input"><label>Twoja odpowiedź<textarea value={answerInput} onChange={event => setAnswerInput(event.target.value)} rows={4} disabled={Boolean(aiBusy)} /></label>{aiError && <p className="flashcard-form-error" role="alert">{aiError}</p>}<button type="button" className="button primary" disabled={!answerInput.trim() || Boolean(aiBusy)} onClick={() => void checkDescriptiveAnswer()}>{aiBusy === 'evaluate' ? 'Porównuję odpowiedź…' : onAiAssist ? 'Porównaj z AI i pokaż odpowiedź' : 'Sprawdź i pokaż odpowiedź'}</button></div>
                    : <button className="button primary" onClick={() => setShowAnswer(true)}>Pokaż odpowiedź <ChevronRight size={15} /></button>}
        </div> : <div className="flashcard-session-complete"><Check size={23} /><h2>{examExpired ? 'Czas egzaminu minął' : sessionCompleted ? 'Sesja zakończona' : 'Brak kart w tej sesji'}</h2><p>{sessionCompleted} z {sessionTotal} kart sprawdzono.</p>{breakDeadline && <div className="flashcard-pomodoro-break"><strong>Przerwa Pomodoro</strong><span>{Math.ceil(Math.max(0, breakDeadline - now) / 60_000)} min</span><button type="button" className="link-button" onClick={() => setBreakDeadline(null)}>Pomiń przerwę</button></div>}<button type="button" className="button primary" onClick={() => { setSessionQueue(null); setBreakDeadline(null) }}>Ustaw kolejną sesję</button></div>}
      </div> : tab === 'cards' ? <>
        <div className="flashcard-card-toolbar flashcard-card-search-toolbar"><label className="flashcard-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj w pytaniach, odpowiedziach i notatkach" /></label><span className="flashcard-result-count">{visibleCards.length} kart</span><label className="flashcard-page-size"><span>Na stronie</span><select aria-label="Liczba fiszek na stronę" value={cardsPerPage} onChange={event => { setCardsPerPage(Number(event.target.value) as FlashcardPageSize); setCardsPage(1) }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
        <section className="flashcard-page-panel flashcard-list-tools-panel">
          <header className="flashcard-panel-heading"><div><h2>Filtrowanie i analiza</h2><p>Sortuj karty, filtruj tagi i uruchamiaj narzędzia AI.</p></div></header>
          <div className="flashcard-card-toolbar flashcard-card-toolbar-tools"><label className="flashcard-sort"><span>Sortuj</span><select value={sortBy} onChange={event => setSortBy(event.target.value as FlashcardSort)}><option value="due">Termin powtórki</option><option value="hardest">Najtrudniejsze</option><option value="question">Pytanie A–Z</option><option value="recent">Ostatnio powtarzane</option></select></label><label className="flashcard-tag-filter"><span>Tag</span><select value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="">Wszystkie tagi</option>{availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>{onFindSimilar && <button type="button" className="button secondary flashcard-similar-button" title="Porównanie korzysta z modelu embeddingów ustawionego w Ollama." disabled={similarBusy || visibleCards.length < 2} onClick={() => void checkSimilarCards()}>{similarBusy ? <><Sparkles className="spin" size={14} />Porównuję…</> : <><Sparkles size={14} />Wykryj podobne</>}</button>}{onAiAssist && <><button type="button" className="button secondary" disabled={Boolean(aiBusy)} onClick={() => void runAi('quality', undefined, JSON.stringify(visibleCards.map(card => ({ id: card.id, question: card.question, answer: card.answer, tags: card.tags }))))}>Sprawdź jakość AI</button><button type="button" className="button secondary" disabled={Boolean(aiBusy)} onClick={() => void runAi('coverage', undefined, JSON.stringify(visibleCards.map(card => ({ question: card.question, answer: card.answer, tags: card.tags }))))}>Pokrycie tematów</button><button type="button" className="button secondary" disabled={Boolean(aiBusy)} onClick={() => void runAi('tags', undefined, JSON.stringify(visibleCards.map(card => ({ id: card.id, question: card.question, answer: card.answer, tags: card.tags }))))}>Nadaj tagi AI</button></>}<button type="button" className="link-button" onClick={() => setSelectedCardIds(selectedCardIds.length === visibleCards.length ? [] : visibleCards.map(card => card.id))}>{selectedCardIds.length ? 'Odznacz' : 'Zaznacz widoczne'}</button></div>
        </section>
        {!!selectedCardIds.length && <section className="flashcard-page-panel flashcard-bulk-panel"><header className="flashcard-panel-heading"><div><h2>Operacje zbiorcze</h2><p>{selectedCardIds.length} zaznaczono</p></div></header><div className="flashcard-bulk-toolbar"><strong>{selectedCardIds.length} zaznaczono</strong><input aria-label="Tagi do edycji zbiorczej" value={bulkTagDraft} onChange={event => setBulkTagDraft(event.target.value)} placeholder="Tagi, oddziel przecinkami" /><button type="button" onClick={() => applyBulk('add-tag')}>Dodaj tagi</button><button type="button" onClick={() => applyBulk('remove-tag')}>Usuń tagi</button><label>Przesuń termin o <input type="number" value={bulkDueDays} onChange={event => setBulkDueDays(Number(event.target.value) || 0)} /> dni</label><button type="button" onClick={() => applyBulk('shift-due')}>Zmień terminy</button><button type="button" onClick={() => applyBulk('suspend')}>Wstrzymaj</button><button type="button" onClick={() => applyBulk('resume')}>Wznów</button><button type="button" className="danger-icon" onClick={() => applyBulk('delete')}>Przenieś do kosza</button></div></section>}
        {similarError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{similarError}</p>}
        {aiError && <p className="flashcard-form-error" role="alert">{aiError}</p>}
        {similarMatches && <section className="flashcard-similar-results" aria-label="Podobne fiszki"><div className="flashcard-similar-heading"><strong>Podobne pytania · podobieństwo semantyczne</strong><button type="button" className="link-button" onClick={() => setSimilarMatches(null)}>Ukryj</button></div>{similarMatches.length ? similarMatches.map(match => { const first = cards.find(card => card.id === match.firstId); const second = cards.find(card => card.id === match.secondId); if (!first || !second) return null; return <article key={`${match.firstId}:${match.secondId}`}><button type="button" onClick={() => beginEdit(first)}><small>{notePath(cardNote(first))}</small>{first.question}</button><span>{Math.round(match.score * 100)}%</span><button type="button" onClick={() => beginEdit(second)}><small>{notePath(cardNote(second))}</small>{second.question}</button><button type="button" className="button secondary" onClick={() => mergeCards(first, second)}>Połącz karty</button></article> }) : <p>Nie znaleziono podobnych pytań w wybranym zestawie.</p>}</section>}
        {regenerateError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{regenerateError}</p>}
        <div className="flashcard-list">{pageCards.map(card => {
          const note = cardNote(card)
          const isEditing = editingCardId === card.id
          return <article key={card.id} className={isEditing ? 'is-editing' : ''}>
            {isEditing ? <div className="flashcard-edit-card">
              <div className="flashcard-edit-heading"><strong>Edytuj fiszkę</strong><button type="button" className="icon-button" aria-label="Anuluj edycję" onClick={() => setEditingCardId('')}><X size={15} /></button></div>
              <label className="flashcard-kind-select"><span>Typ karty</span><select value={editKind} onChange={event => { const kind = event.target.value as FlashcardKind; setEditKind(kind); if (kind !== 'image-occlusion') setEditOcclusion(undefined) }}><option value="basic">Pytanie i odpowiedź</option><option value="cloze">Uzupełnij lukę</option><option value="image-occlusion">Zakrywanie obrazu</option><option value="sequence">Kolejność kroków</option><option value="numeric">Wynik liczbowy</option><option value="audio">Fragment audio</option><option value="video">Fragment wideo</option></select></label>
              <label className="flashcard-kind-select"><span>Typ nauki</span><select value={editMetadata.studyMode ?? 'flip'} onChange={event => setEditMetadata(value => ({ ...value, studyMode: event.target.value as FlashcardStudyMode }))}>{FLASHCARD_STUDY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
              {editMetadata.studyMode === 'true-false' && <label className="flashcard-kind-select"><span>Poprawna ocena stwierdzenia</span><select value={String(editMetadata.trueFalseAnswer ?? true)} onChange={event => setEditMetadata(value => ({ ...value, trueFalseAnswer: event.target.value === 'true' }))}><option value="true">Prawda</option><option value="false">Fałsz</option></select></label>}
              <FlashcardContentField label={editKind === 'cloze' ? 'Tekst z luką' : 'Pytanie'} value={editQuestion} onChange={setEditQuestion} />
              {editKind === 'image-occlusion' && <FlashcardImageOcclusionField value={editOcclusion} onChange={setEditOcclusion} />}
              {editKind === 'sequence' && <label className="flashcard-metadata-field">Prawidłowa kolejność, jeden element w wierszu<textarea value={editMetadata.sequenceItems?.join(String.fromCharCode(10)) ?? ''} onChange={event => setEditMetadata(value => ({ ...value, sequenceItems: textLines(event.target.value) }))} rows={5} /></label>}
              {editKind === 'numeric' && <div className="flashcard-numeric-fields"><label>Wartość<input type="number" step="any" value={editMetadata.numericAnswer?.value ?? ''} onChange={event => setEditMetadata(value => ({ ...value, numericAnswer: { value: Number(event.target.value), tolerance: value.numericAnswer?.tolerance ?? 0, unit: value.numericAnswer?.unit ?? '' } }))} /></label><label>Tolerancja<input type="number" min="0" step="any" value={editMetadata.numericAnswer?.tolerance ?? 0} onChange={event => setEditMetadata(value => ({ ...value, numericAnswer: { value: value.numericAnswer?.value ?? 0, tolerance: Number(event.target.value), unit: value.numericAnswer?.unit ?? '' } }))} /></label><label>Jednostka<input value={editMetadata.numericAnswer?.unit ?? ''} onChange={event => setEditMetadata(value => ({ ...value, numericAnswer: { value: value.numericAnswer?.value ?? 0, tolerance: value.numericAnswer?.tolerance ?? 0, unit: event.target.value } }))} /></label></div>}
              {(editKind === 'audio' || editKind === 'video') && <div className="flashcard-media-fields"><label>Załącznik<select value={editMetadata.mediaClip?.attachmentId ?? ''} onChange={event => setEditMetadata(value => ({ ...value, mediaClip: { attachmentId: event.target.value, startMs: value.mediaClip?.startMs ?? 0, endMs: value.mediaClip?.endMs } }))}><option value="">Wybierz załącznik</option>{attachments.filter(item => item.noteId === card.noteId && (editKind === 'audio' ? item.mimeType.startsWith('audio/') : item.mimeType.startsWith('video/'))).map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label><label>Początek (s)<input type="number" min="0" step="0.1" value={(editMetadata.mediaClip?.startMs ?? 0) / 1000} onChange={event => setEditMetadata(value => ({ ...value, mediaClip: { attachmentId: value.mediaClip?.attachmentId ?? '', startMs: Math.max(0, Number(event.target.value) || 0) * 1000, endMs: value.mediaClip?.endMs } }))} /></label><label>Koniec (s)<input type="number" min="0" step="0.1" value={editMetadata.mediaClip?.endMs === undefined ? '' : editMetadata.mediaClip.endMs / 1000} onChange={event => setEditMetadata(value => ({ ...value, mediaClip: { attachmentId: value.mediaClip?.attachmentId ?? '', startMs: value.mediaClip?.startMs ?? 0, endMs: event.target.value ? Number(event.target.value) * 1000 : undefined } }))} /></label></div>}
              {editKind !== 'cloze' && <FlashcardContentField label="Odpowiedź / wyjaśnienie" value={editAnswer} onChange={setEditAnswer} />}
              {editKind === 'cloze' && <p className="flashcard-cloze-help">Użyj składni <code>{'{{c1::odpowiedź}}'}</code> w treści pytania.</p>}
              <details className="flashcard-metadata-editor" open><summary>Szablon, podpowiedzi i powiązania</summary>
                <label>Szablon<select value={editMetadata.template ?? 'definition'} onChange={event => setEditMetadata(value => ({ ...value, template: event.target.value as FlashcardTemplate }))}><option value="definition">Definicja</option><option value="cause-effect">Przyczyna i skutek</option><option value="comparison">Porównanie</option><option value="vocabulary">Słownictwo</option><option value="process">Proces</option><option value="formula">Wzór</option></select></label>
                <label>Podpowiedzi<textarea value={editMetadata.hints?.join(String.fromCharCode(10)) ?? ''} onChange={event => setEditMetadata(value => ({ ...value, hints: textLines(event.target.value) }))} rows={3} /></label>
                <label>Warianty odpowiedzi<textarea value={editMetadata.answerVariants?.join(String.fromCharCode(10)) ?? ''} onChange={event => setEditMetadata(value => ({ ...value, answerVariants: textLines(event.target.value) }))} rows={3} /></label>
                <label>Karty powiązane<select multiple value={editMetadata.relatedCardIds ?? []} onChange={event => setEditMetadata(value => ({ ...value, relatedCardIds: [...event.currentTarget.selectedOptions].map(option => option.value) }))}>{cards.filter(item => item.id !== card.id).map(item => <option key={item.id} value={item.id}>{item.question.slice(0, 100)}</option>)}</select></label>
                <label>Słowniczek: termin = definicja<textarea value={editMetadata.glossaryTerms?.map(item => item.term + ' = ' + item.definition).join(String.fromCharCode(10)) ?? ''} onChange={event => setEditMetadata(value => ({ ...value, glossaryTerms: parseGlossary(event.target.value) }))} rows={3} /></label>
              </details>
              <input className="flashcard-tags-input" aria-label="Tagi fiszki" value={editTags} onChange={event => setEditTags(event.target.value)} placeholder="Tagi, oddziel przecinkami" />
              <div className="flashcard-edit-actions"><button type="button" className="button secondary" onClick={() => setEditingCardId('')}>Anuluj</button><button type="button" className="button primary" onClick={() => saveEdit(card)}>Zapisz zmiany</button></div>
            </div> : <>
              <label className="flashcard-card-select"><input type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={event => setSelectedCardIds(value => event.target.checked ? [...new Set([...value, card.id])] : value.filter(id => id !== card.id))} /><span>Zaznacz kartę</span></label><div className="flashcard-list-content"><RichCardContent value={card.kind === 'cloze' ? clozeText(card.question, false) : card.question} />{card.kind === 'sequence' && card.sequenceItems?.length ? <small>Kolejność · {card.sequenceItems.length} kroków</small> : null}{card.kind === 'numeric' && card.numericAnswer ? <small>Odpowiedź liczbowa · tolerancja ±{card.numericAnswer.tolerance} {card.numericAnswer.unit}</small> : null}{card.mediaClip && <FlashcardMediaClip attachment={attachments.find(item => item.id === card.mediaClip?.attachmentId)} clip={card.mediaClip} />}{card.kind === 'image-occlusion' && card.imageOcclusion && <FlashcardOcclusionImage value={card.imageOcclusion} reveal={false} fallback="Odpowiedź" className="flashcard-image-occlusion-preview" />}<div className="flashcard-card-meta">{note ? <button type="button" className="flashcard-note-path" title={notePath(note)} onClick={() => onOpenNote(note.id)}>{notePath(note)}</button> : <small>Brak notatki</small>}<small>{card.suspended ? 'wstrzymana · ' : ''}{card.tags?.length ? `${card.tags.join(', ')} · ` : ''}{`${FLASHCARD_STUDY_MODES.find(mode => mode.value === (card.studyMode ?? 'flip'))?.label ?? 'Pokaż odpowiedź'} · `}{card.dueAt <= now ? 'do powtórzenia' : `następna: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(card.dueAt)}`}{card.kind === 'cloze' ? ' · luka' : card.kind === 'image-occlusion' ? ' · zakrywanie obrazu' : card.kind === 'sequence' ? ' · kolejność' : card.kind === 'numeric' ? ' · liczby' : card.kind === 'audio' ? ' · audio' : card.kind === 'video' ? ' · wideo' : ''}</small></div></div>
              <div className="flashcard-row-actions"><button type="button" className="icon-button" aria-label="Edytuj fiszkę" title="Edytuj" onClick={() => beginEdit(card)}><Pencil size={15} /></button><details className="flashcard-row-more"><summary>Więcej<ChevronDown size={12} aria-hidden="true" /></summary><div className="flashcard-row-more-actions">{onAiAssist && <details className="flashcard-row-ai"><summary><Sparkles size={14} />AI</summary><div><button type="button" onClick={() => void runAi('distractors', card)}>Dystraktory</button><button type="button" onClick={() => void runAi('example', card)}>Przykład i kontrprzykład</button><button type="button" onClick={() => void runAi('mnemonic', card)}>Skojarzenie</button><label>Poziom<select value={card.difficulty ?? 'intermediate'} onChange={event => void runAi('difficulty', card, event.target.value)}><option value="beginner">Początkujący</option><option value="intermediate">Średni</option><option value="advanced">Zaawansowany</option></select></label></div></details>}{onRegenerate && card.kind === 'basic' && <button type="button" className="icon-button" aria-label="Popraw fiszkę przy pomocy AI" title="Popraw przy pomocy AI" disabled={Boolean(regeneratingId)} onClick={() => void regenerate(card)}>{regeneratingId === card.id ? <Sparkles className="spin" size={15} /> : <Sparkles size={15} />}</button>}<button type="button" className="icon-button" aria-label={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} title={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} onClick={() => onToggleSuspend(card.id)}>{card.suspended ? <Play size={15} /> : <Pause size={15} />}</button><label className="flashcard-postpone-mini"><Clock3 size={13} /><select aria-label="Odłóż fiszkę" defaultValue="" onChange={event => { postpone(card.id, event.target.value); event.target.value = '' }}><option value="" disabled>Odłóż</option><option value="hour">+1 godz.</option><option value="day">Jutro</option><option value="week">+7 dni</option><option value="month">+30 dni</option></select></label><label className="flashcard-date-mini"><input aria-label="Ustaw dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(card.dueAt)} onChange={event => setManualDue(card.id, event.target.value)} /></label><button type="button" className="icon-button danger-icon" title="Usuń fiszkę" aria-label="Usuń fiszkę" onClick={() => onDelete(card)}><X size={15} /></button></div></details></div>
            </>}
          </article>
        })}{!visibleCards.length && <p className="flashcard-list-empty">Nie ma kart pasujących do wyszukiwania i wybranych filtrów.</p>}</div>
        <nav className="flashcard-pagination" aria-label="Paginacja fiszek">
          <span className="flashcard-pagination-range">{visibleCards.length ? `${firstVisibleCard + 1}–${lastVisibleCard} z ${visibleCards.length} fiszek` : 'Brak fiszek'}</span>
          <div className="flashcard-pagination-controls"><button type="button" className="button secondary" disabled={currentCardsPage <= 1} onClick={() => setCardsPage(currentCardsPage - 1)}>Poprzednia</button><span>Strona {currentCardsPage} z {pageCount}</span><button type="button" className="button secondary" disabled={currentCardsPage >= pageCount} onClick={() => setCardsPage(currentCardsPage + 1)}>Następna</button></div>
        </nav>
      </> : <section className="flashcard-trash-list" aria-label="Kosz fiszek">{trash.map(entry => <article key={entry.id}><div><strong>{entry.card.question}</strong><small>Usunięto {new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(entry.deletedAt)}</small><RichCardContent value={entry.card.answer} /></div><button type="button" className="button secondary" onClick={() => onRestoreTrash?.(entry.id)}>Przywróć</button><button type="button" className="icon-button danger-icon" aria-label="Usuń trwale" onClick={() => onPurgeTrash?.(entry.id)}><Trash2 size={15} /></button></article>)}{!trash.length && <p>Kosz jest pusty.</p>}</section>}
    </section>
  )
}
