import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const CARD_MIN_WIDTH = 250
const PREFERRED_CARD_MIN_WIDTH = 190
const COLUMN_GAP = 12
const ROW_HEIGHT = 222

export function VirtualizedGrid<T>({ items, className, keyOf, renderItem, onItemsRendered, preferredColumns, overscan = 2 }: {
  items: T[]
  className: string
  keyOf: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  onItemsRendered?: (start: number, end: number) => void
  preferredColumns?: number
  overscan?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onItemsRendered)
  const frame = useRef(0)
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0 })
  const automaticColumns = Math.max(1, Math.floor((viewport.width + COLUMN_GAP) / (CARD_MIN_WIDTH + COLUMN_GAP)))
  const preferredAvailableColumns = Math.max(1, Math.floor((viewport.width + COLUMN_GAP) / (PREFERRED_CARD_MIN_WIDTH + COLUMN_GAP)))
  const columns = preferredColumns ? Math.max(1, Math.min(4, preferredAvailableColumns, Math.round(preferredColumns))) : automaticColumns
  const totalRows = Math.ceil(items.length / columns)
  const firstRow = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - overscan)
  const visibleRows = Math.max(1, Math.ceil(viewport.height / ROW_HEIGHT) + overscan * 2)
  const endRow = Math.min(totalRows, firstRow + visibleRows)
  const start = firstRow * columns
  const end = Math.min(items.length, endRow * columns)

  useEffect(() => { callback.current = onItemsRendered }, [onItemsRendered])
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setViewport(current => {
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        top: Math.min(element.scrollTop, Math.max(0, totalRows * ROW_HEIGHT - element.clientHeight)),
      }
      return current.width === next.width && current.height === next.height && current.top === next.top ? current : next
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [totalRows, columns])
  useLayoutEffect(() => { callback.current?.(start, end) }, [start, end, items])
  useEffect(() => () => window.cancelAnimationFrame(frame.current), [])

  return <div ref={container} className={className} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} onScroll={event => {
    const element = event.currentTarget
    window.cancelAnimationFrame(frame.current)
    frame.current = window.requestAnimationFrame(() => setViewport(current => ({ ...current, top: element.scrollTop })))
  }}>
    <div className="virtualized-grid-spacer" style={{ height: firstRow * ROW_HEIGHT }} aria-hidden="true" />
    {items.slice(start, end).map((item, offset) => {
      const index = start + offset
      return <div className="virtualized-grid-cell" key={keyOf(item, index)}>{renderItem(item, index)}</div>
    })}
    <div className="virtualized-grid-spacer" style={{ height: Math.max(0, (totalRows - endRow) * ROW_HEIGHT) }} aria-hidden="true" />
  </div>
}
