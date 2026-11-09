import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Circle, Copy, Diamond, Minus, MousePointer2, RectangleHorizontal,
  RectangleVertical, Trash2, Triangle, Type, Undo2, X,
} from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'

type Tool = 'select' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'triangle' | 'diamond' | 'text'
type Box = { x: number; y: number; width: number; height: number }
type Snap = { delta: number; target: number } | undefined
type Interaction =
  | { type: 'draw'; tool: Tool; element: any; id: string; x: number; y: number }
  | { type: 'move'; ids: string[]; elements: SVGElement[]; others: Box[]; startX: number; startY: number; lastX: number; lastY: number; bounds: Box; moved: boolean }
  | { type: 'marquee'; x: number; y: number; additive: boolean; initialIds: string[]; moved: boolean }

type OverlayOptions = {
  marquee?: Box
  snapX?: number
  snapY?: number
  movingBounds?: Box
  otherBounds?: Box[]
}

type TextEdit = { input: HTMLInputElement; x: number; y: number; element?: SVGElement; fontSize: number }
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
  const reference = element.getAttribute('marker-end') ?? element.getAttribute('marker-start')
  const markerId = reference?.match(/#([^)]+)/)?.[1]?.replaceAll("'", '').replaceAll('"', '')
  if (!markerId) return
  const marker = stage.querySelector(`[id="${CSS.escape(markerId)}"]`)
  marker?.querySelectorAll('path,polygon').forEach(shape => shape.setAttribute('fill', color))
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
  const interaction = useRef<Interaction | null>(null)
  const textEdit = useRef<TextEdit | null>(null)
  const selectedIdsRef = useRef<string[]>([])
  const undoAction = useRef<() => void>(() => {})
  const duplicateAction = useRef<() => void>(() => {})
  const toolRef = useRef<Tool>('select')
  const strokeColorRef = useRef('#596fd8')
  const fillColorRef = useRef('#dfe4ff')
  const fillEnabledRef = useRef(true)
  const strokeWidthRef = useRef(3)
  const fontSizeRef = useRef(24)
  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#596fd8')
  const [fillColor, setFillColor] = useState('#dfe4ff')
  const [fillEnabled, setFillEnabled] = useState(true)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(24)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { strokeColorRef.current = strokeColor }, [strokeColor])
  useEffect(() => { fillColorRef.current = fillColor }, [fillColor])
  useEffect(() => { fillEnabledRef.current = fillEnabled }, [fillEnabled])
  useEffect(() => { strokeWidthRef.current = strokeWidth }, [strokeWidth])
  useEffect(() => { fontSizeRef.current = fontSize }, [fontSize])

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
    if (history.current.length > 60) history.current.shift()
    setCanUndo(history.current.length > 1)
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
    setCanUndo(false)

    const point = (event: PointerEvent) => {
      const bounds = stage.node.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) * WIDTH / bounds.width)),
        y: Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) * HEIGHT / bounds.height)),
      }
    }

    const beginTextEdit = (location: { x: number; y: number }, existing?: SVGElement) => {
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
      textEdit.current = { input, x, y, element: existing, fontSize: size }

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
        if (currentTool === 'arrow') element.marker('end', 14, 14, (marker: any) => marker.path('M 0 0 L 14 7 L 0 14 z').fill(color))
      } else if (currentTool === 'triangle') {
        element = stage.polygon(`${location.x},${location.y} ${location.x},${location.y} ${location.x},${location.y}`)
      } else if (currentTool === 'diamond') {
        element = stage.polygon(`${location.x},${location.y} ${location.x},${location.y} ${location.x},${location.y} ${location.x},${location.y}`)
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
        if (event.detail <= 1) beginTextEdit(location)
        return
      }
      stage.node.setPointerCapture(event.pointerId)
      if (currentTool !== 'select') {
        const created = startShape(currentTool, location)
        if (created) interaction.current = { type: 'draw', tool: currentTool, element: created.element, id: created.id, x: location.x, y: location.y }
        return
      }

      const target = findObjectTarget(stage.node, event.target)
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
        const x = Math.min(current.x, location.x)
        const y = Math.min(current.y, location.y)
        const width = Math.max(12, Math.abs(location.x - current.x))
        const height = Math.max(12, Math.abs(location.y - current.y))
        if (current.tool === 'rect' || current.tool === 'roundRect') current.element.move(x, y).size(width, height)
        else if (current.tool === 'ellipse') current.element.move(x, y).size(width, height)
        else if (current.tool === 'line' || current.tool === 'arrow') current.element.plot(current.x, current.y, location.x, location.y)
        else if (current.tool === 'triangle') current.element.plot(`${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`)
        else if (current.tool === 'diamond') current.element.plot(`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`)
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
        recordHistory(stage)
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
        elementsForIds(stage.node, [...ids]).forEach(element => element.remove())
        select([])
        recordHistory(stage)
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedIdsRef.current.length) {
        event.preventDefault()
        duplicateAction.current()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoAction.current()
      }
    }

    const doubleClick = (event: MouseEvent) => {
      const target = findObjectTarget(stage.node, event.target)
      if (target?.tagName.toLowerCase() === 'text') {
        event.preventDefault()
        const bounds = getBox(target)
        if (bounds) beginTextEdit({ x: bounds.x, y: bounds.y }, target)
      }
    }

    stage.node.addEventListener('pointerdown', start)
    stage.node.addEventListener('pointermove', move)
    stage.node.addEventListener('pointerup', finish)
    stage.node.addEventListener('pointercancel', finish)
    stage.node.addEventListener('keydown', keydown)
    stage.node.addEventListener('dblclick', doubleClick)
    return () => {
      stage.node.removeEventListener('pointerdown', start)
      stage.node.removeEventListener('pointermove', move)
      stage.node.removeEventListener('pointerup', finish)
      stage.node.removeEventListener('pointercancel', finish)
      stage.node.removeEventListener('keydown', keydown)
      stage.node.removeEventListener('dblclick', doubleClick)
      textEdit.current?.input.remove()
      textEdit.current = null
      stage.remove()
      drawing.current = null
    }
  }, [asset?.id, asset?.svg])

  useEffect(() => {
    drawing.current?.node.setAttribute('data-active-tool', tool)
  }, [tool])

  function undo() {
    const stage = drawing.current
    if (!stage || history.current.length < 2) return
    history.current.pop()
    stage.clear()
    stage.svg(history.current.at(-1) ?? '')
    ensureObjectIds(stage.node)
    selectedIdsRef.current = []
    setSelectedIds([])
    setCanUndo(history.current.length > 1)
    renderOverlay(stage, [])
  }

  function duplicateSelected() {
    const stage = drawing.current
    const elements = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    if (!stage || !elements.length) return
    const copies = elements.map(element => {
      const copy = element.cloneNode(true) as SVGElement
      const id = crypto.randomUUID()
      copy.setAttribute('data-object-id', id)
      stage.node.append(copy)
      ;(SVG(copy) as any).dmove(20, 20)
      return id
    })
    selectedIdsRef.current = copies
    setSelectedIds(copies)
    recordHistory(stage)
    renderOverlay(stage, copies)
    stage.node.focus({ preventScroll: true })
  }

  useEffect(() => {
    undoAction.current = undo
    duplicateAction.current = duplicateSelected
  })

  function deleteSelected() {
    const stage = drawing.current
    if (!stage || !selectedIdsRef.current.length) return
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
    copy.querySelectorAll('[data-object-id], [data-background]').forEach(element => {
      element.removeAttribute('data-object-id')
      element.removeAttribute('data-background')
    })
    onSave(sanitizeSvg(new XMLSerializer().serializeToString(copy)))
  }

  const tools: { id: Tool; label: string; icon: typeof RectangleHorizontal }[] = [
    { id: 'select', label: 'Zaznacz i przesuń', icon: MousePointer2 },
    { id: 'rect', label: 'Prostokąt', icon: RectangleHorizontal },
    { id: 'roundRect', label: 'Zaokrąglony prostokąt', icon: RectangleVertical },
    { id: 'ellipse', label: 'Elipsa', icon: Circle },
    { id: 'line', label: 'Linia', icon: Minus },
    { id: 'arrow', label: 'Strzałka', icon: ArrowRight },
    { id: 'triangle', label: 'Trójkąt', icon: Triangle },
    { id: 'diamond', label: 'Romb', icon: Diamond },
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
              return <button key={item.id} className={`tool-button ${tool === item.id ? 'selected' : ''}`} onClick={() => setTool(item.id)} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}><Icon size={17} /></button>
            })}
          </div>
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
          <span className="toolbar-divider" />
          <span className="selection-count">{selectedIds.length ? `${selectedIds.length} zazn.` : 'Brak zaznaczenia'}</span>
          <button className="tool-button" onClick={duplicateSelected} disabled={!selectedIds.length} title="Duplikuj zaznaczenie (Ctrl+D)" aria-label="Duplikuj zaznaczenie"><Copy size={16} /></button>
          <button className="tool-button delete-tool" onClick={deleteSelected} disabled={!selectedIds.length} title="Usuń zaznaczenie (Delete)" aria-label="Usuń zaznaczenie"><Trash2 size={16} /></button>
          <button className="tool-button" onClick={undo} disabled={!canUndo} title="Cofnij (Ctrl+Z)" aria-label="Cofnij"><Undo2 size={17} /></button>
        </div>
        <div className="drawing-stage-wrap"><div ref={mount} className="drawing-stage" /></div>
        <footer className="modal-footer advanced-modal-footer"><p>Przeciągnij po pustym miejscu, aby zaznaczyć · Shift+dodaj · dwuklik tekstu edytuje · Ctrl+D duplikuj · Delete usuń</p><div><button className="button secondary" onClick={onClose}>Anuluj</button><button className="button primary" onClick={save}>Zapisz grafikę</button></div></footer>
      </section>
    </div>
  )
}
