import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Circle, ClipboardCopy, ClipboardPaste, Copy, Minus, MousePointer2, RectangleHorizontal,
  RectangleVertical, Redo2, Trash2, Triangle, Type, Undo2, X,
} from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'

type Tool = 'select' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'text'
type ArrowMode = 'end' | 'start' | 'both' | 'none'
type Box = { x: number; y: number; width: number; height: number }
type Snap = { delta: number; target: number } | undefined
type Interaction =
  | { type: 'draw'; tool: Tool; element: any; id: string; x: number; y: number; keepTool: boolean; startTarget?: string; startAnchor?: string }
  | { type: 'connect'; line: SVGLineElement; id: string; side: 'start' | 'end'; x: number; y: number; moved: boolean }
  | { type: 'move'; ids: string[]; elements: SVGElement[]; others: Box[]; startX: number; startY: number; lastX: number; lastY: number; bounds: Box; moved: boolean }
  | { type: 'marquee'; x: number; y: number; additive: boolean; initialIds: string[]; moved: boolean }

type OverlayOptions = {
  marquee?: Box
  snapX?: number
  snapY?: number
  movingBounds?: Box
  otherBounds?: Box[]
}

type TextEdit = { input: HTMLInputElement; x: number; y: number; element?: SVGElement; fontSize: number; keepTool: boolean }
type Drawing = Svg

const WIDTH = 800
const HEIGHT = 500
const SNAP_DISTANCE = 8
const OBJECT_TAGS = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'use'])

function snapshotContent(stage: Drawing): string {
  const copy = stage.node.cloneNode(true) as SVGSVGElement
  copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
  return copy.innerHTML
}

function getBox(element: SVGElement): Box | undefined {
  try {
    const bounds = (element as SVGGraphicsElement).getBBox()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  } catch {
    return undefined
  }
}

function unionBoxes(boxes: (Box | undefined)[]): Box | undefined {
  const valid = boxes.filter((box): box is Box => Boolean(box))
  if (!valid.length) return undefined
  const x = Math.min(...valid.map(box => box.x))
  const y = Math.min(...valid.map(box => box.y))
  const right = Math.max(...valid.map(box => box.x + box.width))
  const bottom = Math.max(...valid.map(box => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

function directObjects(stage: SVGSVGElement): SVGElement[] {
  const children = Array.from(stage.children).filter((child): child is SVGElement => child instanceof SVGElement)
  const background = children.find(child => {
    if (child.tagName.toLowerCase() !== 'rect') return false
    const box = getBox(child)
    return Boolean(box && box.x <= 1 && box.y <= 1 && box.width >= WIDTH - 1 && box.height >= HEIGHT - 1)
  })
  background?.setAttribute('data-background', 'true')
  return children.filter(child => OBJECT_TAGS.has(child.tagName.toLowerCase()) && !child.hasAttribute('data-background') && !child.hasAttribute('data-editor-ui'))
}

function ensureObjectIds(stage: SVGSVGElement) {
  directObjects(stage).forEach(element => {
    if (!element.hasAttribute('data-object-id')) element.setAttribute('data-object-id', crypto.randomUUID())
  })
}

function elementsForIds(stage: SVGSVGElement, ids: string[]): SVGElement[] {
  const wanted = new Set(ids)
  return directObjects(stage).filter(element => wanted.has(element.getAttribute('data-object-id') ?? ''))
}

function anchorNames(): string[] {
  return ['top-1', 'top-2', 'top-3', 'right-1', 'right-2', 'right-3', 'bottom-1', 'bottom-2', 'bottom-3', 'left-1', 'left-2', 'left-3']
}

function anchorPosition(element: SVGElement, name: string): { x: number; y: number } | undefined {
  const box = getBox(element)
  if (!box) return undefined
  const [, edge, indexValue] = name.match(/^(top|right|bottom|left)-(\d)$/) ?? []
  const index = Number(indexValue)
  if (!edge || !index) return undefined
  const fraction = index / 4
  if (['ellipse', 'circle'].includes(element.tagName.toLowerCase())) {
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const rx = box.width / 2
    const ry = box.height / 2
    const offset = fraction * 2 - 1
    if (edge === 'top' || edge === 'bottom') {
      const x = cx + rx * offset
      const yOffset = ry * Math.sqrt(Math.max(0, 1 - offset * offset))
      return { x, y: cy + (edge === 'top' ? -yOffset : yOffset) }
    }
    const y = cy + ry * offset
    const xOffset = rx * Math.sqrt(Math.max(0, 1 - offset * offset))
    return { x: cx + (edge === 'left' ? -xOffset : xOffset), y }
  }
  if (edge === 'top') return { x: box.x + box.width * fraction, y: box.y }
  if (edge === 'right') return { x: box.x + box.width, y: box.y + box.height * fraction }
  if (edge === 'bottom') return { x: box.x + box.width * fraction, y: box.y + box.height }
  return { x: box.x, y: box.y + box.height * fraction }
}

function findAnchorHit(target: EventTarget | null): { id: string; anchor: string } | undefined {
  const element = target instanceof Element ? target.closest('[data-anchor-target][data-anchor]') : null
  const id = element?.getAttribute('data-anchor-target')
  const anchor = element?.getAttribute('data-anchor')
  return id && anchor ? { id, anchor } : undefined
}

function findConnectorHandle(target: EventTarget | null): { id: string; side: 'start' | 'end' } | undefined {
  const element = target instanceof Element ? target.closest('[data-connector-handle][data-connector-side]') : null
  const id = element?.getAttribute('data-connector-handle')
  const side = element?.getAttribute('data-connector-side')
  return id && (side === 'start' || side === 'end') ? { id, side } : undefined
}

function setLineEndpoint(line: SVGLineElement, side: 'start' | 'end', point: { x: number; y: number }) {
  line.setAttribute(side === 'start' ? 'x1' : 'x2', `${point.x}`)
  line.setAttribute(side === 'start' ? 'y1' : 'y2', `${point.y}`)
}

function updateConnectors(stage: SVGSVGElement) {
  stage.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target]').forEach(line => {
    const startTarget = line.getAttribute('data-start-target')
    const startAnchor = line.getAttribute('data-start-anchor')
    const endTarget = line.getAttribute('data-end-target')
    const endAnchor = line.getAttribute('data-end-anchor')
    const startShape = startTarget ? elementsForIds(stage, [startTarget])[0] : undefined
    const endShape = endTarget ? elementsForIds(stage, [endTarget])[0] : undefined
    const start = startShape && startAnchor ? anchorPosition(startShape, startAnchor) : undefined
    const end = endShape && endAnchor ? anchorPosition(endShape, endAnchor) : undefined
    if (start) {
      line.setAttribute('x1', `${start.x}`)
      line.setAttribute('y1', `${start.y}`)
    }
    if (end) {
      line.setAttribute('x2', `${end.x}`)
      line.setAttribute('y2', `${end.y}`)
    }
  })
}

