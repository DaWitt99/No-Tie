import type { ReviewSession, ReviewSessionStatus } from './types'

export function moveReviewNote(noteIds: string[], noteId: string, destinationIndex: number): string[] {
  const sourceIndex = noteIds.indexOf(noteId)
  if (sourceIndex < 0 || !noteIds.length) return noteIds
  const targetIndex = Math.max(0, Math.min(noteIds.length - 1, destinationIndex))
  if (sourceIndex === targetIndex) return noteIds
  const next = [...noteIds]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

export function checkpointReviewSession(
  session: ReviewSession,
  now = Date.now(),
  nextStatus: ReviewSessionStatus = session.status,
): ReviewSession {
  const elapsed = session.status === 'running' && session.runningSince
    ? Math.max(0, now - session.runningSince)
    : 0
  const noteTimesMs = { ...session.noteTimesMs }
  if (elapsed && session.activeNoteId) {
    noteTimesMs[session.activeNoteId] = (noteTimesMs[session.activeNoteId] ?? 0) + elapsed
  }
  return {
    ...session,
    totalTimeMs: session.totalTimeMs + elapsed,
    noteTimesMs,
    status: nextStatus,
    runningSince: nextStatus === 'running' ? now : undefined,
    updatedAt: now,
  }
}

export function reviewTotalTime(session: ReviewSession, now = Date.now()): number {
  const elapsed = session.status === 'running' && session.runningSince
    ? Math.max(0, now - session.runningSince)
    : 0
  return session.totalTimeMs + elapsed
}

export function reviewNoteTime(session: ReviewSession, noteId: string, now = Date.now()): number {
  const elapsed = session.status === 'running' && session.runningSince && session.activeNoteId === noteId
    ? Math.max(0, now - session.runningSince)
    : 0
  return (session.noteTimesMs[noteId] ?? 0) + elapsed
}

export function formatReviewDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':')
}
