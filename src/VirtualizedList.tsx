import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function VirtualizedList<T>({
  items,
  itemHeight,
  className,
  dataDropFolder,
  keyOf,
  renderItem,
  footer,
  onItemsRendered,
  overscan = 6,
}: {
  items: T[]
  itemHeight: number
  className: string
  dataDropFolder?: string
  keyOf: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  footer?: ReactNode
  onItemsRendered?: (start: number, end: number) => void
  overscan?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onItemsRendered)
  const frame = useRef(0)
  const [viewport, setViewport] = useState({ height: 0, top: 0 })
  const start = Math.max(0, Math.floor(viewport.top / itemHeight) - overscan)
  const visibleCount = Math.max(1, Math.ceil(viewport.height / itemHeight) + overscan * 2)
  const end = Math.min(items.length, start + visibleCount)

  useEffect(() => { callback.current = onItemsRendered }, [onItemsRendered])
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => setViewport(current => {
      const next = { height: element.clientHeight, top: Math.min(element.scrollTop, Math.max(0, items.length * itemHeight - element.clientHeight)) }
      return current.height === next.height && current.top === next.top ? current : next
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [itemHeight, items.length])
  useLayoutEffect(() => { callback.current?.(start, end) }, [start, end, items])
  useEffect(() => () => window.cancelAnimationFrame(frame.current), [])

  return <div className={className} data-drop-folder={dataDropFolder} ref={container} onScroll={event => {
    const element = event.currentTarget
    window.cancelAnimationFrame(frame.current)
    frame.current = window.requestAnimationFrame(() => setViewport({ height: element.clientHeight, top: element.scrollTop }))
  }}>
    <div className="virtualized-spacer" style={{ height: start * itemHeight }} aria-hidden="true" />
    {items.slice(start, end).map((item, offset) => {
      const index = start + offset
      return <div className="virtualized-row" style={{ height: itemHeight }} key={keyOf(item, index)}>{renderItem(item, index)}</div>
    })}
    <div className="virtualized-spacer" style={{ height: Math.max(0, (items.length - end) * itemHeight) }} aria-hidden="true" />
    {footer}
  </div>
}