function detachConnectors(stage: SVGSVGElement, removedIds: string[]) {
  const removed = new Set(removedIds)
  stage.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target]').forEach(line => {
    for (const side of ['start', 'end'] as const) {
      const target = line.getAttribute(`data-${side}-target`)
      if (!target || !removed.has(target)) continue
      line.removeAttribute(`data-${side}-target`)
      line.removeAttribute(`data-${side}-anchor`)
    }
  })
}

function intersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

function getSnap(bounds: Box, others: Box[], axis: 'x' | 'y'): Snap {
  const isX = axis === 'x'
  const start = isX ? bounds.x : bounds.y
  const size = isX ? bounds.width : bounds.height
  const movingPoints = [start, start + size / 2, start + size]
  const targetPoints = others.flatMap(box => {
    const targetStart = isX ? box.x : box.y
    const targetSize = isX ? box.width : box.height
    return [targetStart, targetStart + targetSize / 2, targetStart + targetSize]
  })
  targetPoints.push(isX ? WIDTH / 2 : HEIGHT / 2)

  let best: Snap = undefined
  for (const movingPoint of movingPoints) {
    for (const target of targetPoints) {
      const delta = target - movingPoint
      if (Math.abs(delta) <= SNAP_DISTANCE && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target }
    }
  }
  return best
}

function drawDistance(layer: any, start: number, end: number, position: number, axis: 'x' | 'y') {
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  const color = '#07848c'
  const line = (x1: number, y1: number, x2: number, y2: number) => layer.line(x1, y1, x2, y2).stroke({ color, width: 1.5 })
  if (axis === 'x') {
    line(low, position, high, position)
    line(low, position - 5, low, position + 5)
    line(high, position - 5, high, position + 5)
    layer.text(`${Math.round(high - low)} px`).font({ family: 'sans-serif', size: 12, weight: 700 }).fill(color).center((low + high) / 2, position - 10).attr({ stroke: '#ffffff', 'stroke-width': 4, 'paint-order': 'stroke' })
  } else {
    line(position, low, position, high)
    line(position - 5, low, position + 5, low)
    line(position - 5, high, position + 5, high)
    layer.text(`${Math.round(high - low)} px`).font({ family: 'sans-serif', size: 12, weight: 700 }).fill(color).center(position + 26, (low + high) / 2).attr({ stroke: '#ffffff', 'stroke-width': 4, 'paint-order': 'stroke' })
  }
}

function nearestGap(moving: Box, others: Box[], axis: 'x' | 'y') {
  let best: { start: number; end: number; position: number; gap: number } | undefined
  for (const other of others) {
    let start: number
    let end: number
    let position: number
    if (axis === 'x') {
      if (other.y > moving.y + moving.height || other.y + other.height < moving.y) continue
      if (other.x >= moving.x + moving.width) {
        start = moving.x + moving.width
        end = other.x
      } else if (other.x + other.width <= moving.x) {
        start = other.x + other.width
        end = moving.x
      } else continue
      const overlapStart = Math.max(moving.y, other.y)
      const overlapEnd = Math.min(moving.y + moving.height, other.y + other.height)
      position = overlapStart + (overlapEnd - overlapStart) / 2
    } else {
      if (other.x > moving.x + moving.width || other.x + other.width < moving.x) continue
      if (other.y >= moving.y + moving.height) {
        start = moving.y + moving.height
        end = other.y
      } else if (other.y + other.height <= moving.y) {
        start = other.y + other.height
        end = moving.y
      } else continue
      const overlapStart = Math.max(moving.x, other.x)
      const overlapEnd = Math.min(moving.x + moving.width, other.x + other.width)
      position = overlapStart + (overlapEnd - overlapStart) / 2
    }
    const gap = Math.abs(end - start)
    if (!best || gap < best.gap) best = { start, end, position, gap }
  }
  return best
}

