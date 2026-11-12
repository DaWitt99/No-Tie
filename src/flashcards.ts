import type { Flashcard } from './types'

export type FlashcardGrade = 'again' | 'hard' | 'good' | 'easy'

export function reviewFlashcard(card: Flashcard, grade: FlashcardGrade, now = Date.now()): Flashcard {
  if (grade === 'again') return { ...card, dueAt: now + 10 * 60_000, intervalDays: 0, ease: Math.max(1.3, card.ease - 0.2), repetitions: 0, lapses: card.lapses + 1, lastReviewedAt: now }
  const easeDelta = grade === 'easy' ? 0.15 : grade === 'hard' ? -0.15 : 0
  const ease = Math.max(1.3, card.ease + easeDelta)
  const intervalDays = grade === 'hard' ? Math.max(1, Math.round((card.intervalDays || 1) * 1.2))
    : grade === 'easy' ? Math.max(4, Math.round((card.intervalDays || 1) * ease * 1.3))
      : card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * ease))
  return { ...card, dueAt: now + intervalDays * 86_400_000, intervalDays, ease, repetitions: card.repetitions + 1, lastReviewedAt: now }
}
