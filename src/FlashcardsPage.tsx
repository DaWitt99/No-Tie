import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { Bell, Bold, Brain, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Code2, Flame, ImagePlus, Italic, Layers, Pause, Pencil, Play, Plus, Search, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
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
type FlashcardCardAiAction = Extract<FlashcardAiAction, 'distractors' | 'example' | 'mnemonic' | 'difficulty'>
type FlashcardCardAiResult = { action: FlashcardCardAiAction; state: 'running' | 'done' | 'error'; message: string; items?: string[]; content?: string; question?: string; answer?: string }

const DECK_STORAGE_KEY = 'no-tie-flashcard-decks'
const FLASHCARD_REMINDER_KEY = 'no-tie-flashcard-reminder'
const FLASHCARD_GOAL_KEY = 'no-tie-flashcard-daily-goal'
const FLASHCARD_DECK_GOALS_KEY = 'no-tie-flashcard-deck-goals'
const FLASHCARD_DECK_EXAM_DATES_KEY = 'no-tie-flashcard-deck-exam-dates'
const FLASHCARD_DECK_WEEKDAYS_KEY = 'no-tie-flashcard-deck-weekdays'
const FLASHCARD_DECK_REMINDERS_KEY = 'no-tie-flashcard-deck-reminders'
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
const FLASHCARD_AI_TASK_LABELS: Record<FlashcardAiAction, string> = {
  evaluate: 'Ocena odpowiedzi',
  distractors: 'Generowanie wariantów odpowiedzi',
  quality: 'Kontrola jakości fiszek',
  coverage: 'Analiza pokrycia tematów',
  tags: 'Nadawanie tagów fiszkom',
  example: 'Generowanie przykładu i kontrprzykładu',
  mnemonic: 'Generowanie skojarzenia',
  difficulty: 'Dostosowanie poziomu trudności',
}
const FLASHCARD_DIFFICULTY_LABELS: Record<NonNullable<Flashcard['difficulty']>, string> = {
  beginner: 'Początkujący',
  intermediate: 'Średni',
  advanced: 'Zaawansowany',
}

export type FlashcardAiTaskNotice = { id: number; label: string; startedAt: number; finishedAt?: number; state: 'running' | 'done' | 'error'; result?: string; resultExpanded?: boolean }

function readDecks(): FlashcardDeck[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is FlashcardDeck => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.noteIds) && item.noteIds.every((id: unknown) => typeof id === 'string') && typeof item.includeUnlinkedCards === 'boolean')) : []
  } catch { return [] }
}

function cardBelongsToDeck(card: Flashcard, deck: FlashcardDeck, notes: Note[], now: number) {
  if (deck.cardIds) return deck.cardIds.includes(card.id)
  if (deck.dynamicRule) {
    const rule = deck.dynamicRule
    if (rule.tag && !card.tags?.includes(rule.tag)) return false
    if (rule.noteId && card.noteId !== rule.noteId) return false
    if (rule.dueOnly && card.dueAt > now) return false
    return true
  }
  const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
  return note ? deck.noteIds.includes(note.id) : deck.includeUnlinkedCards
}

function readDeckNumberSettings(storageKey: string, legacyKey: string, fallback: number): Record<string, number> {
  let settings: Record<string, number> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      settings = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    }
  } catch { /* Migrate the previous single value below. */ }
  const firstDeck = readDecks()[0]
  if (firstDeck && settings[firstDeck.id] === undefined) {
    const legacyValue = Number(localStorage.getItem(legacyKey) ?? fallback)
    settings[firstDeck.id] = Number.isFinite(legacyValue) ? Math.max(1, Math.min(200, Math.round(legacyValue))) : fallback
  }
  return settings
}

function readDeckDateSettings(): Record<string, string> {
  let settings: Record<string, string> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FLASHCARD_DECK_EXAM_DATES_KEY) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      settings = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry[1])))
    }
  } catch { /* Migrate the previous single exam date below. */ }
  const firstDeck = readDecks()[0]
  const legacyDate = localStorage.getItem('no-tie-flashcard-exam-date') ?? ''
  if (firstDeck && settings[firstDeck.id] === undefined && /^\d{4}-\d{2}-\d{2}$/.test(legacyDate)) settings[firstDeck.id] = legacyDate
  return settings
}

function readGlobalStudyWeekdays() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('no-tie-flashcard-weekdays') ?? '[1,2,3,4,5]')
    return Array.isArray(value) ? value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : [1, 2, 3, 4, 5]
  } catch { return [1, 2, 3, 4, 5] }
}

function readDeckWeekdaySettings(): Record<string, number[]> {
  let settings: Record<string, number[]> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FLASHCARD_DECK_WEEKDAYS_KEY) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      settings = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number[]] => Array.isArray(entry[1]) && entry[1].every(day => Number.isInteger(day) && day >= 0 && day <= 6)))
    }
  } catch { /* Migrate the previous global schedule below. */ }
  const firstDeck = readDecks()[0]
  if (firstDeck && settings[firstDeck.id] === undefined) settings[firstDeck.id] = readGlobalStudyWeekdays()
  return settings
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

function readDeckReminderSettings(): Record<string, ReturnType<typeof readReminderPreference>> {
  let settings: Record<string, ReturnType<typeof readReminderPreference>> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FLASHCARD_DECK_REMINDERS_KEY) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value).filter(([, item]) => {
        if (!item || typeof item !== 'object') return false
        const reminder = item as { enabled?: unknown; time?: unknown }
        return typeof reminder.enabled === 'boolean' && typeof reminder.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time)
      }).map(([id, item]) => [id, item as ReturnType<typeof readReminderPreference>])
      settings = Object.fromEntries(entries)
    }
  } catch { /* Migrate the previous global reminder below. */ }
  const firstDeck = readDecks()[0]
  if (firstDeck && settings[firstDeck.id] === undefined) settings[firstDeck.id] = readReminderPreference()
  return settings
}

function deckTagMasteryKey(deckId: string, tag: string) { return `deck:${deckId}:tag:${tag}` }