function renderOverlay(stage: Drawing, ids: string[], options: OverlayOptions = {}) {
  stage.node.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
  const layer = stage.group().attr({ 'data-editor-ui': 'true', 'pointer-events': 'none' })
  for (const element of elementsForIds(stage.node, ids)) {
    const box = getBox(element)
    if (!box) continue
    layer.rect(Math.max(box.width, 1) + 8, Math.max(box.height, 1) + 8)
      .move(box.x - 4, box.y - 4)
      .fill('none')
      .stroke({ color: '#5d73d8', width: 2, dasharray: '7 4' })
  }
  const activeTool = stage.node.getAttribute('data-active-tool')
  const selectedLines = elementsForIds(stage.node, ids).filter(element => element.tagName.toLowerCase() === 'line')
  const showAllAnchors = activeTool === 'line' || activeTool === 'arrow' || selectedLines.length > 0
  const anchorElements = (showAllAnchors ? directObjects(stage.node) : elementsForIds(stage.node, ids))
    .filter(element => !['line', 'text'].includes(element.tagName.toLowerCase()))
  for (const element of anchorElements) {
    const id = element.getAttribute('data-object-id')
    if (!id) continue
    for (const name of anchorNames()) {
      const point = anchorPosition(element, name)
      if (!point) continue
      layer.circle(8).center(point.x, point.y).fill('#ffffff').stroke({ color: '#6879db', width: 1.7 })
        .attr({ 'data-anchor-target': id, 'data-anchor': name, 'pointer-events': 'all', cursor: 'crosshair' })
    }
  }
  if (activeTool === 'select' && !stage.node.hasAttribute('data-connector-dragging')) {
    for (const line of selectedLines) {
      const id = line.getAttribute('data-object-id')
      if (!id) continue
      for (const side of ['start', 'end'] as const) {
        const x = Number(line.getAttribute(side === 'start' ? 'x1' : 'x2'))
        const y = Number(line.getAttribute(side === 'start' ? 'y1' : 'y2'))
        layer.circle(12).center(x, y).fill('#fff').stroke({ color: '#25a68a', width: 2 })
          .attr({ 'data-connector-handle': id, 'data-connector-side': side, 'pointer-events': 'all', cursor: 'crosshair' })
      }
    }
  }
  if (options.marquee) {
    const box = options.marquee
    layer.rect(box.width, box.height).move(box.x, box.y).fill('#7587e51c').stroke({ color: '#6378dd', width: 1.5, dasharray: '6 4' })
  }
  if (options.snapX !== undefined) layer.line(options.snapX, 0, options.snapX, HEIGHT).stroke({ color: '#e25b91', width: 1.5, dasharray: '5 5' })
  if (options.snapY !== undefined) layer.line(0, options.snapY, WIDTH, options.snapY).stroke({ color: '#e25b91', width: 1.5, dasharray: '5 5' })
  if (options.movingBounds && options.otherBounds) {
    const horizontal = nearestGap(options.movingBounds, options.otherBounds, 'x')
    const vertical = nearestGap(options.movingBounds, options.otherBounds, 'y')
    if (horizontal && horizontal.gap <= 180) drawDistance(layer, horizontal.start, horizontal.end, horizontal.position, 'x')
    if (vertical && vertical.gap <= 180) drawDistance(layer, vertical.start, vertical.end, vertical.position, 'y')
  }
}

function findObjectTarget(stage: SVGSVGElement, target: EventTarget | null): SVGElement | undefined {
  let element = target instanceof SVGElement ? target : undefined
  while (element && element !== stage) {
    if (element.parentNode === stage && OBJECT_TAGS.has(element.tagName.toLowerCase()) && !element.hasAttribute('data-background')) return element
    element = element.parentElement instanceof SVGElement ? element.parentElement : undefined
  }
  return undefined
}

