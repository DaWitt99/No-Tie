import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { moveReviewNote } from './reviews'

type DragState = {
  sourceId: string
  targetId: string
  after: boolean
  x: number
  y: number
}

type ActiveDrag = {
  sourceId: string
  pointerId: number
  startX: number
  startY: number
  active: boolean
  targetId: string
  after: boolean
}

export function usePointerReorder(noteIds: string[], onReorder: (noteIds: string[]) => void) {
  const noteIdsRef = useRef(noteIds)
  const onReorderRef = useRef(onReorder)
  const activeDrag = useRef<ActiveDrag | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)

  useEffect(() => {
    noteIdsRef.current = noteIds
    onReorderRef.current = onReorder
  }, [noteIds, onReorder])

  useEffect(() => {
    const clear = () => {
      activeDrag.current = null
      setDragState(null)
    }
    const move = (event: PointerEvent) => {
      const drag = activeDrag.current
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
      drag.active = true
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-review-reorder-id]')
      const targetId = element?.dataset.reviewReorderId
      if (targetId && noteIdsRef.current.includes(targetId)) {
        const bounds = element.getBoundingClientRect()
        drag.targetId = targetId
        drag.after = event.clientY >= bounds.top + bounds.height / 2
      } else {
        drag.targetId = ''
      }
      setDragState({ sourceId: drag.sourceId, targetId: drag.targetId, after: drag.after, x: event.clientX, y: event.clientY })
    }
    const finish = (event: PointerEvent) => {
      const drag = activeDrag.current
      if (drag && event.pointerId === drag.pointerId && drag.active && drag.targetId) {
        const ids = noteIdsRef.current
        const sourceIndex = ids.indexOf(drag.sourceId)
        const targetIndex = ids.indexOf(drag.targetId)
        if (sourceIndex >= 0 && targetIndex >= 0) {
          const insertIndex = targetIndex + (drag.after ? 1 : 0)
          const destinationIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex
          const next = moveReviewNote(ids, drag.sourceId, destinationIndex)
          if (next !== ids) onReorderRef.current(next)
        }
      }
      clear()
    }
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', clear, true)
    return () => {
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', clear, true)
    }
  }, [])

  function startDrag(event: ReactPointerEvent<HTMLElement>, noteId: string) {
    if (event.button !== 0 || !noteIdsRef.current.includes(noteId)) return
    event.preventDefault()
    event.stopPropagation()
    activeDrag.current = {
      sourceId: noteId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: noteId,
      after: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Window-level pointer listeners still track the drag if capture is unavailable.
    }
  }

  return {
    draggingNoteId: dragState?.sourceId ?? '',
    dropTargetNoteId: dragState?.targetId ?? '',
    dropAfter: dragState?.after ?? false,
    dragPosition: dragState ? { x: dragState.x, y: dragState.y } : null,
    startDrag,
  }
}
