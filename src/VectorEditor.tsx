import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, Circle, ClipboardCopy, ClipboardPaste, Copy, Group, Minus, MousePointer2,
  Pencil, RectangleHorizontal, RectangleVertical, Redo2, Shapes, Trash2, Triangle, Type, Undo2, Ungroup, X,
} from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'
import { shapeById, shapeCategories, shapeLibrary } from './shapeLibrary'

type Tool = 'select' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'shape' | 'freehand' | 'text'
type ArrowMode = 'end' | 'start' | 'both' | 'none'
type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type GeometryDraft = { x: string; y: string; width: string; height: string }
type Snap = { delta: number; target: number } | undefined
type Interaction =
  | { type: 'draw'; tool: Tool; element: any; id: string; x: number; y: number; keepTool: boolean; startTarget?: string; startAnchor?: string }
  | { type: 'freehand'; element: any; id: string; points: Point[]; keepTool: boolean }
  | { type: 'connect'; line: SVGLineElement; id: string; side: 'start' | 'end'; x: number; y: number; moved: boolean }
  | { type: 'move'; ids: string[]; elements: SVGElement[]; others: Box[]; startX: number; startY: number; lastX: number; lastY: number; bounds: Box; moved: boolean }
  | { type: 'resize'; ids: string[]; targets: { element: SVGElement; source: SVGElement; box: Box }[]; startBounds: Box; handle: ResizeHandle; moved: boolean }
  | { type: 'marquee'; x: number; y: number; additive: boolean; initialIds: string[]; moved: boolean }

type OverlayOptions = {
  marquee?: Box
  dimensions?: Box
  snapX?: number
  snapY?: number
  movingBounds?: Box
  otherBounds?: Box[]
}

type TextEdit = { input: HTMLInputElement; x: number; y: number; element?: SVGElement; fontSize: number; keepTool: boolean }
type Drawing = Svg

const WIDTH = 800
const HEIGHT = 500
const SNAP_DISTANCE = 4
const OBJECT_TAGS = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'use'])
const SVG_NS = 'http://www.w3.org/2000/svg'

function shapeTransform(box: Box): string {
  return `translate(${rounded(box.x)} ${rounded(box.y)}) scale(${rounded(box.width / 100)} ${rounded(box.height / 100)})`
}

function pointsBounds(points: Point[]): Box {
  const x = Math.min(...points.map(point => point.x))
  const y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(0.1, Math.max(...points.map(point => point.x)) - x), height: Math.max(0.1, Math.max(...points.map(point => point.y)) - y) }
}