function updateMarkerColor(stage: SVGSVGElement, element: SVGElement, color: string) {
  for (const reference of [element.getAttribute('marker-end'), element.getAttribute('marker-start')]) {
    const markerId = reference?.match(/#([^)]+)/)?.[1]?.replaceAll("'", '').replaceAll('"', '')
    if (!markerId) continue
    const marker = stage.querySelector(`[id="${CSS.escape(markerId)}"]`)
    marker?.querySelectorAll('path,polygon').forEach(shape => shape.setAttribute('fill', color))
  }
}

export function VectorEditor({
  asset,
  onClose,
  onSave,
}: {
  asset?: NoteAsset
  onClose: () => void
  onSave: (svg: string) => void
}) {
  const mount = useRef<HTMLDivElement>(null)
  const drawing = useRef<Drawing | null>(null)
  const history = useRef<string[]>([])
  const redoHistory = useRef<string[]>([])
  const interaction = useRef<Interaction | null>(null)
  const textEdit = useRef<TextEdit | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const undoAction = useRef<() => void>(() => {})
  const redoAction = useRef<() => void>(() => {})
  const duplicateAction = useRef<() => void>(() => {})
  const copyAction = useRef<() => void>(() => {})
  const pasteAction = useRef<() => void>(() => {})
  const clipboard = useRef<SVGElement[]>([])
  const toolRef = useRef<Tool>('select')
  const strokeColorRef = useRef('#596fd8')
  const fillColorRef = useRef('#dfe4ff')
  const fillEnabledRef = useRef(true)
  const strokeWidthRef = useRef(3)
  const fontSizeRef = useRef(24)
  const polygonSidesRef = useRef(6)
  const arrowModeRef = useRef<ArrowMode>('end')
  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#596fd8')
  const [fillColor, setFillColor] = useState('#dfe4ff')
  const [fillEnabled, setFillEnabled] = useState(true)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(24)
  const [polygonSides, setPolygonSides] = useState(6)
  const [arrowMode, setArrowMode] = useState<ArrowMode>('end')
  const [fitToContent, setFitToContent] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasClipboard, setHasClipboard] = useState(false)

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { strokeColorRef.current = strokeColor }, [strokeColor])
  useEffect(() => { fillColorRef.current = fillColor }, [fillColor])
  useEffect(() => { fillEnabledRef.current = fillEnabled }, [fillEnabled])
  useEffect(() => { strokeWidthRef.current = strokeWidth }, [strokeWidth])
  useEffect(() => { fontSizeRef.current = fontSize }, [fontSize])
  useEffect(() => { polygonSidesRef.current = polygonSides }, [polygonSides])
  useEffect(() => { arrowModeRef.current = arrowMode }, [arrowMode])

  const chooseTool = (nextTool: Tool) => {
    toolRef.current = nextTool
    setTool(nextTool)
    if (drawing.current) {
      drawing.current.node.setAttribute('data-active-tool', nextTool)
      renderOverlay(drawing.current, selectedIdsRef.current)
    }
  }

  const select = (ids: string[]) => {
    const unique = [...new Set(ids)]
    selectedIdsRef.current = unique
    setSelectedIds(unique)
    const stage = drawing.current
    if (stage) renderOverlay(stage, unique)
  }

  const recordHistory = (stage: Drawing) => {
    const next = snapshotContent(stage)
    if (history.current.at(-1) === next) return
    history.current.push(next)
    if (history.current.length > 21) history.current.shift()
    redoHistory.current = []
    setCanUndo(history.current.length > 1)
    setCanRedo(false)
  }

  useEffect(() => {
    if (!mount.current) return
    const stage = SVG().addTo(mount.current).size('100%', '100%').viewbox(0, 0, WIDTH, HEIGHT).attr({ preserveAspectRatio: 'none', tabindex: 0, 'data-active-tool': 'select' })
    if (asset?.svg) {
      try {
        const parsed = new DOMParser().parseFromString(sanitizeSvg(asset.svg), 'image/svg+xml')
        stage.svg(parsed.documentElement.innerHTML)
      } catch {
        stage.rect(WIDTH, HEIGHT).fill('#fffdf9').attr({ 'data-background': 'true' })
      }
    } else {
      stage.rect(WIDTH, HEIGHT).fill('#fffdf9').attr({ 'data-background': 'true' })
    }
    ensureObjectIds(stage.node)
    drawing.current = stage
    history.current = [snapshotContent(stage)]
    redoHistory.current = []
    setCanUndo(false)
    setCanRedo(false)

    const point = (event: PointerEvent) => {
      const bounds = stage.node.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) * WIDTH / bounds.width)),
        y: Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) * HEIGHT / bounds.height)),
      }
    }

    const beginTextEdit = (location: { x: number; y: number }, existing?: SVGElement, keepTool = false) => {
      textEdit.current?.input.remove()
      const container = mount.current
      if (!container) return
      const bounds = stage.node.getBoundingClientRect()
      const existingBox = existing ? getBox(existing) : undefined
      const x = existingBox?.x ?? location.x
      const y = existingBox?.y ?? location.y
      const size = Number(existing?.getAttribute('font-size')) || fontSizeRef.current
      const input = document.createElement('input')
      input.className = 'canvas-text-input'
      input.type = 'text'
      input.value = existing?.textContent ?? ''
      input.placeholder = 'Wpisz tekst…'
      input.setAttribute('aria-label', 'Tekst schematu')
      input.style.left = `${x * bounds.width / WIDTH}px`
      input.style.top = `${y * bounds.height / HEIGHT}px`
      input.style.fontSize = `${size * bounds.width / WIDTH}px`
      input.style.color = existing?.getAttribute('fill') ?? strokeColorRef.current
      container.append(input)
      textEdit.current = { input, x, y, element: existing, fontSize: size, keepTool }

      const cancel = () => {
        if (textEdit.current?.input !== input) return
        textEdit.current = null
        input.remove()
      }
      const commit = () => {
        const editing = textEdit.current
        if (!editing || editing.input !== input) return
        const value = input.value.trim()
        if (editing.element) {
          if (value) editing.element.textContent = value
          else editing.element.remove()
        } else if (value) {
          const created = stage.text(value).move(editing.x, editing.y).font({ family: 'Inter, sans-serif', size: editing.fontSize, weight: 600 }).fill(strokeColorRef.current)
          const id = crypto.randomUUID()
          created.attr('data-object-id', id)
          select([id])
          if (!editing.keepTool) chooseTool('select')
        }
        textEdit.current = null
        input.remove()
        recordHistory(stage)
        renderOverlay(stage, selectedIdsRef.current)
      }
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          input.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      })
      input.addEventListener('blur', commit, { once: true })
      requestAnimationFrame(() => { input.focus(); input.select() })
    }

    const startShape = (currentTool: Tool, location: { x: number; y: number }) => {
      const color = strokeColorRef.current
      const size = strokeWidthRef.current
      let element: any
      if (currentTool === 'rect' || currentTool === 'roundRect') {
        element = stage.rect(1, 1).move(location.x, location.y)
        if (currentTool === 'roundRect') element.radius(12)
      } else if (currentTool === 'ellipse') {
        element = stage.ellipse(1, 1).move(location.x, location.y)
      } else if (currentTool === 'line' || currentTool === 'arrow') {
        element = stage.line(location.x, location.y, location.x, location.y)
        if (currentTool === 'arrow' && arrowModeRef.current !== 'none') {
          const addMarker = (side: 'start' | 'end') => element.marker(side, 14, 14, (marker: any) => marker.path('M 0 0 L 14 7 L 0 14 z').fill(color).attr({ orient: 'auto-start-reverse' }))
          if (arrowModeRef.current === 'start' || arrowModeRef.current === 'both') addMarker('start')
          if (arrowModeRef.current === 'end' || arrowModeRef.current === 'both') addMarker('end')
        }
      } else if (currentTool === 'polygon') {
        element = stage.polygon(`${location.x},${location.y} ${location.x},${location.y} ${location.x},${location.y}`)
      }
      if (!element) return
      element.stroke({ color, width: size, linecap: 'round', linejoin: 'round' })
      element.fill(fillEnabledRef.current && !['line', 'arrow'].includes(currentTool) ? fillColorRef.current : 'none')
      const id = crypto.randomUUID()
      element.attr('data-object-id', id)
      select([id])
      return { element, id }
    }

    const start = (event: PointerEvent) => {
      event.preventDefault()
      stage.node.focus({ preventScroll: true })
      const location = point(event)
      const currentTool = toolRef.current
      if (currentTool === 'text') {
        if (event.detail <= 1) beginTextEdit(location, undefined, event.ctrlKey)
        return
      }
      stage.node.setPointerCapture(event.pointerId)
      if (currentTool !== 'select') {
        const anchor = (currentTool === 'line' || currentTool === 'arrow') ? findAnchorHit(event.target) : undefined
        const target = anchor ? elementsForIds(stage.node, [anchor.id])[0] : undefined
        const anchorPoint = target && anchor ? anchorPosition(target, anchor.anchor) : undefined
        const startPoint = anchorPoint ?? location
        const created = startShape(currentTool, startPoint)
        if (created) {
          if (anchor && anchorPoint) created.element.attr({ 'data-start-target': anchor.id, 'data-start-anchor': anchor.anchor })
          interaction.current = { type: 'draw', tool: currentTool, element: created.element, id: created.id, x: startPoint.x, y: startPoint.y, keepTool: event.ctrlKey, startTarget: anchor?.id, startAnchor: anchor?.anchor }
        }
        return
      }

      const connectorHandle = findConnectorHandle(event.target)
      if (connectorHandle) {
        const line = elementsForIds(stage.node, [connectorHandle.id]).find(element => element.tagName.toLowerCase() === 'line') as SVGLineElement | undefined
        if (line) {
          select([connectorHandle.id])
          stage.node.setAttribute('data-connector-dragging', 'true')
          renderOverlay(stage, [connectorHandle.id])
          interaction.current = {
            type: 'connect',
            line,
            id: connectorHandle.id,
            side: connectorHandle.side,
            x: Number(line.getAttribute(connectorHandle.side === 'start' ? 'x1' : 'x2')),
            y: Number(line.getAttribute(connectorHandle.side === 'start' ? 'y1' : 'y2')),
            moved: false,
          }
        }
        return
      }

      const anchorHit = findAnchorHit(event.target)
      const target = anchorHit ? elementsForIds(stage.node, [anchorHit.id])[0] : findObjectTarget(stage.node, event.target)
      if (!target) {
        const initialIds = event.shiftKey ? selectedIdsRef.current : []
        if (!event.shiftKey) select([])
        interaction.current = { type: 'marquee', x: location.x, y: location.y, additive: event.shiftKey, initialIds, moved: false }
        return
      }
      const id = target.getAttribute('data-object-id')
      if (!id) return
      let ids = selectedIdsRef.current
      if (event.shiftKey) {
        ids = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
        select(ids)
        if (!ids.includes(id)) return
      } else if (!ids.includes(id)) {
        ids = [id]
        select(ids)
      }
      const elements = elementsForIds(stage.node, ids)
      const bounds = unionBoxes(elements.map(getBox))
      if (!bounds) return
      const others = directObjects(stage.node).filter(element => !ids.includes(element.getAttribute('data-object-id') ?? '')).map(getBox).filter((box): box is Box => Boolean(box))
      interaction.current = { type: 'move', ids, elements, others, startX: location.x, startY: location.y, lastX: 0, lastY: 0, bounds, moved: false }
    }

    const move = (event: PointerEvent) => {
      const current = interaction.current
      if (!current) return
      const location = point(event)
      if (current.type === 'draw') {
        current.keepTool = current.keepTool || event.ctrlKey
        const x = Math.min(current.x, location.x)
        const y = Math.min(current.y, location.y)
        const width = Math.max(12, Math.abs(location.x - current.x))
        const height = Math.max(12, Math.abs(location.y - current.y))
        if (current.tool === 'rect' || current.tool === 'roundRect') current.element.move(x, y).size(width, height)
        else if (current.tool === 'ellipse') current.element.move(x, y).size(width, height)
        else if (current.tool === 'line' || current.tool === 'arrow') {
          const hovered = document.elementFromPoint(event.clientX, event.clientY)
          const hit = findAnchorHit(hovered)
          const endShape = hit ? elementsForIds(stage.node, [hit.id])[0] : undefined
          const end = endShape && hit ? anchorPosition(endShape, hit.anchor) : undefined
          if (hit && end && hit.id !== current.startTarget) {
            current.element.plot(current.x, current.y, end.x, end.y)
            current.element.attr({ 'data-end-target': hit.id, 'data-end-anchor': hit.anchor })
          } else {
            current.element.plot(current.x, current.y, location.x, location.y)
            current.element.node.removeAttribute('data-end-target')
            current.element.node.removeAttribute('data-end-anchor')
          }
        } else if (current.tool === 'polygon') {
          const sides = polygonSidesRef.current
          const cx = x + width / 2
          const cy = y + height / 2
          const points = Array.from({ length: sides }, (_, index) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / sides
            return `${cx + Math.cos(angle) * width / 2},${cy + Math.sin(angle) * height / 2}`
          }).join(' ')
          current.element.plot(points)
        }
        updateConnectors(stage.node)
        renderOverlay(stage, [current.id])
      } else if (current.type === 'connect') {
        if (!current.moved && Math.hypot(location.x - current.x, location.y - current.y) < 2) return
        current.moved = true
        const hovered = document.elementFromPoint(event.clientX, event.clientY)
        const hit = findAnchorHit(hovered)
        const target = hit ? elementsForIds(stage.node, [hit.id])[0] : undefined
        const targetPoint = target && hit ? anchorPosition(target, hit.anchor) : undefined
        const otherSide = current.side === 'start' ? 'end' : 'start'
        const otherTarget = current.line.getAttribute(`data-${otherSide}-target`)
        if (hit && targetPoint && hit.id !== current.id && hit.id !== otherTarget) {
          setLineEndpoint(current.line, current.side, targetPoint)
          current.line.setAttribute(`data-${current.side}-target`, hit.id)
          current.line.setAttribute(`data-${current.side}-anchor`, hit.anchor)
        } else {
          setLineEndpoint(current.line, current.side, location)
          current.line.removeAttribute(`data-${current.side}-target`)
          current.line.removeAttribute(`data-${current.side}-anchor`)
        }
        updateConnectors(stage.node)
        renderOverlay(stage, [current.id])
      } else if (current.type === 'move') {
        const rawX = location.x - current.startX
        const rawY = location.y - current.startY
        const xBounds = { ...current.bounds, x: current.bounds.x + rawX }
        const yBounds = { ...current.bounds, y: current.bounds.y + rawY }
        const snapX = getSnap(xBounds, current.others, 'x')
        const snapY = getSnap(yBounds, current.others, 'y')
        const totalX = rawX + (snapX?.delta ?? 0)
        const totalY = rawY + (snapY?.delta ?? 0)
        const deltaX = totalX - current.lastX
        const deltaY = totalY - current.lastY
        if (Math.abs(deltaX) + Math.abs(deltaY) > 0.1) current.moved = true
        current.elements.forEach(element => (SVG(element) as any).dmove(deltaX, deltaY))
        updateConnectors(stage.node)
        current.lastX = totalX
        current.lastY = totalY
        const movedBounds = unionBoxes(current.elements.map(getBox))
        renderOverlay(stage, current.ids, {
          snapX: snapX?.target,
          snapY: snapY?.target,
          movingBounds: movedBounds,
          otherBounds: current.others,
        })
      } else {
        const box = { x: Math.min(current.x, location.x), y: Math.min(current.y, location.y), width: Math.abs(location.x - current.x), height: Math.abs(location.y - current.y) }
        current.moved = current.moved || box.width + box.height > 2
        const matches = directObjects(stage.node).filter(element => {
          const bounds = getBox(element)
          return bounds && intersect(box, bounds)
        }).map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
        const ids = current.additive ? [...current.initialIds, ...matches] : matches
        renderOverlay(stage, ids, { marquee: box })
      }
    }

    const finish = (event: PointerEvent) => {
      const current = interaction.current
      if (!current) return
      interaction.current = null
      if (current.type === 'draw') {
        current.keepTool = current.keepTool || event.ctrlKey
        if (current.tool === 'line' || current.tool === 'arrow') {
          const hit = findAnchorHit(document.elementFromPoint(event.clientX, event.clientY))
          const target = hit ? elementsForIds(stage.node, [hit.id])[0] : undefined
          const anchor = target && hit ? anchorPosition(target, hit.anchor) : undefined
          if (hit && anchor && hit.id !== current.startTarget) {
            current.element.plot(current.x, current.y, anchor.x, anchor.y)
            current.element.attr({ 'data-end-target': hit.id, 'data-end-anchor': hit.anchor })
          }
          updateConnectors(stage.node)
        }
        recordHistory(stage)
        renderOverlay(stage, [current.id])
        if (!current.keepTool) chooseTool('select')
      } else if (current.type === 'connect') {
        stage.node.removeAttribute('data-connector-dragging')
        if (current.moved) recordHistory(stage)
        renderOverlay(stage, [current.id])
      } else if (current.type === 'move') {
        if (current.moved) recordHistory(stage)
        renderOverlay(stage, current.ids)
      } else {
        if (current.moved) {
          const location = point(event)
          const box = { x: Math.min(current.x, location.x), y: Math.min(current.y, location.y), width: Math.abs(location.x - current.x), height: Math.abs(location.y - current.y) }
          const all = directObjects(stage.node).filter(element => {
            const bounds = getBox(element)
            return bounds && intersect(box, bounds)
          }).map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
          select(current.additive ? [...current.initialIds, ...all] : all)
        } else if (!current.additive) select([])
      }
    }

    const keydown = (event: KeyboardEvent) => {
      if (event.target !== stage.node) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIdsRef.current.length) {
        event.preventDefault()
        const ids = new Set(selectedIdsRef.current)
        detachConnectors(stage.node, [...ids])
        elementsForIds(stage.node, [...ids]).forEach(element => element.remove())
        select([])
        recordHistory(stage)
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedIdsRef.current.length) {
        event.preventDefault()
        duplicateAction.current()
      }
    }

    const historyKeydown = (event: KeyboardEvent) => {
      const dialog = mount.current?.closest('[role="dialog"]')
      if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const editingText = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'))
      if (key === 'c' && !editingText && selectedIdsRef.current.length) {
        event.preventDefault()
        event.stopPropagation()
        copyAction.current()
        return
      }
      if (key === 'v' && !editingText && clipboard.current.length) {
        event.preventDefault()
        event.stopPropagation()
        pasteAction.current()
        return
      }
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        undoAction.current()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        event.stopPropagation()
        redoAction.current()
      }
    }

    const doubleClick = (event: MouseEvent) => {
      const target = findObjectTarget(stage.node, event.target)
      if (target?.tagName.toLowerCase() === 'text') {
        event.preventDefault()
        const bounds = getBox(target)
        if (bounds) beginTextEdit({ x: bounds.x, y: bounds.y }, target, event.ctrlKey)
      }
    }

    stage.node.addEventListener('pointerdown', start)
    stage.node.addEventListener('pointermove', move)
    stage.node.addEventListener('pointerup', finish)
    stage.node.addEventListener('pointercancel', finish)
    stage.node.addEventListener('keydown', keydown)
    stage.node.addEventListener('dblclick', doubleClick)
    window.addEventListener('keydown', historyKeydown, true)
    return () => {
      stage.node.removeEventListener('pointerdown', start)
      stage.node.removeEventListener('pointermove', move)
      stage.node.removeEventListener('pointerup', finish)
      stage.node.removeEventListener('pointercancel', finish)
      stage.node.removeEventListener('keydown', keydown)
      stage.node.removeEventListener('dblclick', doubleClick)
      window.removeEventListener('keydown', historyKeydown, true)
      textEdit.current?.input.remove()
      textEdit.current = null
      stage.remove()
      drawing.current = null
    }
  }, [asset?.id, asset?.svg])

  useEffect(() => {
    drawing.current?.node.setAttribute('data-active-tool', tool)
    if (drawing.current) renderOverlay(drawing.current, selectedIdsRef.current)
  }, [tool])

  function undo() {
    const stage = drawing.current
    if (!stage || history.current.length < 2) return
    redoHistory.current.push(history.current.pop()!)
    stage.clear()
    stage.svg(history.current.at(-1) ?? '')
    ensureObjectIds(stage.node)
    updateConnectors(stage.node)
    selectedIdsRef.current = []
    setSelectedIds([])
    setCanUndo(history.current.length > 1)
    setCanRedo(redoHistory.current.length > 0)
    renderOverlay(stage, [])
  }

  function redo() {
    const stage = drawing.current
    const next = redoHistory.current.pop()
    if (!stage || !next) return
    history.current.push(next)
    stage.clear()
    stage.svg(next)
    ensureObjectIds(stage.node)
    updateConnectors(stage.node)
    selectedIdsRef.current = []
    setSelectedIds([])
    setCanUndo(history.current.length > 1)
    setCanRedo(redoHistory.current.length > 0)
    renderOverlay(stage, [])
  }

  function copySelected() {
    const stage = drawing.current
    clipboard.current = stage ? elementsForIds(stage.node, selectedIdsRef.current).map(element => element.cloneNode(true) as SVGElement) : []
    setHasClipboard(clipboard.current.length > 0)
  }

  function pasteCopied() {
    const stage = drawing.current
    if (!stage || !clipboard.current.length) return
    const idMap = new Map<string, string>()
    const cloned = clipboard.current.map(element => {
      const copy = element.cloneNode(true) as SVGElement
      const id = crypto.randomUUID()
      const originalId = element.getAttribute('data-object-id')
      if (originalId) idMap.set(originalId, id)
      copy.setAttribute('data-object-id', id)
      stage.node.append(copy)
      ;(SVG(copy) as any).dmove(20, 20)
      return { copy, id }
    })
    cloned.forEach(({ copy }) => {
      for (const side of ['start', 'end'] as const) {
        const attribute = `data-${side}-target`
        const target = copy.getAttribute(attribute)
        if (!target) continue
        const replacement = idMap.get(target)
        if (replacement) copy.setAttribute(attribute, replacement)
        else {
          copy.removeAttribute(attribute)
          copy.removeAttribute(`data-${side}-anchor`)
        }
      }
    })
    updateConnectors(stage.node)
    const copies = cloned.map(({ id }) => id)
    selectedIdsRef.current = copies
    setSelectedIds(copies)
    recordHistory(stage)
    renderOverlay(stage, copies)
    stage.node.focus({ preventScroll: true })
  }

  function duplicateSelected() {
    copySelected()
    pasteCopied()
  }

  useEffect(() => {
    undoAction.current = undo
    redoAction.current = redo
    duplicateAction.current = duplicateSelected
    copyAction.current = copySelected
    pasteAction.current = pasteCopied
  })

  function deleteSelected() {
    const stage = drawing.current
    if (!stage || !selectedIdsRef.current.length) return
    detachConnectors(stage.node, selectedIdsRef.current)
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.remove())
    selectedIdsRef.current = []
    setSelectedIds([])
    recordHistory(stage)
    renderOverlay(stage, [])
    stage.node.focus({ preventScroll: true })
  }

  function applyStrokeColor(value: string) {
    strokeColorRef.current = value
    setStrokeColor(value)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => {
      if (element.tagName.toLowerCase() === 'text') element.setAttribute('fill', value)
      else {
        element.setAttribute('stroke', value)
        updateMarkerColor(stage.node, element, value)
      }
    })
    recordHistory(stage)
  }

  function applyFillColor(value: string) {
    fillColorRef.current = value
    setFillColor(value)
    const stage = drawing.current
    if (!stage) return
    if (fillEnabledRef.current) {
      elementsForIds(stage.node, selectedIdsRef.current).filter(element => !['text', 'line'].includes(element.tagName.toLowerCase()))
        .forEach(element => element.setAttribute('fill', value))
      recordHistory(stage)
    }
  }

  function applyFillEnabled(value: boolean) {
    fillEnabledRef.current = value
    setFillEnabled(value)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).filter(element => !['text', 'line'].includes(element.tagName.toLowerCase()))
      .forEach(element => element.setAttribute('fill', value ? fillColorRef.current : 'none'))
    recordHistory(stage)
  }

  function applyStrokeWidth(value: number) {
    strokeWidthRef.current = value
    setStrokeWidth(value)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.setAttribute('stroke-width', `${value}`))
    recordHistory(stage)
  }

  function applyFontSize(value: number) {
    const next = Math.max(8, Math.min(96, value || 24))
    fontSizeRef.current = next
    setFontSize(next)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.tagName.toLowerCase() === 'text')
      .forEach(element => element.setAttribute('font-size', `${next}`))
    recordHistory(stage)
  }

  const save = () => {
    const stage = drawing.current
    if (!stage) return
    const copy = stage.node.cloneNode(true) as SVGSVGElement
    copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
    if (fitToContent) copy.querySelectorAll('[data-background]').forEach(element => element.remove())
    else copy.querySelectorAll('[data-background]').forEach(element => element.removeAttribute('data-background'))
    if (fitToContent) {
      const bounds = unionBoxes(directObjects(stage.node).map(getBox))
      if (bounds) {
        const margin = 20
        const x = Math.floor(bounds.x - margin)
        const y = Math.floor(bounds.y - margin)
        const width = Math.max(1, Math.ceil(bounds.width + margin * 2))
        const height = Math.max(1, Math.ceil(bounds.height + margin * 2))
        copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
        copy.setAttribute('width', `${width}`)
        copy.setAttribute('height', `${height}`)
      }
    }
    onSave(sanitizeSvg(new XMLSerializer().serializeToString(copy)))
  }

  const tools: { id: Tool; label: string; icon: typeof RectangleHorizontal }[] = [
    { id: 'select', label: 'Zaznacz i przesuń', icon: MousePointer2 },
    { id: 'rect', label: 'Prostokąt', icon: RectangleHorizontal },
    { id: 'roundRect', label: 'Zaokrąglony prostokąt', icon: RectangleVertical },
    { id: 'ellipse', label: 'Elipsa', icon: Circle },
    { id: 'line', label: 'Linia', icon: Minus },
    { id: 'arrow', label: 'Strzałka', icon: ArrowRight },
    { id: 'polygon', label: 'Wielokąt', icon: Triangle },
    { id: 'text', label: 'Tekst na planszy', icon: Type },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="drawing-modal advanced-drawing-modal" role="dialog" aria-modal="true" aria-labelledby="drawing-title">
        <header className="modal-heading">
          <div><p className="eyebrow">EDYTOR SVG</p><h2 id="drawing-title">{asset ? 'Edytuj schemat' : 'Nowy schemat'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={19} /></button>
        </header>
        <div className="drawing-toolbar advanced-drawing-toolbar">
          <div className="drawing-tool-group" role="group" aria-label="Narzędzia rysowania">
            {tools.map(item => {
              const Icon = item.icon
              return <button key={item.id} className={`tool-button ${tool === item.id ? 'selected' : ''}`} onClick={() => chooseTool(item.id)} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}><Icon size={17} /></button>
            })}
          </div>
          {tool === 'arrow' && <label className="drawing-select-control"><span>Strzałka</span><select value={arrowMode} onChange={event => setArrowMode(event.target.value as ArrowMode)} aria-label="Rodzaj strzałki"><option value="end">Grot na końcu</option><option value="start">Grot na początku</option><option value="both">Groty po obu stronach</option><option value="none">Bez grotu</option></select></label>}
          {tool === 'polygon' && <label className="drawing-select-control"><span>Wielokąt</span><select value={polygonSides} onChange={event => setPolygonSides(Number(event.target.value))} aria-label="Typ wielokąta"><option value="3">Trójkąt</option><option value="4">Romb</option><option value="5">Pięciokąt</option><option value="6">Sześciokąt</option><option value="8">Ośmiokąt</option></select></label>}
          <span className="toolbar-divider" />
          <label className="color-control" title="Kolor konturu">
            <input type="color" value={strokeColor} onChange={event => applyStrokeColor(event.target.value)} aria-label="Kolor konturu" />
            <span>Kontur</span>
          </label>
          <label className={`color-control ${!fillEnabled ? 'option-disabled' : ''}`} title="Kolor wypełnienia">
            <input type="color" value={fillColor} onChange={event => applyFillColor(event.target.value)} aria-label="Kolor wypełnienia" disabled={!fillEnabled} />
            <span>Wypełnienie</span>
          </label>
          <label className="fill-toggle"><input type="checkbox" checked={fillEnabled} onChange={event => applyFillEnabled(event.target.checked)} aria-label="Włącz wypełnienie" />Wypełnij</label>
          <label className="line-width-control" title="Grubość konturu"><span>Linia</span><input type="range" min="1" max="8" value={strokeWidth} onChange={event => applyStrokeWidth(Number(event.target.value))} aria-label="Grubość konturu" /><output>{strokeWidth}</output></label>
          <label className="font-size-control" title="Rozmiar tekstu"><Type size={14} /><input type="number" min="8" max="96" value={fontSize} onChange={event => applyFontSize(Number(event.target.value))} aria-label="Rozmiar tekstu" /></label>
          <label className="fill-toggle fit-content-toggle" title="Dopasuj rozmiar SVG do rysunku"><input type="checkbox" checked={fitToContent} onChange={event => setFitToContent(event.target.checked)} aria-label="Dopasuj obszar SVG do treści" />Przytnij SVG</label>
          <span className="toolbar-divider" />
          <span className="selection-count">{selectedIds.length ? `${selectedIds.length} zazn.` : 'Brak zaznaczenia'}</span>
          <button className="tool-button" onClick={copySelected} disabled={!selectedIds.length} title="Kopiuj zaznaczenie (Ctrl+C)" aria-label="Kopiuj zaznaczenie"><ClipboardCopy size={16} /></button>
          <button className="tool-button" onClick={pasteCopied} disabled={!hasClipboard} title="Wklej zaznaczenie (Ctrl+V)" aria-label="Wklej zaznaczenie"><ClipboardPaste size={16} /></button>
          <button className="tool-button" onClick={duplicateSelected} disabled={!selectedIds.length} title="Duplikuj zaznaczenie (Ctrl+D)" aria-label="Duplikuj zaznaczenie"><Copy size={16} /></button>
          <button className="tool-button delete-tool" onClick={deleteSelected} disabled={!selectedIds.length} title="Usuń zaznaczenie (Delete)" aria-label="Usuń zaznaczenie"><Trash2 size={16} /></button>
          <button className="tool-button" onClick={undo} disabled={!canUndo} title="Cofnij (Ctrl+Z)" aria-label="Cofnij"><Undo2 size={17} /></button>
          <button className="tool-button" onClick={redo} disabled={!canRedo} title="Ponów (Ctrl+Y)" aria-label="Ponów"><Redo2 size={17} /></button>
        </div>
        <div className="drawing-stage-wrap"><div ref={mount} className="drawing-stage" /></div>
        <footer className="modal-footer advanced-modal-footer"><p>Przeciągnij po pustym miejscu, aby zaznaczyć · Shift+dodaj · przeciągnij uchwyt linii na punkt figury · Ctrl+Z cofnij · Ctrl+Y ponów · Ctrl+D duplikuj</p><div><button className="button secondary" onClick={onClose}>Anuluj</button><button className="button primary" onClick={save}>Zapisz grafikę</button></div></footer>
      </section>
    </div>
  )
}
