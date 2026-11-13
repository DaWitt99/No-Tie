import type { Flashcard } from './types'

export type FlashcardGrade = 'again' | 'hard' | 'good' | 'easy'

export type FlashcardReviewMeta = { confidence?: number; responseMs?: number; studyWeekdays?: number[] }

export function reviewFlashcard(card: Flashcard, grade: FlashcardGrade, now = Date.now(), meta: FlashcardReviewMeta = {}): Flashcard {
  const confidence = Number.isFinite(meta.confidence) ? Math.max(1, Math.min(5, Math.round(meta.confidence!))) : undefined
  const responseMs = Number.isFinite(meta.responseMs) ? Math.max(0, meta.responseMs!) : undefined
  const reviewHistory = [...(card.reviewHistory ?? []), { at: now, grade, confidence, responseMs }].slice(-500)
  if (grade === 'again') return { ...card, dueAt: scheduleWeekday(now + 10 * 60_000, meta.studyWeekdays), intervalDays: 0, ease: Math.max(1.3, card.ease - 0.2), repetitions: 0, lapses: card.lapses + 1, lastReviewedAt: now, reviewHistory }
  const easeDelta = grade === 'easy' ? 0.15 : grade === 'hard' ? -0.15 : 0
  const ease = Math.max(1.3, card.ease + easeDelta)
  let intervalDays = grade === 'hard' ? Math.max(1, Math.round((card.intervalDays || 1) * 1.2))
    : grade === 'easy' ? Math.max(4, Math.round((card.intervalDays || 1) * ease * 1.3))
      : card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * ease))
  if (confidence !== undefined) intervalDays = Math.max(1, Math.round(intervalDays * (confidence <= 2 ? 0.82 : confidence === 5 ? 1.12 : 1)))
  if (responseMs !== undefined) intervalDays = Math.max(1, Math.round(intervalDays * (responseMs > 30_000 ? 0.9 : responseMs < 3_000 ? 1.05 : 1)))
  return { ...card, dueAt: scheduleWeekday(now + intervalDays * 86_400_000, meta.studyWeekdays), intervalDays, ease, repetitions: card.repetitions + 1, lastReviewedAt: now, reviewHistory }
}

function scheduleWeekday(timestamp: number, weekdays?: number[]) {
  const allowed = new Set((weekdays ?? []).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))
  if (!allowed.size) return timestamp
  const date = new Date(timestamp)
  for (let shift = 0; shift < 7 && !allowed.has(date.getDay()); shift += 1) date.setDate(date.getDate() + 1)
  return date.getTime()
}