function readMasteryRuleSettings(): Record<string, number> {
  let settings: Record<string, number> = {}
  try {
    const value: unknown = JSON.parse(localStorage.getItem('no-tie-flashcard-mastery-rules') ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      settings = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    }
  } catch { /* Use default mastery thresholds when storage is unavailable. */ }
  const decks = readDecks()
  const firstDeck = decks[0]
  if (firstDeck) {
    for (const [key, target] of Object.entries(settings)) {
      const isDeckRule = decks.some(deck => key === `deck:${deck.id}`)
      const isScopedTagRule = decks.some(deck => key.startsWith(`deck:${deck.id}:tag:`))
      if (!isDeckRule && !isScopedTagRule) {
        settings[deckTagMasteryKey(firstDeck.id, key)] ??= target
        delete settings[key]
      }
    }
  }
  return settings
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

export function FlashcardAiTaskResultContent({ value }: { value: string }) {
  return <RichCardContent value={value} className="flashcard-ai-task-result-rich" />
}

function FlashcardCardAiResultView({ result, onDismiss }: { result: FlashcardCardAiResult; onDismiss: () => void }) {
  return <aside className={`flashcard-card-ai-result is-${result.state}`} role={result.state === 'error' ? 'alert' : 'status'} aria-live="polite">
    <header>{result.state === 'running' ? <Sparkles className="spin" size={14} /> : result.state === 'done' ? <Check size={14} /> : <X size={14} />}<strong>{FLASHCARD_AI_TASK_LABELS[result.action]}</strong><button type="button" className="icon-button" aria-label="Ukryj wynik AI" title="Ukryj wynik" onClick={onDismiss}><X size={14} /></button></header>
    <p>{result.message}</p>
    {result.items && <ol>{result.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>}
    {result.content && <RichCardContent value={result.content} className="flashcard-card-ai-result-content" />}
    {result.question && <div className="flashcard-card-ai-result-field"><strong>Nowe pytanie</strong><RichCardContent value={result.question} />{result.answer && <><strong>Nowa odpowiedź</strong><RichCardContent value={result.answer} /></>}</div>}
  </aside>
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

export function FlashcardsPage({ cards, notes, attachments = [], trash = [], aiTaskNotices, onBeginAiTask, onFinishAiTask, onCreate, onUpdate, onReview, onSetDueAt, onToggleSuspend, onDelete, onRestoreTrash, onPurgeTrash, onRegenerate, onFindSimilar, onAiAssist, onOpenNote }: {
  cards: readonly Flashcard[]
  notes: Note[]
  attachments?: NoteAttachment[]
  trash?: FlashcardTrashEntry[]
  aiTaskNotices: FlashcardAiTaskNotice[]
  onBeginAiTask: (label: string) => number
  onFinishAiTask: (id: number, failed?: boolean, result?: string) => void
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
  const [answerOptionsDraft, setAnswerOptionsDraft] = useState(['', '', '', ''])
  const [correctAnswerOption, setCorrectAnswerOption] = useState(0)
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
  const [tab, setTab] = useState<'review' | 'scope' | 'cards' | 'create' | 'progress' | 'trash'>('review')
  const [now, setNow] = useState(() => Date.now())
  const [excludedNoteIds, setExcludedNoteIds] = useState<string[]>([])
  const [includeUnlinkedCards, setIncludeUnlinkedCards] = useState(true)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<FlashcardSort>('due')
  const [cardsPerPage, setCardsPerPage] = useState<FlashcardPageSize>(25)
  const [cardsPage, setCardsPage] = useState(1)
  const [decks, setDecks] = useState<FlashcardDeck[]>(readDecks)
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [sessionDeckId, setSessionDeckId] = useState('')
  const [progressDeckId, setProgressDeckId] = useState(() => localStorage.getItem('no-tie-flashcard-progress-deck') ?? readDecks()[0]?.id ?? '')
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
  const [cardAiResults, setCardAiResults] = useState<Record<string, FlashcardCardAiResult>>({})
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
  const [dailyGoals, setDailyGoals] = useState<Record<string, number>>(() => readDeckNumberSettings(FLASHCARD_DECK_GOALS_KEY, FLASHCARD_GOAL_KEY, 20))
  const [defaultReminderPreference] = useState(readReminderPreference)
  const [reminderSettings, setReminderSettings] = useState<Record<string, ReturnType<typeof readReminderPreference>>>(readDeckReminderSettings)
  const [defaultStudyWeekdays] = useState<number[]>(readGlobalStudyWeekdays)
  const [weekdayPlans, setWeekdayPlans] = useState<Record<string, number[]>>(readDeckWeekdaySettings)
  const [examDates, setExamDates] = useState<Record<string, string>>(readDeckDateSettings)
  const [masteryRules, setMasteryRules] = useState<Record<string, number>>(readMasteryRuleSettings)

  const hasRunningAiTask = aiTaskNotices.some(task => task.state === 'running')
  useEffect(() => { const interval = examDeadline || breakDeadline || hasRunningAiTask ? 1000 : 60_000; const timer = window.setInterval(() => setNow(Date.now()), interval); return () => window.clearInterval(timer) }, [examDeadline, breakDeadline, hasRunningAiTask])
  useEffect(() => {
    const closeMenusOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      document.querySelectorAll<HTMLDetailsElement>('details.flashcard-row-more[open], details.flashcard-row-ai[open]').forEach(menu => {
        if (menu.contains(event.target as Node)) return
        menu.open = false
        menu.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(nestedMenu => { nestedMenu.open = false })
      })
    }
    document.addEventListener('pointerdown', closeMenusOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsidePress)
  }, [])
  useEffect(() => { try { localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks)) } catch { /* Decks remain available in memory if storage is full. */ } }, [decks])
  useEffect(() => { try { localStorage.setItem('no-tie-flashcard-progress-deck', progressDeckId) } catch { /* Keep the selected progress deck in memory if storage is unavailable. */ } }, [progressDeckId])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_DECK_GOALS_KEY, JSON.stringify(dailyGoals)) } catch { /* Keep goals in memory if storage is unavailable. */ } }, [dailyGoals])
  useEffect(() => {
    const firstDeck = decks[0]
    if (!firstDeck || dailyGoals[firstDeck.id] !== undefined) return
    const legacyGoal = Number(localStorage.getItem(FLASHCARD_GOAL_KEY) ?? '20')
    setDailyGoals(current => current[firstDeck.id] !== undefined ? current : { ...current, [firstDeck.id]: Number.isFinite(legacyGoal) ? Math.max(1, Math.min(200, Math.round(legacyGoal))) : 20 })
  }, [decks, dailyGoals])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_DECK_REMINDERS_KEY, JSON.stringify(reminderSettings)) } catch { /* Reminder settings stay available in memory until the page closes. */ } }, [reminderSettings])
  useEffect(() => {
    const firstDeck = decks[0]
    if (!firstDeck || reminderSettings[firstDeck.id] !== undefined) return
    setReminderSettings(current => current[firstDeck.id] !== undefined ? current : { ...current, [firstDeck.id]: defaultReminderPreference })
  }, [decks, reminderSettings, defaultReminderPreference])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_DECK_WEEKDAYS_KEY, JSON.stringify(weekdayPlans)) } catch { /* Weekday plans stay available until the page closes. */ } }, [weekdayPlans])
  useEffect(() => {
    const firstDeck = decks[0]
    if (!firstDeck || weekdayPlans[firstDeck.id] !== undefined) return
    setWeekdayPlans(current => current[firstDeck.id] !== undefined ? current : { ...current, [firstDeck.id]: defaultStudyWeekdays })
  }, [decks, weekdayPlans, defaultStudyWeekdays])
  useEffect(() => { try { localStorage.setItem(FLASHCARD_DECK_EXAM_DATES_KEY, JSON.stringify(examDates)) } catch { /* Keep exam dates in memory if storage is unavailable. */ } }, [examDates])
  useEffect(() => {
    const firstDeck = decks[0]
    const legacyDate = localStorage.getItem('no-tie-flashcard-exam-date') ?? ''
    if (!firstDeck || examDates[firstDeck.id] !== undefined || !/^\d{4}-\d{2}-\d{2}$/.test(legacyDate)) return
    setExamDates(current => current[firstDeck.id] !== undefined ? current : { ...current, [firstDeck.id]: legacyDate })
  }, [decks, examDates])
  useEffect(() => { try { localStorage.setItem('no-tie-flashcard-mastery-rules', JSON.stringify(masteryRules)) } catch { /* Keep mastery rules in memory if storage is unavailable. */ } }, [masteryRules])

  const excludedIds = useMemo(() => new Set(excludedNoteIds), [excludedNoteIds])
  const sourceFilteredCards = useMemo(() => cards.filter(card => {
    const note = card.noteId ? resolveWikiTarget(notes, card.noteId) : undefined
    return note ? !excludedIds.has(note.id) : includeUnlinkedCards
  }), [cards, notes, excludedIds, includeUnlinkedCards])
  const unlinkedCardCount = useMemo(() => cards.filter(card => !card.noteId || !resolveWikiTarget(notes, card.noteId)).length, [cards, notes])
  const selectedDeck = decks.find(deck => deck.id === selectedDeckId)
  const sessionDeck = decks.find(deck => deck.id === sessionDeckId)
  const progressDeck = decks.find(deck => deck.id === progressDeckId) ?? decks[0]
  const dailyGoal = progressDeck ? dailyGoals[progressDeck.id] ?? 20 : 20
  const examDate = progressDeck ? examDates[progressDeck.id] ?? '' : ''
  const progressStudyWeekdays = progressDeck ? weekdayPlans[progressDeck.id] ?? defaultStudyWeekdays : defaultStudyWeekdays
  const progressReminder = progressDeck ? reminderSettings[progressDeck.id] ?? defaultReminderPreference : defaultReminderPreference
  const reminderEnabled = progressReminder.enabled
  const reminderTime = progressReminder.time
  const studyWeekdays = sessionDeck ? weekdayPlans[sessionDeck.id] ?? defaultStudyWeekdays : defaultStudyWeekdays
  const deckFilteredCards = useMemo(() => sourceFilteredCards.filter(card => !selectedDeck || cardBelongsToDeck(card, selectedDeck, notes, now)), [sourceFilteredCards, selectedDeck, notes, now])
  const dynamicDeckPreviewCount = useMemo(() => cards.filter(card =>
    (!dynamicDeckTag || card.tags?.includes(dynamicDeckTag)) &&
    (!dynamicDeckNote || card.noteId === dynamicDeckNote) &&
    (!dynamicDueOnly || card.dueAt <= now)
  ).length, [cards, dynamicDeckTag, dynamicDeckNote, dynamicDueOnly, now])
  const sessionDeckCards = useMemo(() => cards.filter(card => !sessionDeck || cardBelongsToDeck(card, sessionDeck, notes, now)), [cards, sessionDeck, notes, now])
  const progressDeckCards = useMemo(() => progressDeck ? cards.filter(card => cardBelongsToDeck(card, progressDeck, notes, now)) : [], [cards, progressDeck, notes, now])
  const taggedCards = useMemo(() => tagFilter ? cards.filter(card => card.tags?.includes(tagFilter)) : cards, [cards, tagFilter])
  const activeCards = useMemo(() => sessionDeckCards.filter(card => !card.suspended), [sessionDeckCards])
  const sessionDueCount = activeCards.filter(card => card.dueAt <= now).length
  const due = useMemo(() => cards.filter(card => !card.suspended && card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt), [cards, now])
  const currentId = sessionQueue?.[0]
  const current = currentId ? cards.find(card => card.id === currentId) : undefined
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
  const cardDeckMembership = useMemo(() => {
    const memberships = new Map<string, FlashcardDeck[]>()
    for (const card of pageCards) memberships.set(card.id, decks.filter(deck => cardBelongsToDeck(card, deck, notes, now)))
    return memberships
  }, [pageCards, decks, notes, now])
  const selectedCards = useMemo(() => cards.filter(card => selectedCardIds.includes(card.id)), [cards, selectedCardIds])
  useEffect(() => { setCardsPage(1) }, [query, tagFilter])
  useEffect(() => { setSimilarMatches(null) }, [visibleCards])

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const progressActiveCards = progressDeckCards.filter(card => !card.suspended)
  const progressDueCards = progressActiveCards.filter(card => card.dueAt <= now)
  const reviewEvents = progressDeckCards.flatMap(card => card.reviewHistory ?? [])
  const eventsToday = reviewEvents.filter(event => event.at >= dayStart.getTime())
  const legacyReviewsToday = progressDeckCards.filter(card => !card.reviewHistory?.length && (card.lastReviewedAt ?? 0) >= dayStart.getTime()).length
  const reviewsToday = eventsToday.length + legacyReviewsToday
  const successfulReviews = reviewEvents.filter(event => event.grade !== 'again').length
  const successRate = reviewEvents.length ? Math.round(successfulReviews / reviewEvents.length * 100) : undefined
  const isMastered = (card: Flashcard) => {
    const deckTarget = progressDeck ? masteryRules['deck:' + progressDeck.id] : undefined
    const configured = (card.tags ?? []).map(tag => masteryRules[deckTagMasteryKey(progressDeck?.id ?? '', tag)]).filter((value): value is number => Number.isFinite(value))
    const target = Math.max(1, Math.min(50, Math.round(deckTarget ?? (configured.length ? Math.max(...configured) : 4))))
    return card.repetitions >= target
  }
  const masteredCount = progressDeckCards.filter(isMastered).length
  const activityByDay = new Map<string, number>()
  for (const event of reviewEvents) {
    const key = localDateKey(new Date(event.at))
    activityByDay.set(key, (activityByDay.get(key) ?? 0) + 1)
  }
  for (const card of progressDeckCards) {
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
  const sessionReviewEvents = sessionDeckCards.flatMap(card => card.reviewHistory ?? [])
  const averageResponseMs = Math.round(sessionReviewEvents.reduce((total, event) => total + (event.responseMs ?? 25_000), 0) / Math.max(1, sessionReviewEvents.length))
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
  const progressAvailableTags = [...new Set(progressDeckCards.flatMap(card => card.tags ?? []))].sort((a, b) => a.localeCompare(b, 'pl'))
  const examDaysRemaining = examDate ? Math.max(0, Math.ceil((new Date(examDate + 'T23:59:59').getTime() - now) / 86_400_000)) : 0
  const examDailyTarget = examDaysRemaining ? Math.ceil(Math.max(0, progressDeckCards.length - masteredCount) / examDaysRemaining) : 0
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
    const answers = current.studyMode === 'multiple-choice'
      ? [current.answer, ...(current.aiDistractors?.length ? current.aiDistractors : current.answerVariants ?? [])]
      : [current.answer, ...(current.answerVariants ?? []), ...(current.aiDistractors ?? []), ...cards.filter(card => card.id !== current.id).map(card => card.answer)]
    const unique = [...new Map(answers.filter(value => value.trim()).map(value => [normalizeQuestion(value), value])).values()].slice(0, current.studyMode === 'multiple-choice' ? 8 : 4)
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
    const correctAnswer = studyModeDraft === 'multiple-choice' ? answerOptionsDraft[correctAnswerOption]?.trim() ?? '' : studyModeDraft === 'true-false' ? trueFalseAnswerDraft ? 'Prawda' : 'Fałsz' : answer.trim()
    const invalidOptions = studyModeDraft === 'multiple-choice' && (answerOptionsDraft.length < 2 || answerOptionsDraft.some(option => !option.trim()) || !correctAnswer)
    if (!question.trim() || !noteId || (cardKind === 'basic' && studyModeDraft !== 'multiple-choice' && studyModeDraft !== 'true-false' && !answer.trim()) || invalidOptions || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion)) || (cardKind === 'sequence' && sequenceItems.length < 2) || (cardKind === 'numeric' && !Number.isFinite(numeric)) || (cardKind === 'audio' && !selectedAttachment?.mimeType.startsWith('audio/')) || (cardKind === 'video' && !selectedAttachment?.mimeType.startsWith('video/'))) return
    const mediaClip = selectedAttachment ? { attachmentId: selectedAttachment.id, startMs: Math.max(0, Number(mediaStart) || 0) * 1000, endMs: mediaEnd.trim() ? Math.max(Number(mediaStart) || 0, Number(mediaEnd) || 0) * 1000 : undefined } : undefined
    onCreate(noteId, question.trim(), correctAnswer, cardKind, tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean), cardOcclusion, {
      template: templateDraft,
      studyMode: studyModeDraft,
      trueFalseAnswer: studyModeDraft === 'true-false' ? trueFalseAnswerDraft : undefined,
      hints: textLines(hintsDraft),
      answerVariants: studyModeDraft === 'multiple-choice' ? [] : textLines(variantsDraft),
      aiDistractors: studyModeDraft === 'multiple-choice' ? answerOptionsDraft.filter((_, index) => index !== correctAnswerOption).map(option => option.trim()) : undefined,
      sequenceItems: cardKind === 'sequence' ? sequenceItems : undefined,
      numericAnswer: cardKind === 'numeric' ? { value: numeric, tolerance: Math.max(0, Number(numericTolerance) || 0), unit: numericUnit.trim() } : undefined,
      mediaClip: ['audio', 'video'].includes(cardKind) ? mediaClip : undefined,
      relatedCardIds: relatedDraft,
      glossaryTerms: parseGlossary(glossaryDraft),
    })
    setQuestion(''); setAnswer(''); setTab('cards'); setStudyModeDraft('flip'); setTrueFalseAnswerDraft(true); setAnswerOptionsDraft(['', '', '', '']); setCorrectAnswerOption(0); setTagsDraft(''); setCardOcclusion(undefined); setHintsDraft(''); setVariantsDraft(''); setSequenceDraft(''); setNumericValue(''); setNumericTolerance('0'); setNumericUnit(''); setMediaAttachmentId(''); setMediaStart('0'); setMediaEnd(''); setRelatedDraft([]); setGlossaryDraft('')
  }
  function updateAnswerOption(index: number, value: string) {
    setAnswerOptionsDraft(current => current.map((option, optionIndex) => optionIndex === index ? value : option))
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
    if (!editQuestion.trim() || (editKind === 'basic' && editMetadata.studyMode !== 'true-false' && !editAnswer.trim()) || (editKind === 'cloze' && !hasCloze(editQuestion)) || (editKind === 'image-occlusion' && !hasOcclusionAnswers(editOcclusion)) || (editKind === 'sequence' && (editMetadata.sequenceItems?.length ?? 0) < 2) || (editKind === 'numeric' && !Number.isFinite(editMetadata.numericAnswer?.value)) || (editKind === 'audio' && !media?.mimeType.startsWith('audio/')) || (editKind === 'video' && !media?.mimeType.startsWith('video/'))) return
    onUpdate(card.id, {
      ...editMetadata, question: editQuestion.trim(), answer: editMetadata.studyMode === 'true-false' ? editMetadata.trueFalseAnswer ? 'Prawda' : 'Fałsz' : editAnswer.trim(), kind: editKind,
      tags: editTags.split(',').map(tag => tag.trim()).filter(Boolean),
      imageOcclusion: editKind === 'image-occlusion' ? editOcclusion : undefined,
      sequenceItems: editKind === 'sequence' ? editMetadata.sequenceItems : undefined,
      numericAnswer: editKind === 'numeric' ? editMetadata.numericAnswer : undefined,
      mediaClip: editKind === 'audio' || editKind === 'video' ? editMetadata.mediaClip : undefined,
    })
    setCardAiResults(current => {
      const next = { ...current }
      delete next[card.id]
      return next
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
    setSessionDeckId('')
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
    const cardAction: FlashcardCardAiAction | undefined = card && (action === 'distractors' || action === 'example' || action === 'mnemonic' || action === 'difficulty') ? action : undefined
    const taskId = onBeginAiTask(FLASHCARD_AI_TASK_LABELS[action])
    let failed = false
    let notificationResult = ''
    setAiError(''); setAiBusy(action)
    if (card && cardAction) setCardAiResults(current => ({ ...current, [card.id]: { action: cardAction, state: 'running', message: 'AI pracuje nad tą fiszką…' } }))
    try {
      const result = await onAiAssist(action, card, input)
      const parsed = safeJsonValue(result)
      if (action === 'evaluate') { setAiEvaluation(result.trim()); notificationResult = result.trim() }
      else if (action === 'quality' || action === 'coverage') notificationResult = result.trim()
      else if (action === 'distractors' && card) {
        const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { distractors?: unknown }).distractors) ? (parsed as { distractors: unknown[] }).distractors : []
        const distractors = [...new Set(values.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, 8)
        if (!distractors.length) throw new Error('AI nie zwróciło żadnych propozycji. Spróbuj ponownie.')
        onUpdate(card.id, { aiDistractors: distractors })
        notificationResult = `Wygenerowane dystraktory:\n${distractors.map(value => `- ${value}`).join('\n')}`
        setCardAiResults(current => ({ ...current, [card.id]: { action: 'distractors', state: 'done', message: `Zapisano ${distractors.length} błędnych wariantów odpowiedzi. Możesz z nich korzystać w sesji w trybie „Warianty odpowiedzi”.`, items: distractors } }))
      } else if (action === 'tags') {
        const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.entries(parsed as Record<string, unknown>).map(([id, tags]) => ({ id, tags })) : []
        let updatedCount = 0
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          const item = entry as { id?: unknown; tags?: unknown }
          if (typeof item.id === 'string' && Array.isArray(item.tags)) { onUpdate(item.id, { tags: [...new Set(item.tags.filter((tag): tag is string => typeof tag === 'string'))] }); updatedCount += 1 }
        }
        if (!updatedCount) throw new Error('AI nie zwróciło tagów, które można przypisać do fiszek.')
        notificationResult = `Zaktualizowano tagi w ${updatedCount} fiszkach.`
      } else if (card && (action === 'example' || action === 'mnemonic')) {
        const content = (typeof parsed === 'string' ? parsed : parsed && typeof parsed === 'object' ? String((parsed as Record<string, unknown>).text ?? (parsed as Record<string, unknown>)[action] ?? result) : result).trim()
        if (!content) throw new Error('AI nie zwróciło treści. Spróbuj ponownie.')
        onUpdate(card.id, action === 'example' ? { example: content } : { mnemonic: content })
        notificationResult = content
        setCardAiResults(current => ({ ...current, [card.id]: { action, state: 'done', message: action === 'example' ? 'Dodano przykład i kontrprzykład do wyjaśnienia fiszki.' : 'Dodano skojarzenie pomagające zapamiętać odpowiedź.', content } }))
      } else if (action === 'difficulty' && card) {
        const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
        const difficulty = input as Flashcard['difficulty']
        if (!['beginner', 'intermediate', 'advanced'].includes(difficulty ?? '') || typeof value.question !== 'string' || !value.question.trim() || typeof value.answer !== 'string' || !value.answer.trim()) throw new Error('AI nie zwróciło nowego pytania i odpowiedzi. Spróbuj ponownie.')
        const question = value.question.trim()
        const answer = value.answer.trim()
        onUpdate(card.id, { question, answer, difficulty })
        notificationResult = `Pytanie: ${question}\n\nOdpowiedź: ${answer}`
        setCardAiResults(current => ({ ...current, [card.id]: { action: 'difficulty', state: 'done', message: `Przeredagowano pytanie i odpowiedź na poziom: ${FLASHCARD_DIFFICULTY_LABELS[difficulty!]}.`, question, answer } }))
      }
      return result
    } catch (error) {
      failed = true
      const message = error instanceof Error ? error.message : 'Nie udało się wykonać akcji AI.'
      notificationResult = message
      if (card && cardAction) setCardAiResults(current => ({ ...current, [card.id]: { action: cardAction, state: 'error', message } }))
      else setAiError(message)
      return ''
    } finally { setAiBusy(''); onFinishAiTask(taskId, failed, notificationResult) }
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
    if (!selectedCards.length) return
    for (const card of selectedCards) {
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
    const taskId = onBeginAiTask('Wykrywanie podobnych fiszek')
    let failed = false
    let notificationResult = ''
    setSimilarError('')
    setSimilarBusy(true)
    try {
      const matches = await onFindSimilar(visibleCards)
      setSimilarMatches(matches)
      notificationResult = matches.length ? matches.map(match => {
        const first = visibleCards.find(card => card.id === match.firstId)
        const second = visibleCards.find(card => card.id === match.secondId)
        return first && second ? `${Math.round(match.score * 100)}% podobieństwa\n${first.question}\n↔ ${second.question}` : ''
      }).filter(Boolean).join('\n\n') : 'Nie znaleziono podobnych pytań w wybranym zestawie.'
    } catch (error) {
      failed = true
      notificationResult = error instanceof Error ? error.message : typeof error === 'string' && error.trim() ? error : 'Nie udało się porównać pytań.'
      setSimilarError(notificationResult)
    } finally { setSimilarBusy(false); onFinishAiTask(taskId, failed, notificationResult) }
  }
  async function setReminder(value: boolean) {
    if (!progressDeck) return
    if (value && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* The app can still show an in-app reminder. */ }
    }
    setReminderSettings(current => ({ ...current, [progressDeck.id]: { ...(current[progressDeck.id] ?? defaultReminderPreference), enabled: value } }))
  }
  async function regenerate(card: Flashcard) {
    if (!onRegenerate || regeneratingId) return
    const taskId = onBeginAiTask('Poprawa fiszki przy pomocy AI')
    let failed = false
    let notificationResult = ''
    setRegenerateError('')
    setRegeneratingId(card.id)
    try {
      const regenerated = await onRegenerate(card)
      const normalized = normalizeQuestion(regenerated.question)
      const duplicate = cards.some(item => item.id !== card.id && item.noteId === card.noteId && normalizeQuestion(item.question) === normalized)
      if (duplicate) throw new Error('AI wygenerowało pytanie, które już istnieje dla tej notatki.')
      onUpdate(card.id, { question: regenerated.question, answer: regenerated.answer, kind: 'basic', tags: card.tags ?? [] })
      notificationResult = `Pytanie: ${regenerated.question}\n\nOdpowiedź: ${regenerated.answer}`
    } catch (error) { failed = true; notificationResult = error instanceof Error ? error.message : 'Nie udało się poprawić fiszki.'; setRegenerateError(notificationResult) }
    finally { setRegeneratingId(''); onFinishAiTask(taskId, failed, notificationResult) }
  }

  const scopeAndDecksView = (
    <section className="flashcard-page-panel flashcard-scope-panel" aria-label="Zakres fiszek i talie">
      <header className="flashcard-panel-heading">
        <div>
          <h2>Zakres i talie</h2>
          <p>Ustaw źródła i zarządzaj taliami. Lista kart zawsze obejmuje wszystkie fiszki.</p>
        </div>
      </header>
      <div className="flashcard-scope-content">
        <section className="flashcard-scope-block" aria-labelledby="flashcard-scope-sources-title">
          <header className="flashcard-scope-section-heading">
            <div><h3 id="flashcard-scope-sources-title">Źródła fiszek</h3><p>Wybierz notatki używane przy tworzeniu talii ze źródeł.</p></div>
            <span className="flashcard-scope-selection-count">{selectedCount} / {notes.length} notatek</span>
          </header>
          <div className="flashcard-note-options">
            <button type="button" onClick={() => { setExcludedNoteIds([]); setIncludeUnlinkedCards(true); setSelectedDeckId(''); setSessionQueue(null) }}>Wszystkie notatki i fiszki</button>
            {notes.map(note => <button type="button" key={note.id} className="flashcard-note-option" aria-pressed={!excludedIds.has(note.id)} onClick={() => toggleSourceNote(note.id)}><span className="flashcard-note-option-mark" aria-hidden="true">{!excludedIds.has(note.id) && <Check size={11} />}</span><span>{note.folder ? `${note.folder} / ` : ''}{note.title || 'Bez tytułu'}</span></button>)}
            <button type="button" className="flashcard-note-option" aria-pressed={includeUnlinkedCards} onClick={() => { setIncludeUnlinkedCards(value => !value); setSelectedDeckId(''); setSessionQueue(null) }}><span className="flashcard-note-option-mark" aria-hidden="true">{includeUnlinkedCards && <Check size={11} />}</span><span>Fiszki bez notatki ({unlinkedCardCount})</span></button>
          </div>
          <small className="flashcard-scope-help">Bieżący zakres: {deckFilteredCards.length} fiszek · fiszki bez notatki {includeUnlinkedCards ? 'włączone' : 'wyłączone'}.</small>
        </section>

        <div className="flashcard-scope-deck-layout">
          <section className="flashcard-scope-block flashcard-saved-deck-block" aria-labelledby="flashcard-saved-decks-title">
            <header className="flashcard-scope-section-heading"><div><h3 id="flashcard-saved-decks-title">Zapisane talie</h3><p>Wybierz talię, aby podejrzeć jej zawartość lub ją usunąć.</p></div></header>
            <label className="flashcard-scope-field"><span>Podgląd talii</span><select aria-label="Zapisana talia" value={selectedDeckId} onChange={event => chooseDeck(event.target.value)}><option value="">Bieżący zakres źródeł</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
            <div className="flashcard-scope-deck-summary"><Layers size={15} /><span><strong>{selectedDeck?.name ?? 'Bieżący wybór źródeł'}</strong><small>{deckFilteredCards.length} fiszek · {selectedDeck?.dynamicRule ? 'reguły dynamiczne' : selectedDeck?.cardIds ? 'ręcznie wybrane karty' : selectedDeck ? 'wybrane źródła' : sourceFilterLabel}</small></span></div>
            {selectedDeck && <button type="button" className="button secondary flashcard-delete-deck-button" onClick={() => { setDecks(current => current.filter(deck => deck.id !== selectedDeckId)); if (sessionDeckId === selectedDeckId) setSessionDeckId(''); setSelectedDeckId('') }}><Trash2 size={14} />Usuń tę talię</button>}
          </section>

          <section className="flashcard-scope-block flashcard-create-deck-block" aria-labelledby="flashcard-create-deck-title">
            <header className="flashcard-scope-section-heading"><div><h3 id="flashcard-create-deck-title">Utwórz talię</h3><p>Wybierz sposób, w jaki talia ma dobierać fiszki.</p></div></header>
            <label className="flashcard-scope-field"><span>Sposób doboru fiszek</span><select value={deckCreateMode} onChange={event => setDeckCreateMode(event.target.value as typeof deckCreateMode)}><option value="sources">Z wybranych źródeł</option><option value="selected">Zaznaczone ręcznie karty</option><option value="dynamic">Według reguł dynamicznych</option></select></label>
            {deckCreateMode === 'sources' && <p className="flashcard-deck-mode-help">Talia zapisze wybrane notatki oraz ustawienie fiszek bez notatki z sekcji „Źródła fiszek”.</p>}
            {deckCreateMode === 'selected' && <div className="flashcard-deck-mode-help"><span>{selectedCardIds.length ? `Do talii trafi ${selectedCardIds.length} zaznaczonych kart.` : 'Najpierw zaznacz karty na liście w widoku Karty.'}</span><button type="button" className="link-button" onClick={() => setTab('cards')}>Otwórz karty</button></div>}
            {deckCreateMode === 'dynamic' && <fieldset className="flashcard-dynamic-rules">
              <legend>Reguły dynamiczne</legend>
              <div className="flashcard-dynamic-rules-heading"><p>Każdy ustawiony warunek musi pasować. Puste pola nie ograniczają talii; reguły sprawdzają wszystkie fiszki.</p><output aria-live="polite"><strong>{dynamicDeckPreviewCount}</strong><span>pasujących fiszek</span></output></div>
              <div className="flashcard-dynamic-rule-controls">
                <label><span>Tag</span><select value={dynamicDeckTag} onChange={event => setDynamicDeckTag(event.target.value)}><option value="">Dowolny tag</option>{availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select><small>Wybierz tag, który musi mieć fiszka.</small></label>
                <label><span>Notatka źródłowa</span><select value={dynamicDeckNote} onChange={event => setDynamicDeckNote(event.target.value)}><option value="">Dowolna notatka</option>{notes.map(note => <option key={note.id} value={note.id}>{note.folder ? `${note.folder} / ` : ''}{note.title || 'Bez tytułu'}</option>)}</select><small>Ogranicz talię do jednej notatki.</small></label>
                <label className="flashcard-dynamic-due-toggle"><input type="checkbox" checked={dynamicDueOnly} onChange={event => setDynamicDueOnly(event.target.checked)} /><span><strong>Tylko do powtórki</strong><small>Do talii trafią karty z upłyniętym terminem powtórki.</small></span></label>
              </div>
            </fieldset>}
            <div className="flashcard-create-deck-footer">
              <label className="flashcard-scope-field"><span>Nazwa talii</span><input aria-label="Nazwa nowej talii" value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="np. Biologia — egzamin" /></label>
              <button type="button" className="button primary" disabled={!deckName.trim() || (deckCreateMode === 'selected' && !selectedCardIds.length)} onClick={saveDeck}><Plus size={14} />Zapisz talię</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  )

  return (<section className="flashcards-page" aria-labelledby="flashcards-title">
    <header className="flashcards-page-heading"><span className="folder-dialog-mark"><Brain size={19} /></span><div><h1 id="flashcards-title">Fiszki</h1><p>{due.length} do powtórki · {cards.length} fiszek · {notes.length} notatek</p></div><button type="button" className={`flashcard-trash-shortcut${tab === 'trash' ? ' active' : ''}`} aria-label={`Otwórz kosz fiszek, ${trash.length} elementów`} aria-pressed={tab === 'trash'} title={`Kosz fiszek (${trash.length})`} onClick={() => setTab('trash')}><Trash2 size={17} />{trash.length > 0 && <span>{trash.length}</span>}</button></header>

    <nav className="flashcard-view-tabs" aria-label="Widoki fiszek">
      <button type="button" className={tab === 'review' ? 'active' : ''} aria-pressed={tab === 'review'} onClick={() => setTab('review')}>Nauka <span>{sessionDueCount}</span></button>
      <button type="button" className={tab === 'scope' ? 'active' : ''} aria-pressed={tab === 'scope'} onClick={() => setTab('scope')}>Zakres i talie</button>
      <button type="button" className={tab === 'cards' ? 'active' : ''} aria-pressed={tab === 'cards'} onClick={() => setTab('cards')}>Karty <span>{cards.length}</span></button>
      <button type="button" className={tab === 'create' ? 'active' : ''} aria-pressed={tab === 'create'} onClick={() => setTab('create')}>Dodaj</button>
      <button type="button" className={tab === 'progress' ? 'active' : ''} aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Postępy</button>
    </nav>

    {tab === 'progress' ? <section className="flashcard-page-panel flashcard-progress-panel" aria-label="Postępy i planowanie">
      <header className="flashcard-panel-heading flashcard-progress-heading"><div><h2>Postępy i planowanie</h2><p>{progressDeck ? `${progressDeck.name} · ${progressDeckCards.length} fiszek · seria ${studyStreak} dni · ${reviewsToday}/${dailyGoal} powtórek dzisiaj · ${progressDueCards.length} do powtórki` : 'Wybierz talię, aby zobaczyć jej postępy i plan nauki.'}</p></div><label className="flashcard-progress-deck-picker"><span>Talia dla postępów i planowania</span><select aria-label="Talia dla postępów i planowania" value={progressDeck?.id ?? ''} disabled={!decks.length} onChange={event => setProgressDeckId(event.target.value)}><option value="" disabled>Wybierz talię</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label></header>
      <div className="flashcard-progress-content">
        {!progressDeck ? <div className="flashcard-progress-empty"><p>Najpierw utwórz talię, aby śledzić postępy i planować naukę dla jej kart.</p><button type="button" className="button secondary" onClick={() => setTab('scope')}>Przejdź do talii</button></div> : <>
          <section className="flashcard-stats" aria-label={`Statystyki nauki: ${progressDeck.name}`}>
            <article><span>Do powtórki</span><strong>{progressDueCards.length}</strong></article>
            <article><span>Powtórki dzisiaj</span><strong>{reviewsToday}</strong></article>
            <article><span>Skuteczność</span><strong>{successRate === undefined ? '—' : `${successRate}%`}</strong></article>
            <article><span>Utrwalone</span><strong>{masteredCount}</strong></article>
          </section>

          <section className="flashcard-learning-tools" aria-label={`Cel i przypomnienia nauki dla talii ${progressDeck.name}`}>
            <div className="flashcard-daily-goal"><div className="flashcard-learning-heading"><span><Flame size={15} />Seria: {studyStreak} {studyStreak === 1 ? 'dzień' : 'dni'}</span><label>Cel dzienny<input aria-label="Dzienny cel powtórek" type="number" min="1" max="200" value={dailyGoal} onChange={event => setDailyGoals(value => ({ ...value, [progressDeck.id]: Math.max(1, Math.min(200, Number(event.target.value) || 1)) }))} /></label></div><div className="flashcard-goal-progress"><span style={{ width: `${Math.min(100, reviewsToday / dailyGoal * 100)}%` }} /></div><small>{reviewsToday} z {dailyGoal} powtórek dzisiaj w tej talii</small></div>
            <div className="flashcard-reminder-settings"><div className="flashcard-learning-heading"><span><Bell size={15} />Przypomnienie</span><label className="flashcard-reminder-toggle"><input type="checkbox" checked={reminderEnabled} onChange={event => void setReminder(event.target.checked)} /><span>{reminderEnabled ? 'Włączone' : 'Wyłączone'}</span></label></div><label className="flashcard-reminder-time">Codziennie o <input type="time" value={reminderTime} disabled={!reminderEnabled} onChange={event => setReminderSettings(value => ({ ...value, [progressDeck.id]: { ...(value[progressDeck.id] ?? defaultReminderPreference), time: event.target.value } }))} /></label><small>Powiadomienie pojawia się przy kartach do powtórki, gdy aplikacja jest uruchomiona.</small></div>
          </section>

          <section className="flashcard-planning-tools" aria-label={`Plan nauki dla talii ${progressDeck.name}`}>
            <div><strong>Dni nauki</strong><div className="flashcard-weekdays">{['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'].map((day, index) => <label key={day}><input type="checkbox" checked={progressStudyWeekdays.includes(index)} onChange={() => setWeekdayPlans(value => { const current = value[progressDeck.id] ?? defaultStudyWeekdays; return { ...value, [progressDeck.id]: current.includes(index) ? current.filter(item => item !== index) : [...current, index].sort() } })} /><span>{day}</span></label>)}</div><small>Terminy powtórek kart z tej talii przesuną się na wybrane dni.</small></div>
            <div><strong>Plan do egzaminu</strong><label>Data egzaminu <input type="date" value={examDate} onChange={event => setExamDates(value => ({ ...value, [progressDeck.id]: event.target.value }))} /></label><small>{examDate ? examDaysRemaining ? examDaysRemaining + ' dni · około ' + examDailyTarget + ' nowych kart dziennie z tej talii' : 'Data egzaminu już minęła.' : 'Ustaw datę, aby wyliczyć tempo nauki dla tej talii.'}</small></div>
            <div className="flashcard-mastery-rules"><strong>Utrwalenie według tagów i talii</strong><label className="flashcard-mastery-deck-rule"><span title={progressDeck.name}>{progressDeck.name}</span><select aria-label={'Liczba powtórek do utrwalenia w talii: ' + progressDeck.name} value={masteryRules['deck:' + progressDeck.id] ?? 4} onChange={event => setMasteryRules(value => ({ ...value, ['deck:' + progressDeck.id]: Number(event.target.value) }))}>{[2, 3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count} powtórek</option>)}</select></label><div className="flashcard-mastery-tag-rules">{progressAvailableTags.length ? progressAvailableTags.map(tag => <label key={tag}><span title={tag}>{tag}</span><select aria-label={'Liczba powtórek do utrwalenia: ' + tag} value={masteryRules[deckTagMasteryKey(progressDeck.id, tag)] ?? 4} onChange={event => setMasteryRules(value => ({ ...value, [deckTagMasteryKey(progressDeck.id, tag)]: Number(event.target.value) }))}>{[2, 3, 4, 5, 6, 8, 10].map(count => <option key={count} value={count}>{count} powtórek</option>)}</select></label>) : <small>Ta talia nie ma kart z tagami.</small>}</div></div>
          </section>

          <section className="flashcard-activity" aria-label={`Kalendarz aktywności dla talii ${progressDeck.name}`}><div className="flashcard-activity-heading"><span><CalendarDays size={15} />Aktywność z ostatnich 12 tygodni · {progressDeck.name}</span><small>{activityCalendar.reduce((sum, day) => sum + day.count, 0)} powtórek</small></div><div className="flashcard-activity-months">{activityCalendar.filter(day => day.monthLabel).map(day => <span key={day.key}>{day.monthLabel}</span>)}</div><div className="flashcard-activity-grid">{activityCalendar.map(day => <span key={day.key} role="img" title={day.title} aria-label={day.title} data-level={day.level} />)}</div><div className="flashcard-activity-legend"><span>Mniej</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>Więcej</span></div></section>
        </>}
      </div>
    </section> : tab === 'scope' ? scopeAndDecksView : tab === 'create' ? <section className="flashcard-page-panel flashcard-create-panel" aria-label="Dodaj fiszkę">
      <header className="flashcard-panel-heading"><div><h2>Dodaj fiszkę</h2><p>Wybierz typ nauki i uzupełnij treść fiszki.</p></div><output className="flashcard-create-scope-count" aria-live="polite"><Layers size={15} /><span>Fiszki w bieżącym zakresie</span><strong>{deckFilteredCards.length}</strong></output></header>
        <form className="flashcard-create-form" onSubmit={submit}>
          <select aria-label="Notatka dla karty" value={noteId} onChange={event => { setNoteId(event.target.value); setMediaAttachmentId('') }}>{notes.map(note => <option key={note.id} value={note.id}>{note.folder ? note.folder + ' / ' : ''}{note.title || 'Bez tytułu'}</option>)}</select>
          <label className="flashcard-kind-select"><span>Typ karty</span><select value={cardKind} onChange={event => { const kind = event.target.value as FlashcardKind; setCardKind(kind); if (kind === 'image-occlusion' && !question.trim()) setQuestion('Nazwij zakryte elementy.'); if (kind !== 'image-occlusion') setCardOcclusion(undefined) }}><option value="basic">Pytanie i odpowiedź</option><option value="cloze">Uzupełnij lukę</option><option value="image-occlusion">Zakrywanie obrazu</option><option value="sequence">Kolejność kroków</option><option value="numeric">Wynik liczbowy</option><option value="audio">Fragment audio</option><option value="video">Fragment wideo</option></select></label>
          <label className="flashcard-kind-select"><span>Typ nauki</span><select value={studyModeDraft} onChange={event => { const mode = event.target.value as FlashcardStudyMode; setStudyModeDraft(mode); if (mode === 'multiple-choice' && answer.trim() && !answerOptionsDraft.some(option => option.trim())) setAnswerOptionsDraft(current => current.map((option, index) => index === 0 ? answer : option)) }}>{FLASHCARD_STUDY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
          {studyModeDraft === 'true-false' && <label className="flashcard-kind-select"><span>Poprawna ocena stwierdzenia</span><select value={String(trueFalseAnswerDraft)} onChange={event => setTrueFalseAnswerDraft(event.target.value === 'true')}><option value="true">Prawda</option><option value="false">Fałsz</option></select></label>}
          <FlashcardContentField label={cardKind === 'cloze' ? 'Tekst z luką, np. Stolica Francji to {{c1::Paryż}}.' : 'Pytanie'} value={question} onChange={setQuestion} />
          {cardKind === 'cloze' ? <p className="flashcard-cloze-help">Użyj <code>{'{{c1::odpowiedź}}'}</code> dla luki. Treść może zawierać LaTeX między znakami $…$ lub $$…$$ oraz tabele Markdown.</p> : null}
          {cardKind === 'image-occlusion' && <FlashcardImageOcclusionField value={cardOcclusion} onChange={setCardOcclusion} />}
          {cardKind === 'sequence' && <label className="flashcard-metadata-field">Prawidłowa kolejność, jeden element w wierszu<textarea value={sequenceDraft} onChange={event => setSequenceDraft(event.target.value)} rows={5} placeholder="Krok pierwszy&#10;Krok drugi&#10;Krok trzeci" /></label>}
          {cardKind === 'numeric' && <div className="flashcard-numeric-fields"><label>Wartość<input type="number" step="any" value={numericValue} onChange={event => setNumericValue(event.target.value)} /></label><label>Tolerancja ±<input type="number" min="0" step="any" value={numericTolerance} onChange={event => setNumericTolerance(event.target.value)} /></label><label>Jednostka<input value={numericUnit} onChange={event => setNumericUnit(event.target.value)} placeholder="np. kg" /></label></div>}
          {cardKind === 'audio' || cardKind === 'video' ? <div className="flashcard-media-fields"><label>Załącznik<select value={mediaAttachmentId} onChange={event => setMediaAttachmentId(event.target.value)}><option value="">Wybierz z załączników notatki</option>{attachments.filter(item => item.noteId === noteId && (cardKind === 'audio' ? item.mimeType.startsWith('audio/') : item.mimeType.startsWith('video/'))).map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label><label>Początek (s)<input type="number" min="0" step="0.1" value={mediaStart} onChange={event => setMediaStart(event.target.value)} /></label><label>Koniec (s)<input type="number" min="0" step="0.1" value={mediaEnd} onChange={event => setMediaEnd(event.target.value)} placeholder="do końca" /></label></div> : null}
          {studyModeDraft === 'multiple-choice' && <section className="flashcard-multiple-choice-editor" aria-label="Warianty odpowiedzi"><strong>Warianty odpowiedzi</strong><p>Zaznacz przycisk przy poprawnej odpowiedzi.</p>{answerOptionsDraft.map((option, index) => <div className="flashcard-multiple-choice-option" key={index}><label><input type="radio" name="new-flashcard-correct-answer" aria-label={`Odpowiedź ${index + 1} jest poprawna`} checked={correctAnswerOption === index} onChange={() => setCorrectAnswerOption(index)} /><span>{index + 1}</span></label><input aria-label={`Treść odpowiedzi ${index + 1}`} value={option} onChange={event => updateAnswerOption(index, event.target.value)} placeholder={`Odpowiedź ${index + 1}`} /><button type="button" className="icon-button danger-icon" aria-label={`Usuń odpowiedź ${index + 1}`} disabled={answerOptionsDraft.length <= 2} onClick={() => { setAnswerOptionsDraft(current => current.filter((_, optionIndex) => optionIndex !== index)); setCorrectAnswerOption(current => current === index ? Math.max(0, index - 1) : current > index ? current - 1 : current) }}><X size={14} /></button></div>)}<button type="button" className="link-button" disabled={answerOptionsDraft.length >= 8} onClick={() => setAnswerOptionsDraft(current => [...current, ''])}><Plus size={13} />Dodaj wariant odpowiedzi</button></section>}
          {studyModeDraft !== 'multiple-choice' && studyModeDraft !== 'true-false' && cardKind !== 'cloze' && <FlashcardContentField label={cardKind === 'numeric' ? 'Wyjaśnienie (opcjonalne)' : cardKind === 'image-occlusion' ? 'Dodatkowa odpowiedź (opcjonalna)' : 'Odpowiedź'} value={answer} onChange={setAnswer} />}
          <details className="flashcard-metadata-editor"><summary>Podpowiedzi, warianty, szablon i powiązania</summary>
            <label>Szablon karty<select value={templateDraft} onChange={event => { const template = event.target.value as FlashcardTemplate; setTemplateDraft(template); if (!question.trim()) setQuestion(FLASHCARD_TEMPLATE_PROMPTS[template]) }}><option value="definition">Definicja</option><option value="cause-effect">Przyczyna i skutek</option><option value="comparison">Porównanie</option><option value="vocabulary">Słownictwo</option><option value="process">Proces</option><option value="formula">Wzór</option></select></label>
            <label>Podpowiedzi progresywne, jedna na wiersz<textarea value={hintsDraft} onChange={event => setHintsDraft(event.target.value)} rows={3} /></label>
            {studyModeDraft !== 'multiple-choice' && studyModeDraft !== 'true-false' && <label>Akceptowane warianty odpowiedzi, jeden na wiersz<textarea value={variantsDraft} onChange={event => setVariantsDraft(event.target.value)} rows={3} /></label>}
            <label>Tagi fiszki<input value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} placeholder="Tagi, oddziel przecinkami" /></label>
            <label>Karty powiązane<select multiple value={relatedDraft} onChange={event => setRelatedDraft([...event.currentTarget.selectedOptions].map(option => option.value))}>{cards.map(card => <option key={card.id} value={card.id}>{card.question.slice(0, 100)}</option>)}</select></label>
            <label>Słowniczek: termin = definicja<textarea value={glossaryDraft} onChange={event => setGlossaryDraft(event.target.value)} rows={3} placeholder="mitoza = podział jądra komórkowego" /></label>
          </details>
          <button className="button primary" disabled={!noteId || !question.trim() || (cardKind === 'basic' && studyModeDraft !== 'multiple-choice' && studyModeDraft !== 'true-false' && !answer.trim()) || (studyModeDraft === 'multiple-choice' && (answerOptionsDraft.length < 2 || answerOptionsDraft.some(option => !option.trim()))) || (cardKind === 'cloze' && !hasCloze(question)) || (cardKind === 'image-occlusion' && !hasOcclusionAnswers(cardOcclusion)) || (cardKind === 'sequence' && textLines(sequenceDraft).length < 2) || (cardKind === 'numeric' && (!numericValue.trim() || !Number.isFinite(Number(numericValue))) ) || (cardKind === 'audio' && !attachments.some(item => item.id === mediaAttachmentId && item.noteId === noteId && item.mimeType.startsWith('audio/'))) || (cardKind === 'video' && !attachments.some(item => item.id === mediaAttachmentId && item.noteId === noteId && item.mimeType.startsWith('video/')))}><Plus size={15} />Dodaj fiszkę</button>
        </form>
    </section> :

    tab === 'review' ? <div className="flashcard-review-workspace">
      {sessionQueue === null ? <div className="flashcard-session-setup"><div className="flashcard-session-heading"><span className="flashcard-session-mark"><Shuffle size={17} /></span><div><h2>Sesja nauki</h2><p>Wybierz talię, zakres i typ kart. Sesja będzie korzystać wyłącznie z wybranej talii.</p></div></div><div className="flashcard-session-controls"><label>Talia do nauki<select value={sessionDeckId} onChange={event => { setSessionDeckId(event.target.value); setSessionQueue(null) }}><option value="">Wszystkie fiszki</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><label>Zakres<select value={sessionMode} onChange={event => setSessionMode(event.target.value as SessionMode)}><option value="due">Tylko do powtórki ({dueModeCards.length})</option><option value="all">Wszystkie karty ({activeModeCards.length})</option><option value="weak">Słabe karty ({weakModeCards.length})</option></select></label><label>Typ kart<select value={answerMode} onChange={event => setAnswerMode(event.target.value as AnswerMode)}>{FLASHCARD_STUDY_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label><label>Liczba kart<select value={sessionLimit} disabled={timeSized} onChange={event => setSessionLimit(Number(event.target.value))}>{[5, 10, 20, 50, 100].map(count => <option key={count} value={count}>{count}</option>)}</select></label></div><section className="flashcard-page-panel flashcard-session-options-panel"><header className="flashcard-panel-heading"><div><h3>Dodatkowe ustawienia sesji</h3><p>Ustaw limit czasu, kolejność i priorytet słabych kart.</p></div></header><div className="flashcard-session-option-controls"><label className="flashcard-shuffle-toggle"><input type="checkbox" checked={timeSized} onChange={event => setTimeSized(event.target.checked)} /><span>Sesja na czas</span></label>{(timeSized || answerMode === 'timed-exam') && <label>Czas<select value={sessionMinutes} onChange={event => setSessionMinutes(Number(event.target.value))}>{[5, 10, 15, 20, 30, 45, 60].map(count => <option key={count} value={count}>{count} min</option>)}</select></label>}<label className="flashcard-shuffle-toggle"><input type="checkbox" checked={shuffleSession} onChange={event => setShuffleSession(event.target.checked)} /><span>Mieszaj kolejność</span></label><label className="flashcard-shuffle-toggle"><input type="checkbox" checked={weakOnly} onChange={event => setWeakOnly(event.target.checked)} /><span>Skup się na słabych kartach</span></label></div></section><div className="flashcard-session-footer"><small>Szacunkowo: około {sessionCardLimit} kart przy średnim czasie odpowiedzi {Math.round(averageResponseMs / 1000)} s.</small><button type="button" className="button primary" disabled={!eligibleForSession.length} onClick={startSession}><Brain size={15} />Rozpocznij sesję ({Math.min(sessionCardLimit, eligibleForSession.length)})</button></div></div>
        : current ? <div className="flashcard-review">
          <div className="flashcard-review-progress"><span>{sessionDeck?.name ?? 'Wszystkie fiszki'} · {sessionCompleted + 1} / {sessionTotal}</span><button type="button" className="link-button" onClick={() => { setSessionQueue(null); setExamDeadline(null); setBreakDeadline(null) }}>Zakończ sesję</button></div>
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
            <p>Jak łatwo przypomniałeś sobie odpowiedź?</p><div className="flashcard-grades"><button onClick={() => grade('again')}>Ponownie <small>10 min</small></button><button onClick={() => grade('hard')}>Trudne</button><button onClick={() => grade('good')}>Dobrze</button><button onClick={() => grade('easy')}>Łatwe</button></div><label className="flashcard-postpone-control"><Clock3 size={14} /><span>Odłóż</span><select aria-label="Odłóż aktualną fiszkę" defaultValue="" onChange={event => { postpone(current.id, event.target.value); event.target.value = '' }}><option value="" disabled>Wybierz termin</option><option value="hour">1 godzinę</option><option value="day">Do jutra</option><option value="week">7 dni</option><option value="month">30 dni</option></select></label><label className="flashcard-date-control"><span>Ustaw dokładny termin</span><input aria-label="Dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(current.dueAt)} onChange={event => setManualDue(current.id, event.target.value)} /></label></>  : answerMode === 'flip' && current.kind === 'sequence' ? <div className="flashcard-answer-input"><strong>Ułóż elementy we właściwej kolejności</strong>{sequenceOrder.map((item, index) => <div className="flashcard-sequence-row" key={index}><span>{index + 1}. {item}</span><button type="button" disabled={index === 0} onClick={() => moveSequenceItem(index, -1)}>↑</button><button type="button" disabled={index === sequenceOrder.length - 1} onClick={() => moveSequenceItem(index, 1)}>↓</button></div>)}<button type="button" className="button primary" onClick={() => submitReviewAnswer()}>Sprawdź kolejność</button></div>
            : answerMode === 'flip' && current.kind === 'numeric' && current.numericAnswer ? <div className="flashcard-answer-input"><label>Wynik<input inputMode="decimal" value={answerInput} onChange={event => setAnswerInput(event.target.value)} placeholder={current.numericAnswer.unit || 'Liczba'} /></label><small>Tolerancja ±{current.numericAnswer.tolerance} {current.numericAnswer.unit}</small><button type="button" className="button primary" disabled={!answerInput.trim()} onClick={() => submitReviewAnswer()}>Sprawdź wynik</button></div>
              : answerMode === 'multiple-choice' ? <div className="flashcard-answer-input"><strong>Wybierz odpowiedź</strong>{choiceOptions.map(option => <button type="button" className={choiceValue === option ? 'flashcard-choice selected' : 'flashcard-choice'} key={option} aria-pressed={choiceValue === option} onClick={() => setChoiceValue(option)}>{option}</button>)}{choiceOptions.length < 4 && onAiAssist && <button type="button" className="link-button" disabled={aiBusy === 'distractors'} onClick={() => void runAi('distractors', current)}>Wygeneruj dystraktory AI</button>}<button type="button" className="button primary" disabled={!choiceValue} onClick={() => submitReviewAnswer()}>Sprawdź</button></div>
                : answerMode === 'true-false' ? <div className="flashcard-answer-input">{current.studyMode === 'true-false' ? <RichCardContent value={current.question} /> : <RichCardContent value={`${current.question} — ${trueFalseStatement.answer}`} />}<button type="button" className="button secondary" onClick={() => submitReviewAnswer('true')}>Prawda</button><button type="button" className="button secondary" onClick={() => submitReviewAnswer('false')}>Fałsz</button></div>
                  : answerMode === 'explain' || answerMode === 'timed-exam' ? <div className="flashcard-answer-input"><label>Twoja odpowiedź<textarea value={answerInput} onChange={event => setAnswerInput(event.target.value)} rows={4} disabled={Boolean(aiBusy)} /></label>{aiError && <p className="flashcard-form-error" role="alert">{aiError}</p>}<button type="button" className="button primary" disabled={!answerInput.trim() || Boolean(aiBusy)} onClick={() => void checkDescriptiveAnswer()}>{aiBusy === 'evaluate' ? 'Porównuję odpowiedź…' : onAiAssist ? 'Porównaj z AI i pokaż odpowiedź' : 'Sprawdź i pokaż odpowiedź'}</button></div>
                    : <button className="button primary" onClick={() => setShowAnswer(true)}>Pokaż odpowiedź <ChevronRight size={15} /></button>}
        </div> : <div className="flashcard-session-complete"><Check size={23} /><h2>{examExpired ? 'Czas egzaminu minął' : sessionCompleted ? 'Sesja zakończona' : 'Brak kart w tej sesji'}</h2><p>{sessionCompleted} z {sessionTotal} kart sprawdzono.</p>{breakDeadline && <div className="flashcard-pomodoro-break"><strong>Przerwa Pomodoro</strong><span>{Math.ceil(Math.max(0, breakDeadline - now) / 60_000)} min</span><button type="button" className="link-button" onClick={() => setBreakDeadline(null)}>Pomiń przerwę</button></div>}<button type="button" className="button primary" onClick={() => { setSessionQueue(null); setBreakDeadline(null) }}>Ustaw kolejną sesję</button></div>}
      </div> : tab === 'cards' ? <>
        <div className="flashcard-card-toolbar flashcard-card-search-toolbar"><label className="flashcard-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Szukaj w pytaniach, odpowiedziach i notatkach" /></label><span className="flashcard-result-count">{visibleCards.length} kart</span><label className="flashcard-page-size"><span>Na stronie</span><select aria-label="Liczba fiszek na stronę" value={cardsPerPage} onChange={event => { setCardsPerPage(Number(event.target.value) as FlashcardPageSize); setCardsPage(1) }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
        <section className="flashcard-page-panel flashcard-list-tools-panel">
          <header className="flashcard-panel-heading"><div><h2>Filtrowanie i analiza</h2><p>Sortuj karty, filtruj tagi i uruchamiaj narzędzia AI.</p></div></header>
          <div className="flashcard-card-toolbar flashcard-card-toolbar-tools"><label className="flashcard-sort"><span>Sortuj</span><select value={sortBy} onChange={event => setSortBy(event.target.value as FlashcardSort)}><option value="due">Termin powtórki</option><option value="hardest">Najtrudniejsze</option><option value="question">Pytanie A–Z</option><option value="recent">Ostatnio powtarzane</option></select></label><label className="flashcard-tag-filter"><span>Tag</span><select value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="">Wszystkie tagi</option>{availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>{onFindSimilar && <button type="button" className="button secondary flashcard-similar-button" title="Porównanie korzysta z modelu embeddingów ustawionego w Ollama." disabled={similarBusy || visibleCards.length < 2} onClick={() => void checkSimilarCards()}>{similarBusy ? <><Sparkles className="spin" size={14} />Porównuję…</> : <><Sparkles size={14} />Wykryj podobne</>}</button>}{onAiAssist && <><button type="button" className="button secondary" title="Wykrywa niejasne, zbyt szerokie, błędne lub powtarzające się pytania i proponuje poprawki." disabled={Boolean(aiBusy)} onClick={() => void runAi('quality', undefined, JSON.stringify(visibleCards.map(card => ({ id: card.id, question: card.question, answer: card.answer, tags: card.tags }))))}>Sprawdź jakość AI</button><button type="button" className="button secondary" title="Grupuje fiszki według tematów i wskazuje ważne zagadnienia, których brakuje w zestawie." disabled={Boolean(aiBusy)} onClick={() => void runAi('coverage', undefined, JSON.stringify(visibleCards.map(card => ({ question: card.question, answer: card.answer, tags: card.tags }))))}>Pokrycie tematów</button><button type="button" className="button secondary" disabled={Boolean(aiBusy)} onClick={() => void runAi('tags', undefined, JSON.stringify(visibleCards.map(card => ({ id: card.id, question: card.question, answer: card.answer, tags: card.tags }))))}>Nadaj tagi AI</button></>}<button type="button" className="link-button" onClick={() => setSelectedCardIds(selectedCardIds.length === visibleCards.length ? [] : visibleCards.map(card => card.id))}>{selectedCardIds.length ? 'Odznacz' : 'Zaznacz widoczne'}</button></div>
        </section>
        <section className="flashcard-page-panel flashcard-bulk-panel"><header className="flashcard-panel-heading"><div><h2>Operacje zbiorcze</h2><p>{selectedCards.length ? `${selectedCards.length} zaznaczono` : 'Zaznacz fiszki na liście poniżej, aby użyć tych akcji.'}</p></div></header><div className="flashcard-bulk-toolbar"><strong>{selectedCards.length ? `${selectedCards.length} zaznaczono` : 'Wybierz fiszki'}</strong><input aria-label="Tagi do edycji zbiorczej" value={bulkTagDraft} onChange={event => setBulkTagDraft(event.target.value)} placeholder="Tagi, oddziel przecinkami" disabled={!selectedCards.length} /><button type="button" disabled={!selectedCards.length} onClick={() => applyBulk('add-tag')}>Dodaj tagi</button><button type="button" disabled={!selectedCards.length} onClick={() => applyBulk('remove-tag')}>Usuń tagi</button><label>Przesuń termin o <input type="number" value={bulkDueDays} onChange={event => setBulkDueDays(Number(event.target.value) || 0)} disabled={!selectedCards.length} /> dni</label><button type="button" disabled={!selectedCards.length} onClick={() => applyBulk('shift-due')}>Zmień terminy</button><button type="button" disabled={!selectedCards.length} onClick={() => applyBulk('suspend')}>Wstrzymaj</button><button type="button" disabled={!selectedCards.length} onClick={() => applyBulk('resume')}>Wznów</button><button type="button" className="danger-icon" disabled={!selectedCards.length} onClick={() => applyBulk('delete')}>Przenieś do kosza</button></div></section>
        {similarError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{similarError}</p>}
        {aiError && <p className="flashcard-form-error" role="alert">{aiError}</p>}
        {similarMatches && <section className="flashcard-similar-results" aria-label="Podobne fiszki"><div className="flashcard-similar-heading"><strong>Podobne pytania · podobieństwo semantyczne</strong><button type="button" className="link-button" onClick={() => setSimilarMatches(null)}>Ukryj</button></div>{similarMatches.length ? similarMatches.map(match => { const first = cards.find(card => card.id === match.firstId); const second = cards.find(card => card.id === match.secondId); if (!first || !second) return null; return <article key={`${match.firstId}:${match.secondId}`}><button type="button" onClick={() => beginEdit(first)}><small>{notePath(cardNote(first))}</small>{first.question}</button><span>{Math.round(match.score * 100)}%</span><button type="button" onClick={() => beginEdit(second)}><small>{notePath(cardNote(second))}</small>{second.question}</button><button type="button" className="button secondary" onClick={() => mergeCards(first, second)}>Połącz karty</button></article> }) : <p>Nie znaleziono podobnych pytań w wybranym zestawie.</p>}</section>}
        {regenerateError && <p className="flashcard-form-error flashcard-regenerate-error" role="alert">{regenerateError}</p>}
        <div className="flashcard-list">{pageCards.map(card => {
          const note = cardNote(card)
          const cardDecks = cardDeckMembership.get(card.id) ?? []
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
              {editKind !== 'cloze' && editMetadata.studyMode !== 'true-false' && <FlashcardContentField label="Odpowiedź / wyjaśnienie" value={editAnswer} onChange={setEditAnswer} />}
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
              <label className="flashcard-card-select"><input type="checkbox" checked={selectedCardIds.includes(card.id)} onChange={event => setSelectedCardIds(value => event.target.checked ? [...new Set([...value, card.id])] : value.filter(id => id !== card.id))} /><span>Zaznacz kartę</span></label><div className="flashcard-list-content"><RichCardContent value={card.kind === 'cloze' ? clozeText(card.question, false) : card.question} />{card.kind === 'sequence' && card.sequenceItems?.length ? <small>Kolejność · {card.sequenceItems.length} kroków</small> : null}{card.kind === 'numeric' && card.numericAnswer ? <small>Odpowiedź liczbowa · tolerancja ±{card.numericAnswer.tolerance} {card.numericAnswer.unit}</small> : null}{card.mediaClip && <FlashcardMediaClip attachment={attachments.find(item => item.id === card.mediaClip?.attachmentId)} clip={card.mediaClip} />}{card.kind === 'image-occlusion' && card.imageOcclusion && <FlashcardOcclusionImage value={card.imageOcclusion} reveal={false} fallback="Odpowiedź" className="flashcard-image-occlusion-preview" />}<div className="flashcard-card-meta">{note ? <button type="button" className="flashcard-note-path" title={notePath(note)} onClick={() => onOpenNote(note.id)}>{notePath(note)}</button> : <small>Brak notatki</small>}<small>{card.suspended ? 'wstrzymana · ' : ''}{card.tags?.length ? `${card.tags.join(', ')} · ` : ''}{`${FLASHCARD_STUDY_MODES.find(mode => mode.value === (card.studyMode ?? 'flip'))?.label ?? 'Pokaż odpowiedź'} · `}{card.dueAt <= now ? 'do powtórzenia' : `następna: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(card.dueAt)}`}{card.kind === 'cloze' ? ' · luka' : card.kind === 'image-occlusion' ? ' · zakrywanie obrazu' : card.kind === 'sequence' ? ' · kolejność' : card.kind === 'numeric' ? ' · liczby' : card.kind === 'audio' ? ' · audio' : card.kind === 'video' ? ' · wideo' : ''}</small><div className="flashcard-card-decks" aria-label={cardDecks.length ? `Talie: ${cardDecks.map(deck => deck.name).join(', ')}` : 'Karta bez talii'}><Layers size={12} aria-hidden="true" />{cardDecks.length ? cardDecks.map(deck => <span key={deck.id} title={deck.name}>{deck.name}</span>) : <small>Bez talii</small>}</div></div>{cardAiResults[card.id] && <FlashcardCardAiResultView result={cardAiResults[card.id]!} onDismiss={() => setCardAiResults(current => { const next = { ...current }; delete next[card.id]; return next })} />}</div>
              <div className="flashcard-row-actions"><button type="button" className="icon-button" aria-label="Edytuj fiszkę" title="Edytuj" onClick={() => beginEdit(card)}><Pencil size={15} /></button><details className="flashcard-row-more"><summary>Więcej<ChevronDown size={12} aria-hidden="true" /></summary><div className="flashcard-row-more-actions">{onAiAssist && <details className="flashcard-row-ai"><summary><Sparkles size={14} />AI</summary><div><button type="button" title="Tworzy błędne odpowiedzi do trybu nauki „Warianty odpowiedzi”." onClick={() => void runAi('distractors', card)}>Dystraktory</button><button type="button" title="Dodaje przykład i kontrprzykład wyjaśniający pojęcie z fiszki." onClick={() => void runAi('example', card)}>Przykład i kontrprzykład</button><button type="button" title="Dodaje mnemotechnikę, która ma pomóc zapamiętać odpowiedź." onClick={() => void runAi('mnemonic', card)}>Skojarzenie</button><label title="Przeredagowuje pytanie i odpowiedź na wybrany poziom trudności.">Poziom<select aria-label="Poziom trudności fiszki" value={card.difficulty ?? 'intermediate'} onChange={event => void runAi('difficulty', card, event.target.value)}><option value="beginner">Początkujący</option><option value="intermediate">Średni</option><option value="advanced">Zaawansowany</option></select></label></div></details>}{onRegenerate && card.kind === 'basic' && <button type="button" className="icon-button" aria-label="Popraw fiszkę przy pomocy AI" title="Popraw przy pomocy AI" disabled={Boolean(regeneratingId)} onClick={() => void regenerate(card)}>{regeneratingId === card.id ? <Sparkles className="spin" size={15} /> : <Sparkles size={15} />}</button>}<button type="button" className="icon-button" aria-label={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} title={card.suspended ? 'Wznów fiszkę' : 'Wstrzymaj fiszkę'} onClick={() => onToggleSuspend(card.id)}>{card.suspended ? <Play size={15} /> : <Pause size={15} />}</button><label className="flashcard-postpone-mini"><Clock3 size={13} /><select aria-label="Odłóż fiszkę" defaultValue="" onChange={event => { postpone(card.id, event.target.value); event.target.value = '' }}><option value="" disabled>Odłóż</option><option value="hour">+1 godz.</option><option value="day">Jutro</option><option value="week">+7 dni</option><option value="month">+30 dni</option></select></label><label className="flashcard-date-mini"><input aria-label="Ustaw dokładny termin powtórki" type="datetime-local" value={dateTimeLocal(card.dueAt)} onChange={event => setManualDue(card.id, event.target.value)} /></label><button type="button" className="icon-button danger-icon" title="Usuń fiszkę" aria-label="Usuń fiszkę" onClick={() => onDelete(card)}><X size={15} /></button></div></details></div>
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