function smoothStroke(points: Point[]): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${rounded(points[0].x)} ${rounded(points[0].y)} l 0.1 0`
  let path = `M ${rounded(points[0].x)} ${rounded(points[0].y)}`
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const control1 = { x: start.x + (end.x - previous.x) / 6, y: start.y + (end.y - previous.y) / 6 }
    const control2 = { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 }
    path += ` C ${rounded(control1.x)} ${rounded(control1.y)} ${rounded(control2.x)} ${rounded(control2.y)} ${rounded(end.x)} ${rounded(end.y)}`
  }
  return path
}

function simplifyStroke(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const first = points[0]
  const last = points[points.length - 1]
  let farthest = -1
  let farthestDistance = 0
  for (let index = 1; index < points.length - 1; index++) {
    const distance = Math.hypot(points[index].x - first.x, points[index].y - first.y)
    if (distance > farthestDistance) {
      farthest = index
      farthestDistance = distance
    }
  }
  const closed = Math.hypot(first.x - last.x, first.y - last.y) <= Math.max(8, farthestDistance * 0.18)
  const simplifyOpen = (segment: Point[]): Point[] => {
    if (segment.length < 3) return segment
    const start = segment[0]
    const end = segment[segment.length - 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    let maxDistance = 0
    let maxIndex = 0
    for (let index = 1; index < segment.length - 1; index++) {
      const point = segment[index]
      const distance = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
      if (distance > maxDistance) { maxDistance = distance; maxIndex = index }
    }
    if (maxDistance <= tolerance) return [start, end]
    return [...simplifyOpen(segment.slice(0, maxIndex + 1)).slice(0, -1), ...simplifyOpen(segment.slice(maxIndex))]
  }
  if (!closed || farthest <= 0) return simplifyOpen(points)
  const loop = points.slice(0, -1)
  const left = simplifyOpen(loop.slice(0, farthest + 1))
  const right = simplifyOpen([...loop.slice(farthest), loop[0]])
  const result = [...left.slice(0, -1), ...right.slice(0, -1)]
  return result.length >= 3 ? result : loop
}

type SketchRecognition =
  | { type: 'line'; start: Point; end: Point }
  | { type: 'rect'; box: Box }
  | { type: 'ellipse'; box: Box; circle: boolean }
  | { type: 'polygon'; points: Point[] }

function recognizeSketch(points: Point[]): SketchRecognition | undefined {
  if (points.length < 3) return undefined
  const box = pointsBounds(points)
  const diagonal = Math.hypot(box.width, box.height)
  const closed = Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) <= Math.max(10, diagonal * 0.2)
  if (!closed) {
    const simplified = simplifyStroke(points, Math.max(2.5, diagonal * 0.035))
    if (simplified.length === 2) {
      const start = simplified[0]
      const end = simplified[1]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      const maxDistance = Math.max(...points.map(point => Math.abs((end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x))) / Math.max(length, 1)
      if (maxDistance <= Math.max(3, diagonal * 0.06)) return { type: 'line', start, end }
    }
    return undefined
  }

  const corners = simplifyStroke(points, Math.max(2, diagonal * 0.045))
  if (corners.length === 4) {
    const rightAngles = corners.every((point, index) => {
      const before = corners[(index + corners.length - 1) % corners.length]
      const after = corners[(index + 1) % corners.length]
      const a = { x: before.x - point.x, y: before.y - point.y }
      const b = { x: after.x - point.x, y: after.y - point.y }
      return Math.abs((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1)) < 0.4
    })
    if (rightAngles) {
      let cleanBox = box
      if (Math.abs(box.width - box.height) / Math.max(box.width, box.height) < 0.18) {
        const side = (box.width + box.height) / 2
        cleanBox = { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side }
      }
      return { type: 'rect', box: cleanBox }
    }
  }
  const meanRadius = points.reduce((sum, point) => sum + Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2)), 0) / points.length
  const radialDeviation = points.reduce((sum, point) => sum + Math.abs(Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2)) - meanRadius), 0) / points.length / Math.max(meanRadius, 1)
  let smoothTurns = 0
  let measuredTurns = 0
  for (let index = 2; index < points.length - 2; index++) {
    const before = { x: points[index].x - points[index - 2].x, y: points[index].y - points[index - 2].y }
    const after = { x: points[index + 2].x - points[index].x, y: points[index + 2].y - points[index].y }
    const angle = Math.abs(Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y))
    measuredTurns++
    if (angle > 0.08) smoothTurns++
  }
  const curveRatio = smoothTurns / Math.max(measuredTurns, 1)
  if (corners.length >= 6 && points.length >= 12 && radialDeviation < 0.2 && curveRatio > 0.26) {
    return { type: 'ellipse', box, circle: Math.abs(box.width - box.height) / Math.max(box.width, box.height) < 0.16 }
  }
  if (corners.length >= 3 && corners.length <= 8) return { type: 'polygon', points: corners }
  return undefined
}

function createLibraryShapeNode(shapeId: string, box: Box, base?: SVGElement, objectId: string = crypto.randomUUID()): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('data-object-id', objectId)
  group.setAttribute('data-shape-key', shapeId)
  group.setAttribute('pointer-events', 'all')
  group.setAttribute('transform', shapeTransform(box))
  if (base) {
    for (const attribute of ['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill']) {
      const value = base.getAttribute(attribute)
      if (value !== null) group.setAttribute(attribute, value)
    }
  }
  shapeById(shapeId).paths.forEach(item => {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', item.d)
    if (item.fill) path.setAttribute('fill', item.fill)
    group.append(path)
  })
  return group
}

function replacePathWithRecognition(path: SVGElement, recognition: SketchRecognition) {
  const common = ['data-object-id', 'pointer-events', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill']
  const tag = recognition.type === 'line' ? 'line' : recognition.type === 'ellipse' ? recognition.circle ? 'circle' : 'ellipse' : recognition.type === 'polygon' ? 'polygon' : 'rect'
  const replacement = document.createElementNS(SVG_NS, tag)
  common.forEach(name => {
    const value = path.getAttribute(name)
    if (value !== null) replacement.setAttribute(name, value)
  })
  if (recognition.type === 'line') {
    replacement.setAttribute('x1', rounded(recognition.start.x)); replacement.setAttribute('y1', rounded(recognition.start.y))
    replacement.setAttribute('x2', rounded(recognition.end.x)); replacement.setAttribute('y2', rounded(recognition.end.y))
  } else if (recognition.type === 'ellipse') {
    const { x, y, width, height } = recognition.box
    if (recognition.circle) {
      replacement.setAttribute('cx', rounded(x + width / 2)); replacement.setAttribute('cy', rounded(y + height / 2))
      replacement.setAttribute('r', rounded(Math.max(width, height) / 2))
    } else {
      replacement.setAttribute('cx', rounded(x + width / 2)); replacement.setAttribute('cy', rounded(y + height / 2))
      replacement.setAttribute('rx', rounded(width / 2)); replacement.setAttribute('ry', rounded(height / 2))
    }
  } else if (recognition.type === 'rect') {
    Object.entries(recognition.box).forEach(([name, value]) => replacement.setAttribute(name, rounded(value)))
  } else {
    replacement.setAttribute('points', recognition.points.map(point => `${rounded(point.x)},${rounded(point.y)}`).join(' '))
  }
  path.replaceWith(replacement)
  return replacement
}

function rounded(value: number): string {
  return `${Number(value.toFixed(2))}`
}

function moveElementBy(element: SVGElement, deltaX: number, deltaY: number) {
  ;(SVG(element) as any).dmove(deltaX, deltaY)
  for (const name of ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy']) {
    const value = element.getAttribute(name)
    if (value !== null && Number.isFinite(Number(value))) element.setAttribute(name, rounded(Number(value)))
  }
  const transform = element.getAttribute('transform')
  if (transform) element.setAttribute('transform', transform.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, value => rounded(Number(value))))
}

function boxDraft(box: Box): GeometryDraft {
  return { x: rounded(box.x), y: rounded(box.y), width: rounded(box.width), height: rounded(box.height) }
}

function snapshotContent(stage: Drawing): string {
  const copy = stage.node.cloneNode(true) as SVGSVGElement
  copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
  return copy.innerHTML
}

function getBox(element: SVGElement): Box | undefined {
  try {
    const bounds = (element as SVGGraphicsElement).getBBox()
    const owner = element.ownerSVGElement
    const elementMatrix = (element as SVGGraphicsElement).getScreenCTM()
    const ownerMatrix = owner?.getScreenCTM()
    if (elementMatrix && ownerMatrix) {
      const matrix = ownerMatrix.inverse().multiply(elementMatrix)
      const corners = [
        new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix),
        new DOMPoint(bounds.x + bounds.width, bounds.y).matrixTransform(matrix),
        new DOMPoint(bounds.x, bounds.y + bounds.height).matrixTransform(matrix),
        new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix),
      ]
      const x = Math.min(...corners.map(point => point.x))
      const y = Math.min(...corners.map(point => point.y))
      const right = Math.max(...corners.map(point => point.x))
      const bottom = Math.max(...corners.map(point => point.y))
      return { x, y, width: right - x, height: bottom - y }
    }
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
    element.setAttribute('pointer-events', 'all')
  })
}

function elementsForIds(stage: SVGSVGElement, ids: string[]): SVGElement[] {
  const wanted = new Set(ids)
  return directObjects(stage).filter(element => wanted.has(element.getAttribute('data-object-id') ?? ''))
}

function expandGroupSelection(stage: SVGSVGElement, ids: string[]): string[] {
  const selected = new Set(ids)
  const groups = new Set(elementsForIds(stage, ids).map(element => element.getAttribute('data-group-id')).filter((id): id is string => Boolean(id)))
  directObjects(stage).forEach(element => {
    const id = element.getAttribute('data-object-id')
    const groupId = element.getAttribute('data-group-id')
    if (id && groupId && groups.has(groupId)) selected.add(id)
  })
  return [...selected]
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

function findResizeHandle(target: EventTarget | null): ResizeHandle | undefined {
  const element = target instanceof Element ? target.closest('[data-resize-handle]') : null
  const handle = element?.getAttribute('data-resize-handle')
  return handle && ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(handle) ? handle as ResizeHandle : undefined
}

function setLineEndpoint(line: SVGLineElement, side: 'start' | 'end', point: { x: number; y: number }) {
  line.setAttribute(side === 'start' ? 'x1' : 'x2', rounded(point.x))
  line.setAttribute(side === 'start' ? 'y1' : 'y2', rounded(point.y))
}

function updateConnectors(stage: SVGSVGElement) {
  stage.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target]').forEach(line => {
    const startTarget = line.getAttribute('data-start-target')
    const startAnchor = line.getAttribute('data-start-anchor')
    const endTarget = line.getAttribute('data-end-target')
    const endAnchor = line.getAttribute('data-end-anchor')
    const startShape = startTarget ? elementsForIds(stage, [startTarget])[0] : undefined
    const endShape = endTarget ? elementsForIds(stage, [endTarget])[0] : undefined
    let start = startShape && startAnchor ? anchorPosition(startShape, startAnchor) : undefined
    let end = endShape && endAnchor ? anchorPosition(endShape, endAnchor) : undefined
    const currentStart = start ?? { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) }
    const currentEnd = end ?? { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) }
    const length = Math.hypot(currentEnd.x - currentStart.x, currentEnd.y - currentStart.y)
    if (length > 0) {
      const gap = Math.min(9, length / 3)
      if (start && line.hasAttribute('marker-start')) start = { x: start.x + (currentEnd.x - currentStart.x) * gap / length, y: start.y + (currentEnd.y - currentStart.y) * gap / length }
      if (end && line.hasAttribute('marker-end')) end = { x: end.x - (currentEnd.x - currentStart.x) * gap / length, y: end.y - (currentEnd.y - currentStart.y) * gap / length }
    }
    if (start) setLineEndpoint(line, 'start', start)
    if (end) setLineEndpoint(line, 'end', end)
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
  for (const element of directObjects(stage.node).filter(item => item.tagName.toLowerCase() === 'line')) {
    const id = element.getAttribute('data-object-id')
    if (!id) continue
    const x1 = Number(element.getAttribute('x1'))
    const y1 = Number(element.getAttribute('y1'))
    const x2 = Number(element.getAttribute('x2'))
    const y2 = Number(element.getAttribute('y2'))
    const width = Math.max(14, Number(element.getAttribute('stroke-width')) + 10 || 14)
    layer.line(x1, y1, x2, y2).stroke({ color: '#000', width, linecap: 'round' })
      .attr({ 'data-object-hit': id, 'stroke-opacity': 0, 'pointer-events': 'stroke', cursor: 'pointer' })
  }
  for (const element of elementsForIds(stage.node, ids)) {
    const box = getBox(element)
    if (!box) continue
    layer.rect(Math.max(box.width, 1) + 8, Math.max(box.height, 1) + 8)
      .move(box.x - 4, box.y - 4)
      .fill('none')
      .stroke({ color: '#5d73d8', width: 2, dasharray: '7 4' })
  }
  const selectionBounds = unionBoxes(elementsForIds(stage.node, ids).map(getBox))
  if (selectionBounds && ids.length) {
    const { x, y, width, height } = selectionBounds
    const points: Record<ResizeHandle, [number, number]> = {
      n: [x + width / 2, y - 6], ne: [x + width + 6, y - 6], e: [x + width + 6, y + height / 2], se: [x + width + 6, y + height + 6],
      s: [x + width / 2, y + height + 6], sw: [x - 6, y + height + 6], w: [x - 6, y + height / 2], nw: [x - 6, y - 6],
    }
    for (const [handle, [cx, cy]] of Object.entries(points) as [ResizeHandle, [number, number]][]) {
      const cursor = handle === 'n' || handle === 's' ? 'ns-resize'
        : handle === 'e' || handle === 'w' ? 'ew-resize'
          : handle === 'ne' || handle === 'sw' ? 'nesw-resize' : 'nwse-resize'
      layer.rect(9, 9).center(cx, cy).fill('#fff').stroke({ color: '#5066d2', width: 1.6 })
        .attr({ 'data-resize-handle': handle, 'pointer-events': 'all', cursor })
    }
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
  if (options.dimensions) {
    const { x, y, width, height } = options.dimensions
    const label = `${rounded(width)} × ${rounded(height)} px`
    const labelWidth = Math.max(76, label.length * 6.5 + 16)
    const centerX = x + width / 2
    const centerY = y + height / 2
    layer.rect(labelWidth, 23).radius(5).center(centerX, centerY).fill('#fff').stroke({ color: '#d8deef', width: 1 })
    layer.text(label).font({ family: 'sans-serif', size: 11, weight: 650 }).fill('#53618b').center(centerX, centerY)
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
  const hit = target instanceof Element ? target.closest('[data-object-hit]') : null
  const hitId = hit?.getAttribute('data-object-hit')
  if (hitId) return elementsForIds(stage, [hitId])[0]
  let element = target instanceof SVGElement ? target : undefined
  while (element && element !== stage) {
    if (element.parentNode === stage && OBJECT_TAGS.has(element.tagName.toLowerCase()) && !element.hasAttribute('data-background')) return element
    element = element.parentElement instanceof SVGElement ? element.parentElement : undefined
  }
  return undefined
}

function resizedBounds(start: Box, handle: ResizeHandle, point: { x: number; y: number }, keepSquare = false): Box {
  if (keepSquare) {
    const centerX = start.x + start.width / 2
    const centerY = start.y + start.height / 2
    if (handle.includes('w') || handle.includes('e')) {
      if (handle.includes('n') || handle.includes('s')) {
        const anchorX = handle.includes('w') ? start.x + start.width : start.x
        const anchorY = handle.includes('n') ? start.y + start.height : start.y
        const size = Math.max(.1, Math.max(Math.abs(point.x - anchorX), Math.abs(point.y - anchorY)))
        const x = handle.includes('w') ? anchorX - size : anchorX
        const y = handle.includes('n') ? anchorY - size : anchorY
        return { x, y, width: size, height: size }
      }
      const size = Math.max(.1, handle.includes('w') ? start.x + start.width - point.x : point.x - start.x)
      return { x: handle.includes('w') ? start.x + start.width - size : start.x, y: centerY - size / 2, width: size, height: size }
    }
    const size = Math.max(.1, handle.includes('n') ? start.y + start.height - point.y : point.y - start.y)
    return { x: centerX - size / 2, y: handle.includes('n') ? start.y + start.height - size : start.y, width: size, height: size }
  }
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) left = Math.min(point.x, right - 0.1)
  if (handle.includes('e')) right = Math.max(point.x, left + 0.1)
  if (handle.includes('n')) top = Math.min(point.y, bottom - 0.1)
  if (handle.includes('s')) bottom = Math.max(point.y, top + 0.1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function mappedCoordinate(value: number, start: number, size: number, target: number, nextSize: number): number {
  return target + (size > 0 ? (value - start) * nextSize / size : 0)
}

function resizeElementFromSource(source: SVGElement, target: SVGElement, from: Box, to: Box) {
  const tag = target.tagName.toLowerCase()
  const scaleX = from.width > 0 ? to.width / from.width : 1
  const scaleY = from.height > 0 ? to.height / from.height : 1
  const set = (name: string, value: number) => target.setAttribute(name, rounded(value))
  const sourceNumber = (name: string, fallback = 0) => Number(source.getAttribute(name)) || fallback
  if (tag === 'rect' || tag === 'image' || tag === 'use') {
    set('x', to.x)
    set('y', to.y)
    set('width', to.width)
    set('height', to.height)
    if (source.hasAttribute('rx')) set('rx', sourceNumber('rx') * scaleX)
    if (source.hasAttribute('ry')) set('ry', sourceNumber('ry') * scaleY)
  } else if (tag === 'ellipse') {
    set('cx', to.x + to.width / 2)
    set('cy', to.y + to.height / 2)
    set('rx', to.width / 2)
    set('ry', to.height / 2)
  } else if (tag === 'circle') {
    set('cx', to.x + to.width / 2)
    set('cy', to.y + to.height / 2)
    set('r', Math.min(to.width, to.height) / 2)
  } else if (tag === 'line') {
    for (const axis of ['x', 'y'] as const) {
      const size = axis === 'x' ? from.width : from.height
      const start = axis === 'x' ? from.x : from.y
      const targetStart = axis === 'x' ? to.x : to.y
      const targetSize = axis === 'x' ? to.width : to.height
      for (const side of ['1', '2'] as const) {
        const attribute = `${axis}${side}`
        const fallbackPoint = axis === 'x'
          ? (side === '1' ? to.x : to.x + to.width)
          : (side === '1' ? to.y : to.y + to.height)
        set(attribute, size > 0
          ? mappedCoordinate(sourceNumber(attribute), start, size, targetStart, targetSize)
          : fallbackPoint)
      }
    }
  } else if (tag === 'polygon' || tag === 'polyline') {
    const values = (source.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
    const points: string[] = []
    for (let index = 0; index + 1 < values.length; index += 2) {
      points.push(`${rounded(mappedCoordinate(values[index], from.x, from.width, to.x, to.width))},${rounded(mappedCoordinate(values[index + 1], from.y, from.height, to.y, to.height))}`)
    }
    target.setAttribute('points', points.join(' '))
  } else if (tag === 'text') {
    set('x', mappedCoordinate(sourceNumber('x', from.x), from.x, from.width, to.x, to.width))
    set('y', mappedCoordinate(sourceNumber('y', from.y), from.y, from.height, to.y, to.height))
    set('font-size', sourceNumber('font-size', 24) * Math.sqrt(Math.max(.0001, scaleX * scaleY)))
  } else if (tag === 'g' && source.hasAttribute('data-shape-key')) {
    target.setAttribute('transform', shapeTransform(to))
  } else {
    const tx = to.x - from.x * scaleX
    const ty = to.y - from.y * scaleY
    const oldTransform = source.getAttribute('transform')
    target.setAttribute('transform', `matrix(${rounded(scaleX)} 0 0 ${rounded(scaleY)} ${rounded(tx)} ${rounded(ty)})${oldTransform ? ` ${oldTransform}` : ''}`)
  }
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
  const moveSelectionAction = useRef<(deltaX: number, deltaY: number) => void>(() => {})
  const groupAction = useRef<() => void>(() => {})
  const ungroupAction = useRef<() => void>(() => {})
  const clipboard = useRef<SVGElement[]>([])
  const toolRef = useRef<Tool>('select')
  const shapeIdRef = useRef('flow-process')
  const smartShapeIdRef = useRef('auto')
  const smartDrawingRef = useRef(true)
  const strokeColorRef = useRef('#596fd8')
  const fillColorRef = useRef('#dfe4ff')
  const fillEnabledRef = useRef(true)
  const strokeWidthRef = useRef(3)
  const fontSizeRef = useRef(24)
  const polygonSidesRef = useRef(6)
  const arrowModeRef = useRef<ArrowMode>('end')
  const [tool, setTool] = useState<Tool>('select')
  const [shapeId, setShapeId] = useState('flow-process')
  const [smartShapeId, setSmartShapeId] = useState('auto')
  const [smartDrawing, setSmartDrawing] = useState(true)
  const [strokeColor, setStrokeColor] = useState('#596fd8')
  const [fillColor, setFillColor] = useState('#dfe4ff')
  const [fillEnabled, setFillEnabled] = useState(true)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(24)
  const [polygonSides, setPolygonSides] = useState(6)
  const [arrowMode, setArrowMode] = useState<ArrowMode>('end')
  const [fitToContent, setFitToContent] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionBounds, setSelectionBounds] = useState<Box | null>(null)
  const [geometryDraft, setGeometryDraft] = useState<GeometryDraft | null>(null)
  const [hasSelectedGroup, setHasSelectedGroup] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasClipboard, setHasClipboard] = useState(false)

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { shapeIdRef.current = shapeId }, [shapeId])
  useEffect(() => { smartShapeIdRef.current = smartShapeId }, [smartShapeId])
  useEffect(() => { smartDrawingRef.current = smartDrawing }, [smartDrawing])
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
    const stage = drawing.current
    const unique = [...new Set(stage ? expandGroupSelection(stage.node, ids) : ids)]
    selectedIdsRef.current = unique
    setSelectedIds(unique)
    if (stage) {
      setHasSelectedGroup(elementsForIds(stage.node, unique).some(element => element.hasAttribute('data-group-id')))
      const bounds = unionBoxes(elementsForIds(stage.node, unique).map(getBox))
      setSelectionBounds(bounds ?? null)
      setGeometryDraft(bounds ? boxDraft(bounds) : null)
      renderOverlay(stage, unique)
    } else {
      setHasSelectedGroup(false)
      setSelectionBounds(null)
      setGeometryDraft(null)
    }
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
        x: Number(Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) * WIDTH / bounds.width)).toFixed(1)),
        y: Number(Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) * HEIGHT / bounds.height)).toFixed(1)),
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
          created.attr({ 'data-object-id': id, 'pointer-events': 'all' })
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
          const addMarker = (side: 'start' | 'end') => element.marker(side, 14, 14, (marker: any) => {
            marker.attr({ refX: 14, refY: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' })
            marker.path('M 0 0 L 14 7 L 0 14 z').fill(color)
          })
          if (arrowModeRef.current === 'start' || arrowModeRef.current === 'both') addMarker('start')
          if (arrowModeRef.current === 'end' || arrowModeRef.current === 'both') addMarker('end')
        }
      } else if (currentTool === 'polygon') {
        element = stage.polygon(`${location.x},${location.y} ${location.x},${location.y} ${location.x},${location.y}`)
      } else if (currentTool === 'shape') {
        const definition = shapeById(shapeIdRef.current)
        element = stage.group()
        definition.paths.forEach(item => {
          const child = element.path(item.d)
          if (item.fill) child.attr('fill', item.fill)
        })
        element.attr({ 'data-shape-key': definition.id, transform: shapeTransform({ x: location.x, y: location.y, width: 0.1, height: 0.1 }) })
      } else if (currentTool === 'freehand') {
        element = stage.path(`M ${rounded(location.x)} ${rounded(location.y)} l 0.1 0`)
      }
      if (!element) return
      element.stroke({ color, width: size, linecap: 'round', linejoin: 'round' })
      element.fill(fillEnabledRef.current && !['line', 'arrow', 'freehand'].includes(currentTool) ? fillColorRef.current : 'none')
      const id = crypto.randomUUID()
      element.attr({ 'data-object-id': id, 'pointer-events': 'all' })
      select([id])
      return { element, id }
    }

    const start = (event: PointerEvent) => {
      const currentTool = toolRef.current
      const clickedObject = findObjectTarget(stage.node, event.target)
      const allowTextDoubleClick = currentTool === 'select'
        && event.pointerType === 'mouse'
        && clickedObject?.tagName.toLowerCase() === 'text'
      if (!allowTextDoubleClick) event.preventDefault()
      stage.node.focus({ preventScroll: true })
      const location = point(event)
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
          if (currentTool === 'freehand') {
            interaction.current = { type: 'freehand', element: created.element, id: created.id, points: [startPoint], keepTool: event.ctrlKey }
          } else {
            if (anchor && anchorPoint) created.element.attr({ 'data-start-target': anchor.id, 'data-start-anchor': anchor.anchor })
            interaction.current = { type: 'draw', tool: currentTool, element: created.element, id: created.id, x: startPoint.x, y: startPoint.y, keepTool: event.ctrlKey, startTarget: anchor?.id, startAnchor: anchor?.anchor }
          }
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

      const resizeHandle = findResizeHandle(event.target)
      if (resizeHandle && selectedIdsRef.current.length) {
        const ids = selectedIdsRef.current
        const elements = elementsForIds(stage.node, ids)
        const startBounds = unionBoxes(elements.map(getBox))
        if (!startBounds) return
        interaction.current = {
          type: 'resize',
          ids,
          startBounds,
          handle: resizeHandle,
          moved: false,
          targets: elements.map(element => ({ element, source: element.cloneNode(true) as SVGElement, box: getBox(element) }))
            .filter((item): item is { element: SVGElement; source: SVGElement; box: Box } => Boolean(item.box)),
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
        const groupedIds = expandGroupSelection(stage.node, [id])
        const removeGroup = groupedIds.every(groupId => ids.includes(groupId))
        ids = removeGroup ? ids.filter(item => !groupedIds.includes(item)) : [...new Set([...ids, ...groupedIds])]
        select(ids)
        if (removeGroup) return
      } else if (!ids.includes(id)) {
        ids = expandGroupSelection(stage.node, [id])
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
      if (current.type === 'freehand') {
        current.keepTool = current.keepTool || event.ctrlKey
        const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
        samples.forEach(sample => {
          const samplePoint = point(sample)
          const last = current.points.at(-1)!
          if (Math.hypot(samplePoint.x - last.x, samplePoint.y - last.y) >= 1.2 && current.points.length < 1600) current.points.push(samplePoint)
        })
        current.element.attr('d', smoothStroke(current.points))
        const bounds = pointsBounds(current.points)
        renderOverlay(stage, [current.id], { dimensions: bounds })
      } else if (current.type === 'draw') {
        current.keepTool = current.keepTool || event.ctrlKey
        const x = Math.min(current.x, location.x)
        const y = Math.min(current.y, location.y)
        const width = Math.max(0.1, Math.abs(location.x - current.x))
        const height = Math.max(0.1, Math.abs(location.y - current.y))
        if (current.tool === 'rect' || current.tool === 'roundRect') current.element.attr({ x: rounded(x), y: rounded(y), width: rounded(width), height: rounded(height) })
        else if (current.tool === 'ellipse') current.element.attr({ cx: rounded(x + width / 2), cy: rounded(y + height / 2), rx: rounded(width / 2), ry: rounded(height / 2) })
        else if (current.tool === 'shape') current.element.attr('transform', shapeTransform({ x, y, width, height }))
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
            return `${rounded(cx + Math.cos(angle) * width / 2)},${rounded(cy + Math.sin(angle) * height / 2)}`
          }).join(' ')
          current.element.plot(points)
        }
        updateConnectors(stage.node)
        renderOverlay(stage, [current.id], { dimensions: { x, y, width, height } })
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
      } else if (current.type === 'resize') {
        const keepSquare = current.targets.length === 1 && current.targets[0].element.tagName.toLowerCase() === 'circle'
        const bounds = resizedBounds(current.startBounds, current.handle, location, keepSquare)
        current.moved = current.moved || Math.abs(bounds.width - current.startBounds.width) + Math.abs(bounds.height - current.startBounds.height) + Math.abs(bounds.x - current.startBounds.x) + Math.abs(bounds.y - current.startBounds.y) > .1
        const scaleX = current.startBounds.width > 0 ? bounds.width / current.startBounds.width : 1
        const scaleY = current.startBounds.height > 0 ? bounds.height / current.startBounds.height : 1
        current.targets.forEach(({ element, source, box }) => resizeElementFromSource(source, element, box, {
          x: bounds.x + (box.x - current.startBounds.x) * scaleX,
          y: bounds.y + (box.y - current.startBounds.y) * scaleY,
          width: current.startBounds.width === 0 ? bounds.width : box.width * scaleX,
          height: current.startBounds.height === 0 ? bounds.height : box.height * scaleY,
        }))
        updateConnectors(stage.node)
        renderOverlay(stage, current.ids)
      } else if (current.type === 'move') {
        const rawX = location.x - current.startX
        const rawY = location.y - current.startY
        const xBounds = { ...current.bounds, x: current.bounds.x + rawX }
        const yBounds = { ...current.bounds, y: current.bounds.y + rawY }
        const snapX = getSnap(xBounds, current.others, 'x')
        const snapY = getSnap(yBounds, current.others, 'y')
        const totalX = Number((rawX + (snapX?.delta ?? 0)).toFixed(1))
        const totalY = Number((rawY + (snapY?.delta ?? 0)).toFixed(1))
        const deltaX = totalX - current.lastX
        const deltaY = totalY - current.lastY
        if (Math.abs(deltaX) + Math.abs(deltaY) > 0.1) current.moved = true
        current.elements.forEach(element => moveElementBy(element, deltaX, deltaY))
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
      if (current.type === 'freehand') {
        current.keepTool = current.keepTool || event.ctrlKey
        const location = point(event)
        const last = current.points.at(-1)!
        if (Math.hypot(location.x - last.x, location.y - last.y) >= 0.5 && current.points.length < 1600) current.points.push(location)
        current.element.attr('d', smoothStroke(current.points))
        const bounds = pointsBounds(current.points)
        if (smartDrawingRef.current) {
          if (smartShapeIdRef.current !== 'auto') {
            const replacement = createLibraryShapeNode(smartShapeIdRef.current, bounds, current.element.node, current.id)
            replacement.setAttribute('fill', fillEnabledRef.current ? fillColorRef.current : 'none')
            current.element.node.replaceWith(replacement)
          } else {
            const recognition = recognizeSketch(current.points)
            if (recognition) {
              const replacement = replacePathWithRecognition(current.element.node, recognition)
              replacement.setAttribute('fill', recognition.type !== 'line' && fillEnabledRef.current ? fillColorRef.current : 'none')
            }
          }
        }
        updateConnectors(stage.node)
        recordHistory(stage)
        select([current.id])
        if (!current.keepTool) chooseTool('select')
      } else if (current.type === 'draw') {
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
        select([current.id])
        if (!current.keepTool) chooseTool('select')
      } else if (current.type === 'connect') {
        stage.node.removeAttribute('data-connector-dragging')
        if (current.moved) recordHistory(stage)
        renderOverlay(stage, [current.id])
      } else if (current.type === 'resize') {
        if (current.moved) recordHistory(stage)
        select(current.ids)
      } else if (current.type === 'move') {
        if (current.moved) recordHistory(stage)
        select(current.ids)
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
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedIdsRef.current.length) {
        event.preventDefault()
        const step = event.altKey ? .1 : event.shiftKey ? 10 : 1
        moveSelectionAction.current(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIdsRef.current.length) {
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
      if (key === 'g' && !editingText && selectedIdsRef.current.length) {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) ungroupAction.current()
        else groupAction.current()
        return
      }
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
        ?? findObjectTarget(stage.node, document.elementFromPoint(event.clientX, event.clientY))
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
    select([])
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
    select([])
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
    const groupIdMap = new Map<string, string>()
    const cloned = clipboard.current.map(element => {
      const copy = element.cloneNode(true) as SVGElement
      const id = crypto.randomUUID()
      const originalId = element.getAttribute('data-object-id')
      if (originalId) idMap.set(originalId, id)
      copy.setAttribute('data-object-id', id)
      const groupId = element.getAttribute('data-group-id')
      if (groupId) {
        if (!groupIdMap.has(groupId)) groupIdMap.set(groupId, crypto.randomUUID())
        copy.setAttribute('data-group-id', groupIdMap.get(groupId)!)
      }
      stage.node.append(copy)
      moveElementBy(copy, 20, 20)
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
    select(copies)
    recordHistory(stage)
    renderOverlay(stage, copies)
    stage.node.focus({ preventScroll: true })
  }

  function duplicateSelected() {
    copySelected()
    pasteCopied()
  }

  function groupSelected() {
    const stage = drawing.current
    if (!stage || selectedIdsRef.current.length < 2) return
    const groupId = crypto.randomUUID()
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.setAttribute('data-group-id', groupId))
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function ungroupSelected() {
    const stage = drawing.current
    if (!stage || !selectedIdsRef.current.length) return
    const groups = new Set(elementsForIds(stage.node, selectedIdsRef.current).map(element => element.getAttribute('data-group-id')).filter((id): id is string => Boolean(id)))
    if (!groups.size) return
    directObjects(stage.node).filter(element => groups.has(element.getAttribute('data-group-id') ?? '')).forEach(element => element.removeAttribute('data-group-id'))
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function deleteSelected() {
    const stage = drawing.current
    if (!stage || !selectedIdsRef.current.length) return
    detachConnectors(stage.node, selectedIdsRef.current)
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.remove())
    select([])
    recordHistory(stage)
    renderOverlay(stage, [])
    stage.node.focus({ preventScroll: true })
  }

  function moveSelectionBy(deltaX: number, deltaY: number) {
    const stage = drawing.current
    const ids = selectedIdsRef.current
    if (!stage || !ids.length) return
    elementsForIds(stage.node, ids).forEach(element => moveElementBy(element, deltaX, deltaY))
    updateConnectors(stage.node)
    select(ids)
    recordHistory(stage)
  }

  useEffect(() => {
    undoAction.current = undo
    redoAction.current = redo
    duplicateAction.current = duplicateSelected
    copyAction.current = copySelected
    pasteAction.current = pasteCopied
    moveSelectionAction.current = moveSelectionBy
    groupAction.current = groupSelected
    ungroupAction.current = ungroupSelected
  })

  function applyGeometry(next: Box) {
    const stage = drawing.current
    const ids = selectedIdsRef.current
    if (!stage || !ids.length) return
    const selectedElements = elementsForIds(stage.node, ids)
    if (selectedElements.length === 1 && selectedElements[0].tagName.toLowerCase() === 'circle') {
      const size = Math.max(next.width, next.height)
      next = { ...next, width: size, height: size }
    }
    const from = unionBoxes(selectedElements.map(getBox))
    if (!from) return
    const targets = elementsForIds(stage.node, ids).map(element => ({ element, source: element.cloneNode(true) as SVGElement, box: getBox(element) })).filter((item): item is { element: SVGElement; source: SVGElement; box: Box } => Boolean(item.box))
    targets.forEach(({ element, source, box }) => {
      const targetBox = {
        x: next.x + (box.x - from.x) * (from.width > 0 ? next.width / from.width : 1),
        y: next.y + (box.y - from.y) * (from.height > 0 ? next.height / from.height : 1),
        width: from.width === 0 ? next.width : box.width * next.width / from.width,
        height: from.height === 0 ? next.height : box.height * next.height / from.height,
      }
      resizeElementFromSource(source, element, box, targetBox)
    })
    updateConnectors(stage.node)
    select(ids)
    recordHistory(stage)
  }

  function applyGeometryDraft() {
    if (!selectionBounds || !geometryDraft) return
    const value = (input: string, fallback: number) => Number.isFinite(Number(input)) ? Number(input) : fallback
    const stage = drawing.current
    const selectedElements = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    let width = Math.max(0.1, value(geometryDraft.width, selectionBounds.width))
    let height = Math.max(0.1, value(geometryDraft.height, selectionBounds.height))
    if (selectedElements.length === 1 && selectedElements[0].tagName.toLowerCase() === 'circle') {
      const widthChanged = Math.abs(width - selectionBounds.width) > .01
      const heightChanged = Math.abs(height - selectionBounds.height) > .01
      if (widthChanged && !heightChanged) height = width
      else if (heightChanged && !widthChanged) width = height
      else width = height = Math.max(width, height)
    }
    applyGeometry({
      x: value(geometryDraft.x, selectionBounds.x),
      y: value(geometryDraft.y, selectionBounds.y),
      width,
      height,
    })
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
    { id: 'shape', label: 'Kształty biblioteczne', icon: Shapes },
    { id: 'freehand', label: 'Pędzel odręczny', icon: Pencil },
    { id: 'text', label: 'Tekst na planszy', icon: Type },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="drawing-modal advanced-drawing-modal" role="dialog" aria-modal="true" aria-labelledby="drawing-title">
        <header className="modal-heading">
          <div><p className="eyebrow">EDYTOR SVG</p><h2 id="drawing-title">{asset ? 'Edytuj schemat' : 'Nowy schemat'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={19} /></button>
        </header>
        <div className="vector-editor-controls">
          <div className="drawing-toolbar-row drawing-toolbar-tools">
            <div className="drawing-tool-group" role="group" aria-label="Narzędzia rysowania">
              {tools.map(item => {
                const Icon = item.icon
                return <button key={item.id} className={`tool-button ${tool === item.id ? 'selected' : ''}`} onClick={() => chooseTool(item.id)} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}><Icon size={17} /></button>
              })}
            </div>
            <span className="toolbar-divider" />
            <div className="drawing-selection-actions" role="group" aria-label="Operacje na zaznaczeniu">
              <span className="selection-count">{selectedIds.length ? `${selectedIds.length} zazn.` : 'Brak zaznaczenia'}</span>
              <button className="tool-button" onClick={groupSelected} disabled={selectedIds.length < 2} title="Grupuj (Ctrl+G)" aria-label="Grupuj figury"><Group size={16} /></button>
              <button className="tool-button" onClick={ungroupSelected} disabled={!hasSelectedGroup} title="Rozgrupuj (Ctrl+Shift+G)" aria-label="Rozgrupuj figury"><Ungroup size={16} /></button>
              <button className="tool-button" onClick={copySelected} disabled={!selectedIds.length} title="Kopiuj zaznaczenie (Ctrl+C)" aria-label="Kopiuj zaznaczenie"><ClipboardCopy size={16} /></button>
              <button className="tool-button" onClick={pasteCopied} disabled={!hasClipboard} title="Wklej zaznaczenie (Ctrl+V)" aria-label="Wklej zaznaczenie"><ClipboardPaste size={16} /></button>
              <button className="tool-button" onClick={duplicateSelected} disabled={!selectedIds.length} title="Duplikuj zaznaczenie (Ctrl+D)" aria-label="Duplikuj zaznaczenie"><Copy size={16} /></button>
              <button className="tool-button delete-tool" onClick={deleteSelected} disabled={!selectedIds.length} title="Usuń zaznaczenie (Delete)" aria-label="Usuń zaznaczenie"><Trash2 size={16} /></button>
              <button className="tool-button" onClick={undo} disabled={!canUndo} title="Cofnij (Ctrl+Z)" aria-label="Cofnij"><Undo2 size={17} /></button>
              <button className="tool-button" onClick={redo} disabled={!canRedo} title="Ponów (Ctrl+Y)" aria-label="Ponów"><Redo2 size={17} /></button>
            </div>
          </div>
          <div className="drawing-toolbar-row drawing-toolbar-properties">
            {tool === 'shape' && <label className="drawing-select-control shape-picker"><span>Kształt</span><select value={shapeId} onChange={event => setShapeId(event.target.value)} aria-label="Wybierz kształt z biblioteki">{shapeCategories.map(category => <optgroup key={category} label={category}>{shapeLibrary.filter(shape => shape.category === category).map(shape => <option key={shape.id} value={shape.id}>{shape.label}</option>)}</optgroup>)}</select></label>}
            {tool === 'freehand' && <>
              <label className="fill-toggle smart-drawing-toggle"><input type="checkbox" checked={smartDrawing} onChange={event => setSmartDrawing(event.target.checked)} aria-label="Włącz inteligentną korektę rysunku" />Inteligentny rysunek</label>
              <label className="drawing-select-control shape-picker"><span>Koryguj do</span><select value={smartShapeId} disabled={!smartDrawing} onChange={event => setSmartShapeId(event.target.value)} aria-label="Figura do inteligentnej korekty"><option value="auto">Automatycznie rozpoznaj</option>{shapeCategories.map(category => <optgroup key={category} label={category}>{shapeLibrary.filter(shape => shape.category === category).map(shape => <option key={shape.id} value={shape.id}>{shape.label}</option>)}</optgroup>)}</select></label>
            </>}
            {(tool === 'arrow' || tool === 'polygon') && <label className="drawing-select-control"><span>{tool === 'arrow' ? 'Strzałka' : 'Wielokąt'}</span>{tool === 'arrow'
              ? <select value={arrowMode} onChange={event => setArrowMode(event.target.value as ArrowMode)} aria-label="Rodzaj strzałki"><option value="end">Grot na końcu</option><option value="start">Grot na początku</option><option value="both">Groty po obu stronach</option><option value="none">Bez grotu</option></select>
              : <select value={polygonSides} onChange={event => setPolygonSides(Number(event.target.value))} aria-label="Typ wielokąta"><option value="3">Trójkąt</option><option value="4">Romb</option><option value="5">Pięciokąt</option><option value="6">Sześciokąt</option><option value="8">Ośmiokąt</option></select>}</label>}
            <div className="drawing-style-controls" role="group" aria-label="Styl figury">
              <label className="color-control" title="Kolor konturu"><input type="color" value={strokeColor} onChange={event => applyStrokeColor(event.target.value)} aria-label="Kolor konturu" /><span>Kontur</span></label>
              <label className={`color-control ${!fillEnabled ? 'option-disabled' : ''}`} title="Kolor wypełnienia"><input type="color" value={fillColor} onChange={event => applyFillColor(event.target.value)} aria-label="Kolor wypełnienia" disabled={!fillEnabled} /><span>Wypełnienie</span></label>
              <label className="fill-toggle"><input type="checkbox" checked={fillEnabled} onChange={event => applyFillEnabled(event.target.checked)} aria-label="Włącz wypełnienie" />Wypełnij</label>
              <label className="line-width-control" title="Grubość konturu i pędzla"><span>{tool === 'freehand' ? 'Pędzel' : 'Linia'}</span><input type="range" min="0.5" max="24" step="0.25" value={strokeWidth} onChange={event => applyStrokeWidth(Number(event.target.value))} aria-label={tool === 'freehand' ? 'Grubość pędzla' : 'Grubość konturu'} /><output>{rounded(strokeWidth)}</output></label>
              <label className="font-size-control" title="Rozmiar tekstu"><Type size={14} /><input type="number" min="8" max="160" step="0.5" value={fontSize} onChange={event => applyFontSize(Number(event.target.value))} aria-label="Rozmiar tekstu" /></label>
            </div>
            <div className="drawing-geometry-controls" role="group" aria-label="Pozycja i rozmiar zaznaczenia">
              {([['x', 'X'], ['y', 'Y'], ['width', 'Szerokość'], ['height', 'Wysokość']] as const).map(([key, label]) => <label className="geometry-control" key={key}>
                <span>{label}</span>
                <input type="number" step="0.1" value={geometryDraft?.[key] ?? ''} disabled={!selectedIds.length} onChange={event => setGeometryDraft(current => current ? { ...current, [key]: event.target.value } : current)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyGeometryDraft() } }} aria-label={label === 'X' || label === 'Y' ? `Pozycja ${label}` : label} />
              </label>)}
              <button className="button secondary geometry-apply-button" onClick={applyGeometryDraft} disabled={!selectedIds.length} title="Zastosuj dokładną pozycję i rozmiar"><Check size={14} />Ustaw</button>
            </div>
            <label className="fill-toggle fit-content-toggle" title="Dopasuj rozmiar SVG do rysunku"><input type="checkbox" checked={fitToContent} onChange={event => setFitToContent(event.target.checked)} aria-label="Dopasuj obszar SVG do treści" />Przytnij SVG</label>
          </div>
        </div>
        <div className="drawing-stage-wrap"><div ref={mount} className="drawing-stage" /></div>
        <footer className="modal-footer advanced-modal-footer"><p>Biblioteka zawiera 40 symboli. Pędzel tworzy edytowalne ścieżki; inteligentna korekta prostuje szkice lub dopasowuje je do dowolnego symbolu z biblioteki. Przeciągnij pusty obszar, aby zaznaczać · Ctrl+G grupuje · Ctrl+Shift+G rozgrupowuje</p><div><button className="button secondary" onClick={onClose}>Anuluj</button><button className="button primary" onClick={save}>Zapisz grafikę</button></div></footer>
      </section>
    </div>
  )
}
