import { useEffect, useRef, useState } from 'react'
import {
  AlignCenterHorizontal, AlignEndHorizontal, AlignStartHorizontal, ArrowDownWideNarrow, ArrowRight, Check, Circle,
  ClipboardCopy, ClipboardPaste, Copy, Download, Eye, EyeOff, Grid3X3, Group, History, ImagePlus, Layers,
  Lock, MessageSquare, Minus, MousePointer2, Palette, Pencil, Pipette, Plus, RectangleHorizontal,
  RectangleVertical, Redo2, RotateCw, Ruler, Shapes, Trash2, Triangle, Type, Undo2, Ungroup, Unlock, Waypoints, X,
} from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'
import { shapeById, shapeCategories, shapeLibrary } from './shapeLibrary'

type Tool = 'select' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'shape' | 'freehand' | 'text' | 'pen'
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
  | { type: 'pen-node'; element: SVGPathElement; index: number; handle: 'anchor' | 'incoming' | 'outgoing'; points: PenNode[]; moved: boolean }
  | { type: 'marquee'; x: number; y: number; additive: boolean; initialIds: string[]; moved: boolean }

type OverlayOptions = {
  marquee?: Box
  dimensions?: Box
  snapX?: number
  snapY?: number
  movingBounds?: Box
  otherBounds?: Box[]
}

type EditorComment = { id: string; x: number; y: number; text: string }
type Checkpoint = { id: string; label: string; createdAt: number; content: string }
type MiniObject = { id: string; box: Box; color: string }
type EditorPanel = 'canvas' | 'style' | 'layers' | 'workflow'
type EditorGuide = { axis: 'x' | 'y'; value: number }
type EditorViewOptions = { grid: boolean; gridSize: number; snap: boolean; rulers: boolean; guides: EditorGuide[] }

type TextEdit = { input: HTMLInputElement; x: number; y: number; element?: SVGElement; fontSize: number; keepTool: boolean }
type Drawing = Svg
type PenNode = Point & { incoming?: Point; outgoing?: Point }
type ActivePen = { id: string; element: SVGPathElement; points: PenNode[] }

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

function readPenPoints(element: SVGElement): PenNode[] {
  try {
    const points = JSON.parse(element.getAttribute('data-pen-points') ?? '[]') as PenNode[]
    return points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  } catch { return [] }
}

function penPath(points: PenNode[]): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${rounded(points[0].x)} ${rounded(points[0].y)} l 0.1 0`
  let path = `M ${rounded(points[0].x)} ${rounded(points[0].y)}`
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const control1 = start.outgoing ?? { x: start.x + (end.x - previous.x) / 6, y: start.y + (end.y - previous.y) / 6 }
    const control2 = end.incoming ?? { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 }
    path += ` C ${rounded(control1.x)} ${rounded(control1.y)} ${rounded(control2.x)} ${rounded(control2.y)} ${rounded(end.x)} ${rounded(end.y)}`
  }
  return path
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
  | { type: 'shape'; shapeId: string; box: Box }

type LibraryComponent = { points: Point[]; length: number; closed: boolean }
type LibraryTemplate = { id: string; bounds: Box; components: LibraryComponent[] }

const cachedLibraryTemplates = new Map<string, LibraryTemplate>()

function splitPathComponents(pathData: string): string[] {
  const starts = [...pathData.matchAll(/[Mm](?=\s|[-+.\d])/g)].map(match => match.index ?? 0)
  if (starts.length <= 1) return [pathData]
  return starts.map((start, index) => pathData.slice(start, starts[index + 1]))
}

function samplePathComponent(pathData: string): LibraryComponent | undefined {
  try {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', pathData)
    const length = path.getTotalLength()
    if (!Number.isFinite(length) || length < 1) return undefined
    const count = Math.max(16, Math.min(180, Math.ceil(length / 2)))
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const point = path.getPointAtLength(length * index / count)
      return { x: point.x, y: point.y }
    })
    const bounds = pointsBounds(points)
    const diagonal = Math.hypot(bounds.width, bounds.height)
    const closed = Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) <= Math.max(2, diagonal * 0.045)
    return { points, length, closed }
  } catch {
    return undefined
  }
}

function libraryTemplate(shapeId: string): LibraryTemplate | undefined {
  const cached = cachedLibraryTemplates.get(shapeId)
  if (cached) return cached
  const shape = shapeLibrary.find(item => item.id === shapeId)
  if (!shape) return undefined
  const components = shape.paths.flatMap(item => splitPathComponents(item.d))
    .map(samplePathComponent)
    .filter((component): component is LibraryComponent => Boolean(component))
  if (!components.length) return undefined
  const template = { id: shape.id, bounds: pointsBounds(components.flatMap(component => component.points)), components }
  cachedLibraryTemplates.set(shapeId, template)
  return template
}

function libraryTemplates(): LibraryTemplate[] {
  return shapeLibrary.map(shape => libraryTemplate(shape.id)).filter((template): template is LibraryTemplate => Boolean(template))
}

function normalizePoints(points: Point[], bounds: Box): Point[] {
  return points.map(point => ({
    x: (point.x - bounds.x) * 100 / Math.max(bounds.width, 0.1),
    y: (point.y - bounds.y) * 100 / Math.max(bounds.height, 0.1),
  }))
}

function resamplePolyline(points: Point[], count: number, close: boolean): Point[] {
  const stroke = points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.35)
  if (stroke.length < 2) return stroke
  if (close && Math.hypot(stroke[0].x - stroke.at(-1)!.x, stroke[0].y - stroke.at(-1)!.y) > 0.1) stroke.push(stroke[0])
  const lengths = [0]
  for (let index = 1; index < stroke.length; index++) lengths.push(lengths[index - 1] + Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y))
  const total = lengths.at(-1) ?? 0
  if (total < 0.1) return stroke
  const result: Point[] = []
  let segment = 1
  for (let index = 0; index < count; index++) {
    const target = total * index / (count - 1)
    while (segment < lengths.length - 1 && lengths[segment] < target) segment++
    const startLength = lengths[segment - 1]
    const segmentLength = lengths[segment] - startLength || 1
    const ratio = (target - startLength) / segmentLength
    const start = stroke[segment - 1]
    const end = stroke[segment]
    result.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio })
  }
  return result
}

function trimmedNearestMean(source: Point[], target: Point[]): number {
  if (!source.length || !target.length) return Infinity
  const distances = source.map(point => {
    let nearest = Infinity
    for (const candidate of target) nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y))
    return nearest
  }).sort((a, b) => a - b)
  const retained = Math.max(1, Math.ceil(distances.length * 0.88))
  return distances.slice(0, retained).reduce((sum, distance) => sum + distance, 0) / retained
}

function matchLibraryShape(points: Point[], bounds: Box, closed: boolean): { shapeId: string; score: number } | undefined {
  const stroke = resamplePolyline(normalizePoints(points, bounds), 128, closed)
  let best: { shapeId: string; score: number } | undefined
  for (const template of libraryTemplates()) {
    const components = template.components.map(component => ({
      ...component,
      points: normalizePoints(component.points, template.bounds),
    }))
    const matchingContours = components.filter(component => component.closed === closed)
    const variants: { points: Point[]; penalty: number }[] = []
    if (closed) {
      const contour = matchingContours.sort((a, b) => b.length - a.length)[0]
      if (contour) {
        const omittedLength = Math.max(0, components.reduce((sum, component) => sum + component.length, 0) - contour.length)
        variants.push({ points: contour.points, penalty: Math.min(10, omittedLength / Math.max(contour.length + omittedLength, 1) * 15) })
      }
      if (components.length > 1) variants.push({ points: components.flatMap(component => component.points), penalty: 0 })
    } else if (matchingContours.length === components.length) {
      variants.push({ points: components.flatMap(component => component.points), penalty: 0 })
    }
    for (const variant of variants) {
      const score = (trimmedNearestMean(stroke, variant.points) * 0.55 + trimmedNearestMean(variant.points, stroke) * 0.45) + variant.penalty
      if (!best || score < best.score) best = { shapeId: template.id, score }
    }
  }
  return best && best.score <= 19 ? best : undefined
}

function shapeTransformBox(shapeId: string, target: Box): Box {
  const template = libraryTemplate(shapeId)
  if (!template) return target
  const scaleX = target.width / Math.max(template.bounds.width, 0.1)
  const scaleY = target.height / Math.max(template.bounds.height, 0.1)
  return {
    x: target.x - template.bounds.x * scaleX,
    y: target.y - template.bounds.y * scaleY,
    width: scaleX * 100,
    height: scaleY * 100,
  }
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy || 1
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio))
}

function isDatabaseContour(points: Point[], box: Box): boolean {
  const width = Math.max(box.width, 0.1)
  const height = Math.max(box.height, 0.1)
  const ratio = width / height
  if (ratio < 0.65 || ratio > 1.3) return false
  const normalized = normalizePoints(points, box)
  const top = normalized.filter(point => point.y < 12)
  const bottom = normalized.filter(point => point.y > 88)
  const left = normalized.filter(point => point.x < 8)
  const right = normalized.filter(point => point.x > 92)
  const xRange = (samples: Point[]) => samples.length ? Math.max(...samples.map(point => point.x)) - Math.min(...samples.map(point => point.x)) : 100
  const yRange = (samples: Point[]) => samples.length ? Math.max(...samples.map(point => point.y)) - Math.min(...samples.map(point => point.y)) : 0
  return top.length >= 3 && bottom.length >= 3 && xRange(top) < 90 && xRange(bottom) < 90
    && left.length > normalized.length * 0.08 && right.length > normalized.length * 0.08
    && yRange(left) > 48 && yRange(right) > 48
}

function recognizeCommonLibraryShape(points: Point[], box: Box, diagonal: number): string | undefined {
  const corners = simplifyStroke(points, Math.max(3, diagonal * 0.14))
  const normalizedCorners = corners.map(point => ({
    x: (point.x - box.x) / Math.max(box.width, 0.1),
    y: (point.y - box.y) / Math.max(box.height, 0.1),
  }))

  let edgeMidpoints = false
  let rightAngled = false
  let diamondLike = false
  if (normalizedCorners.length === 4) {
    rightAngled = corners.every((point, index) => {
      const before = corners[(index + corners.length - 1) % corners.length]
      const after = corners[(index + 1) % corners.length]
      const a = { x: before.x - point.x, y: before.y - point.y }
      const b = { x: after.x - point.x, y: after.y - point.y }
      return Math.abs((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1)) < 0.65
    })
    const axisAligned = normalizedCorners.every(point => (point.x < 0.24 || point.x > 0.76) && (point.y < 0.24 || point.y > 0.76))
    edgeMidpoints = normalizedCorners.every(point => {
      const onHorizontalEdge = (point.y < 0.22 || point.y > 0.78) && Math.abs(point.x - 0.5) < 0.24
      const onVerticalEdge = (point.x < 0.22 || point.x > 0.78) && Math.abs(point.y - 0.5) < 0.24
      return onHorizontalEdge || onVerticalEdge
    })
    const polygonDeviation = points.reduce((sum, point) => {
      const distance = corners.reduce((nearest, corner, index) => Math.min(nearest, pointToSegmentDistance(point, corner, corners[(index + 1) % corners.length])), Infinity)
      return sum + distance
    }, 0) / points.length / Math.max(diagonal, 1)
    if (axisAligned && isDatabaseContour(points, box)) return 'flow-database'
    if (axisAligned && polygonDeviation < 0.065) return 'flow-process'
    if (edgeMidpoints && rightAngled) {
      diamondLike = polygonDeviation < 0.075
    }
  }

  if (normalizedCorners.length === 3) {
    const top = Math.min(...normalizedCorners.map(point => point.y))
    const bottom = Math.max(...normalizedCorners.map(point => point.y))
    const apexAtTop = normalizedCorners.filter(point => point.y < top + 0.2).length === 1
    const apexAtBottom = normalizedCorners.filter(point => point.y > bottom - 0.2).length === 1
    if (apexAtTop || apexAtBottom) return apexAtBottom ? 'flow-merge' : 'flow-extract'
  }

  if (points.length >= 12 && simplifyStroke(points, Math.max(1.5, diagonal * 0.035)).length >= 8) {
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const radiusX = Math.max(box.width / 2, 0.1)
    const radiusY = Math.max(box.height / 2, 0.1)
    const radialDeviation = points.reduce((sum, point) => {
      const radius = Math.hypot((point.x - center.x) / radiusX, (point.y - center.y) / radiusY)
      return sum + Math.abs(radius - 1)
    }, 0) / points.length
    if (radialDeviation < 0.16) {
      const isCircle = Math.abs(box.width - box.height) / Math.max(box.width, box.height) < 0.18
      return isCircle ? 'flow-connector' : 'flow-terminator'
    }
  }

  if (diamondLike) return 'flow-decision'

  return undefined
}

function recognizeSketch(points: Point[]): SketchRecognition | undefined {
  if (points.length < 3) return undefined
  const box = pointsBounds(points)
  const diagonal = Math.hypot(box.width, box.height)
  const endpointGap = Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y)
  const closed = endpointGap <= Math.max(14, diagonal * 0.3)
  if (!closed) {
    const simplified = simplifyStroke(points, Math.max(3, diagonal * 0.075))
    if (simplified.length === 2) {
      const start = simplified[0]
      const end = simplified[1]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      const maxDistance = Math.max(...points.map(point => Math.abs((end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x))) / Math.max(length, 1)
      if (maxDistance <= Math.max(6, diagonal * 0.1)) return { type: 'line', start, end }
    }
  } else {
    const commonShape = recognizeCommonLibraryShape(points, box, diagonal)
    if (commonShape) return { type: 'shape', shapeId: commonShape, box }
  }
  const match = matchLibraryShape(points, box, closed)
  if (!match) return undefined
  return { type: 'shape', shapeId: match.shapeId, box }
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

function rounded(value: number): string {
  return `${Number(value.toFixed(2))}`
}

function toHexColor(value: string): string | undefined {
  if (/^#[\da-f]{6}$/i.test(value)) return value
  if (/^#[\da-f]{3}$/i.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  const rgb = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!rgb) return undefined
  return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}`
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
  return children.filter(child => OBJECT_TAGS.has(child.tagName.toLowerCase()) && !child.hasAttribute('data-background') && !child.hasAttribute('data-editor-ui') && !child.hasAttribute('data-connector-visual-for'))
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
  stage.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target], line[data-auto-route="true"]').forEach(line => {
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
    const lineId = line.getAttribute('data-object-id')
    const routeEnabled = line.getAttribute('data-auto-route') === 'true'
    const existingRoute = lineId ? stage.querySelector<SVGPathElement>(`[data-connector-visual-for="${CSS.escape(lineId)}"]`) : null
    if (!routeEnabled || !lineId) {
      existingRoute?.remove()
      line.removeAttribute('stroke-opacity')
      return
    }
    const x1 = Number(line.getAttribute('x1')); const y1 = Number(line.getAttribute('y1'))
    const x2 = Number(line.getAttribute('x2')); const y2 = Number(line.getAttribute('y2'))
    const startPoint = { x: x1, y: y1 }; const endPoint = { x: x2, y: y2 }
    const connected = new Set([line.getAttribute('data-start-target'), line.getAttribute('data-end-target')])
    const bounds = directObjects(stage).filter(item => item !== line && !connected.has(item.getAttribute('data-object-id'))).map(getBox).filter((box): box is Box => Boolean(box))
    const midX = (x1 + x2) / 2; const midY = (y1 + y2) / 2
    const routes = [
      [startPoint, { x: midX, y: y1 }, { x: midX, y: y2 }, endPoint],
      [startPoint, { x: x1, y: midY }, { x: x2, y: midY }, endPoint],
      [startPoint, { x: midX, y: y1 }, { x: midX, y: (y1 < y2 ? -18 : HEIGHT + 18) }, { x: x2, y: (y1 < y2 ? -18 : HEIGHT + 18) }, endPoint],
      [startPoint, { x: (x1 < x2 ? -18 : WIDTH + 18), y: y1 }, { x: (x1 < x2 ? -18 : WIDTH + 18), y: y2 }, endPoint],
    ]
    const blocked = (a: Point, b: Point) => bounds.some(box => {
      if (Math.abs(a.y - b.y) < .1) return a.y > box.y + 2 && a.y < box.y + box.height - 2 && Math.max(Math.min(a.x, b.x), box.x) < Math.min(Math.max(a.x, b.x), box.x + box.width)
      if (Math.abs(a.x - b.x) < .1) return a.x > box.x + 2 && a.x < box.x + box.width - 2 && Math.max(Math.min(a.y, b.y), box.y) < Math.min(Math.max(a.y, b.y), box.y + box.height)
      return false
    })
    const score = (route: Point[]) => route.slice(1).reduce((value, point, index) => value + (blocked(route[index], point) ? 1000 : 0) + Math.hypot(point.x - route[index].x, point.y - route[index].y), 0)
    const route = routes.sort((a, b) => score(a) - score(b))[0]
    const pathData = route.map((point, index) => `${index ? 'L' : 'M'} ${rounded(point.x)} ${rounded(point.y)}`).join(' ')
    const visual = existingRoute ?? document.createElementNS(SVG_NS, 'path')
    visual.setAttribute('data-connector-visual-for', lineId)
    visual.setAttribute('d', pathData)
    visual.setAttribute('fill', 'none')
    visual.setAttribute('stroke', line.getAttribute('stroke') ?? '#596fd8')
    visual.setAttribute('stroke-width', line.getAttribute('stroke-width') ?? '3')
    visual.setAttribute('stroke-linecap', 'round')
    visual.setAttribute('stroke-linejoin', 'round')
    for (const side of ['start', 'end'] as const) {
      const marker = line.getAttribute(`marker-${side}`)
      if (marker) visual.setAttribute(`marker-${side}`, marker)
      else visual.removeAttribute(`marker-${side}`)
    }
    if (!existingRoute) stage.append(visual)
    line.setAttribute('stroke-opacity', '0')
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
  const grid = stage.node.getAttribute('data-editor-grid') === 'true'
  const gridSize = Math.max(4, Number(stage.node.getAttribute('data-editor-grid-size')) || 20)
  if (grid) {
    const patternId = `editor-grid-${crypto.randomUUID()}`
    const defs = document.createElementNS(SVG_NS, 'defs')
    const pattern = document.createElementNS(SVG_NS, 'pattern')
    pattern.setAttribute('id', patternId)
    pattern.setAttribute('width', `${gridSize}`)
    pattern.setAttribute('height', `${gridSize}`)
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    const line = document.createElementNS(SVG_NS, 'path')
    line.setAttribute('d', `M ${gridSize} 0 L 0 0 0 ${gridSize}`)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', '#66708a')
    line.setAttribute('stroke-width', '.6')
    line.setAttribute('stroke-opacity', '.15')
    pattern.append(line)
    defs.append(pattern)
    layer.node.prepend(defs)
    layer.rect(WIDTH, HEIGHT).fill(`url(#${patternId})`)
  }
  const guides = (() => { try { return JSON.parse(stage.node.getAttribute('data-editor-guides') ?? '[]') as EditorGuide[] } catch { return [] } })()
  guides.forEach(guide => {
    if (guide.axis === 'x') layer.line(guide.value, 0, guide.value, HEIGHT).stroke({ color: '#e3518b', width: 1, dasharray: '5 4' })
    else layer.line(0, guide.value, WIDTH, guide.value).stroke({ color: '#e3518b', width: 1, dasharray: '5 4' })
  })
  if (stage.node.getAttribute('data-editor-rulers') === 'true') {
    for (let x = 0; x <= WIDTH; x += 100) {
      layer.line(x, 0, x, 9).stroke({ color: '#8992a6', width: 1 })
      layer.text(`${x}`).font({ family: 'sans-serif', size: 8 }).fill('#737d93').move(x + 2, 2)
    }
    for (let y = 0; y <= HEIGHT; y += 100) {
      layer.line(0, y, 9, y).stroke({ color: '#8992a6', width: 1 })
      layer.text(`${y}`).font({ family: 'sans-serif', size: 8 }).fill('#737d93').move(2, y + 2)
    }
  }
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
    if (element.hasAttribute('data-editor-pen')) {
      const points = readPenPoints(element)
      points.forEach((point, index) => {
        const previous = points[index - 1]
        const next = points[index + 1]
        const tangent = previous && next
          ? { x: (next.x - previous.x) / 6, y: (next.y - previous.y) / 6 }
          : next ? { x: (next.x - point.x) / 6, y: (next.y - point.y) / 6 }
            : previous ? { x: (point.x - previous.x) / 6, y: (point.y - previous.y) / 6 }
              : { x: 0, y: 0 }
        const tangentX = tangent.x
        const tangentY = tangent.y
        const incoming = point.incoming ?? { x: point.x - tangentX, y: point.y - tangentY }
        const outgoing = point.outgoing ?? { x: point.x + tangentX, y: point.y + tangentY }
        for (const [handle, location] of [['incoming', incoming], ['outgoing', outgoing]] as const) {
          if (!previous && handle === 'incoming' && !point.incoming) continue
          if (!next && handle === 'outgoing' && !point.outgoing) continue
          layer.line(point.x, point.y, location.x, location.y).stroke({ color: '#28a58b', width: 1, dasharray: '3 2' })
          layer.circle(7).center(location.x, location.y).fill('#fff').stroke({ color: '#28a58b', width: 1.3 })
            .attr({ 'data-pen-handle': handle, 'data-pen-node-index': `${index}`, 'data-pen-object': element.getAttribute('data-object-id') ?? '', 'pointer-events': 'all', cursor: 'move' })
        }
        layer.circle(10).center(point.x, point.y).fill('#fff').stroke({ color: '#5066d2', width: 1.7 })
          .attr({ 'data-pen-node': `${index}`, 'data-pen-object': element.getAttribute('data-object-id') ?? '', 'pointer-events': 'all', cursor: 'move' })
      })
    }
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
  const activePen = useRef<ActivePen | null>(null)
  const finishPenAction = useRef<() => void>(() => {})
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
  const viewOptionsRef = useRef<EditorViewOptions>({ grid: false, gridSize: 20, snap: false, rulers: false, guides: [] })
  const autoRouteRef = useRef(false)
  const eyedropperRef = useRef(false)
  const fontFamilyRef = useRef('Inter, sans-serif')
  const fontWeightRef = useRef('600')
  const textAlignRef = useRef('start')
  const fontItalicRef = useRef(false)
  const [activePanel, setActivePanel] = useState<EditorPanel>('canvas')
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
  const [viewOptions, setViewOptions] = useState<EditorViewOptions>(viewOptionsRef.current)
  const [autoRoute, setAutoRoute] = useState(false)
  const [eyedropper, setEyedropper] = useState(false)
  const [layerRevision, setLayerRevision] = useState(0)
  const [rotationDraft, setRotationDraft] = useState('0')
  const [opacity, setOpacity] = useState(100)
  const [fontFamily, setFontFamily] = useState('Inter, sans-serif')
  const [fontWeight, setFontWeight] = useState('600')
  const [textAlign, setTextAlign] = useState('start')
  const [fontItalic, setFontItalic] = useState(false)
  const [comments, setComments] = useState<EditorComment[]>([])
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [miniObjects, setMiniObjects] = useState<MiniObject[]>([])
  const [exportSize, setExportSize] = useState({ width: 800, height: 500 })
  const [exportFormat, setExportFormat] = useState<'svg' | 'png'>('svg')
  const [exportTransparent, setExportTransparent] = useState(true)
  const [vectorizeDetail, setVectorizeDetail] = useState(32)
  const [artboardPreset, setArtboardPreset] = useState('360x220')
  const [workflowMessage, setWorkflowMessage] = useState('')
  const [showMinimap, setShowMinimap] = useState(true)
  const imageInput = useRef<HTMLInputElement>(null)
  const editorSessionId = useRef('')
  if (!editorSessionId.current) editorSessionId.current = crypto.randomUUID()
  const storageId = asset?.id ?? editorSessionId.current
  const [loadedCommentsKey, setLoadedCommentsKey] = useState('')
  const [loadedCheckpointsKey, setLoadedCheckpointsKey] = useState('')

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
  useEffect(() => { viewOptionsRef.current = viewOptions }, [viewOptions])
  useEffect(() => { autoRouteRef.current = autoRoute }, [autoRoute])
  useEffect(() => { fontFamilyRef.current = fontFamily }, [fontFamily])
  useEffect(() => { fontWeightRef.current = fontWeight }, [fontWeight])
  useEffect(() => { textAlignRef.current = textAlign }, [textAlign])
  useEffect(() => { fontItalicRef.current = fontItalic }, [fontItalic])
  useEffect(() => { eyedropperRef.current = eyedropper; if (drawing.current) renderOverlay(drawing.current, selectedIdsRef.current) }, [eyedropper])

  useEffect(() => {
    const stage = drawing.current?.node
    if (!stage) return
    stage.setAttribute('data-editor-grid', `${viewOptions.grid}`)
    stage.setAttribute('data-editor-grid-size', `${viewOptions.gridSize}`)
    stage.setAttribute('data-editor-rulers', `${viewOptions.rulers}`)
    stage.setAttribute('data-editor-guides', JSON.stringify(viewOptions.guides))
    renderOverlay(drawing.current!, selectedIdsRef.current)
  }, [viewOptions])

  useEffect(() => {
    const key = `no-tie-svg-comments:${storageId}`
    try { setComments(JSON.parse(localStorage.getItem(key) ?? '[]') as EditorComment[]) } catch { setComments([]) }
    setLoadedCommentsKey(key)
  }, [storageId])
  useEffect(() => {
    const key = `no-tie-svg-comments:${storageId}`
    if (loadedCommentsKey !== key) return
    try { localStorage.setItem(key, JSON.stringify(comments)) } catch { /* storage may be unavailable in private windows */ }
  }, [storageId, comments, loadedCommentsKey])
  useEffect(() => {
    const key = `no-tie-svg-history:${storageId}`
    try { setCheckpoints(JSON.parse(localStorage.getItem(key) ?? '[]') as Checkpoint[]) } catch { setCheckpoints([]) }
    setLoadedCheckpointsKey(key)
  }, [storageId])
  useEffect(() => {
    const key = `no-tie-svg-history:${storageId}`
    if (loadedCheckpointsKey !== key) return
    try { localStorage.setItem(key, JSON.stringify(checkpoints.slice(-20))) } catch { /* storage may be unavailable in private windows */ }
  }, [storageId, checkpoints, loadedCheckpointsKey])

  const chooseTool = (nextTool: Tool) => {
    if (activePen.current && nextTool !== 'pen') finishPenAction.current()
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
      const selectedElements = elementsForIds(stage.node, unique)
      const bounds = unionBoxes(selectedElements.map(getBox))
      setSelectionBounds(bounds ?? null)
      setGeometryDraft(bounds ? boxDraft(bounds) : null)
      setRotationDraft(selectedElements[0]?.getAttribute('data-editor-rotation') ?? '0')
      const first = selectedElements[0]
      setOpacity(Math.round(Number(first?.getAttribute('opacity') ?? 1) * 100))
      const selectedText = selectedElements.find(element => element.tagName.toLowerCase() === 'text')
      if (selectedText) {
        const family = selectedText.getAttribute('font-family') ?? 'Inter, sans-serif'
        const weight = selectedText.getAttribute('font-weight') ?? '600'
        const align = selectedText.getAttribute('text-anchor') ?? 'start'
        setFontFamily(family); fontFamilyRef.current = family
        setFontWeight(weight); fontWeightRef.current = weight
        setTextAlign(align); textAlignRef.current = align
        const italic = selectedText.getAttribute('font-style') === 'italic'
        setFontItalic(italic); fontItalicRef.current = italic
        const size = Number(selectedText.getAttribute('font-size')) || 24
        setFontSize(size); fontSizeRef.current = size
      }
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
    setLayerRevision(value => value + 1)
    setMiniObjects(directObjects(stage.node).map((element, index) => ({
      id: element.getAttribute('data-object-id') ?? `${index}`,
      box: getBox(element),
      color: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#7180bd',
    })).filter((item): item is MiniObject => Boolean(item.box)))
  }

  function finishPen() {
    const stage = drawing.current
    const pen = activePen.current
    if (!stage || !pen) return
    activePen.current = null
    if (pen.points.length < 2) pen.element.remove()
    else {
      pen.element.setAttribute('d', penPath(pen.points))
      pen.element.setAttribute('data-pen-points', JSON.stringify(pen.points))
      recordHistory(stage)
      select([pen.id])
    }
    chooseTool('select')
  }
  finishPenAction.current = finishPen

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
    updateConnectors(stage.node)
    stage.node.setAttribute('data-editor-grid', `${viewOptionsRef.current.grid}`)
    stage.node.setAttribute('data-editor-grid-size', `${viewOptionsRef.current.gridSize}`)
    stage.node.setAttribute('data-editor-rulers', `${viewOptionsRef.current.rulers}`)
    stage.node.setAttribute('data-editor-guides', JSON.stringify(viewOptionsRef.current.guides))
    drawing.current = stage
    history.current = [snapshotContent(stage)]
    redoHistory.current = []
    setLayerRevision(value => value + 1)
    setMiniObjects(directObjects(stage.node).map((element, index) => ({ id: element.getAttribute('data-object-id') ?? `${index}`, box: getBox(element), color: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#7180bd' })).filter((item): item is MiniObject => Boolean(item.box)))
    renderOverlay(stage, [])
    setCanUndo(false)
    setCanRedo(false)

    const point = (event: PointerEvent) => {
      const bounds = stage.node.getBoundingClientRect()
      const location = {
        x: Number(Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) * WIDTH / bounds.width)).toFixed(1)),
        y: Number(Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) * HEIGHT / bounds.height)).toFixed(1)),
      }
      if (viewOptionsRef.current.snap) {
        const size = Math.max(2, viewOptionsRef.current.gridSize)
        return { x: Math.round(location.x / size) * size, y: Math.round(location.y / size) * size }
      }
      return location
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
          const created = stage.text(value).move(editing.x, editing.y).font({ family: fontFamilyRef.current, size: editing.fontSize, weight: fontWeightRef.current }).fill(strokeColorRef.current)
          created.attr({ 'text-anchor': textAlignRef.current })
          if (fontItalicRef.current) created.attr({ 'font-style': 'italic' })
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
      if (currentTool === 'arrow' && autoRouteRef.current) element.attr('data-auto-route', 'true')
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
      if (eyedropperRef.current) {
        const target = findObjectTarget(stage.node, event.target)
        if (target) {
          const imageSource = target.tagName.toLowerCase() === 'image' ? target.getAttribute('href') : null
          const box = imageSource ? getBox(target) : undefined
          if (imageSource && box) {
            void (async () => {
              try {
                const image = new Image(); image.src = imageSource; await image.decode()
                const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
                const context = canvas.getContext('2d', { willReadFrequently: true })
                if (!context) return
                const px = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor((location.x - box.x) / Math.max(box.width, .1) * image.naturalWidth)))
                const py = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor((location.y - box.y) / Math.max(box.height, .1) * image.naturalHeight)))
                context.drawImage(image, px, py, 1, 1, 0, 0, 1, 1)
                const data = context.getImageData(0, 0, 1, 1).data
                applySampledColor(`#${[data[0], data[1], data[2]].map(channel => channel.toString(16).padStart(2, '0')).join('')}`)
              } catch { /* the source image may no longer be readable */ }
            })()
          } else {
            const color = toHexColor(target.getAttribute('fill') ?? target.getAttribute('stroke') ?? '')
            if (color) applySampledColor(color)
          }
          setEyedropper(false)
        }
        return
      }
      if (currentTool === 'pen') {
        let pen = activePen.current
        if (!pen) {
          const id = crypto.randomUUID()
          const element = stage.path(`M ${rounded(location.x)} ${rounded(location.y)} l 0.1 0`).fill('none')
          element.stroke({ color: strokeColorRef.current, width: strokeWidthRef.current, linecap: 'round', linejoin: 'round' })
          element.attr({ 'data-object-id': id, 'data-editor-pen': 'true', 'data-pen-points': '[]', 'pointer-events': 'all' })
          pen = { id, element: element.node, points: [] }
          activePen.current = pen
        }
        const last = pen.points.at(-1)
        if (!last || Math.hypot(last.x - location.x, last.y - location.y) > 1) pen.points.push(location)
        pen.element.setAttribute('data-pen-points', JSON.stringify(pen.points))
        pen.element.setAttribute('d', penPath(pen.points))
        select([pen.id])
        renderOverlay(stage, [pen.id])
        return
      }
      if (currentTool === 'text') {
        if (event.detail <= 1) beginTextEdit(location, undefined, event.ctrlKey)
        return
      }
      stage.node.setPointerCapture(event.pointerId)
      if (currentTool !== 'select') {
        const anchorCandidate = (currentTool === 'line' || currentTool === 'arrow') ? findAnchorHit(event.target) : undefined
        const anchorElement = anchorCandidate ? elementsForIds(stage.node, [anchorCandidate.id])[0] : undefined
        const anchor = anchorElement?.getAttribute('data-layer-locked') === 'true' ? undefined : anchorCandidate
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

      const penHandle = event.target instanceof Element ? event.target.closest('[data-pen-handle][data-pen-node-index][data-pen-object]') : null
      const penNode = penHandle ?? (event.target instanceof Element ? event.target.closest('[data-pen-node][data-pen-object]') : null)
      if (penNode) {
        const id = penNode.getAttribute('data-pen-object')
        const index = Number(penHandle?.getAttribute('data-pen-node-index') ?? penNode.getAttribute('data-pen-node'))
        const handle = (penHandle?.getAttribute('data-pen-handle') ?? 'anchor') as 'anchor' | 'incoming' | 'outgoing'
        const element = id ? elementsForIds(stage.node, [id])[0] as SVGPathElement | undefined : undefined
        const points = element ? readPenPoints(element) : []
        if (element && element.getAttribute('data-layer-locked') !== 'true' && points[index]) {
          select([id!])
          interaction.current = { type: 'pen-node', element, index, handle, points, moved: false }
          return
        }
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
      if (target.getAttribute('data-layer-locked') === 'true') return
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
      } else if (current.type === 'pen-node') {
        current.moved = true
        const node = current.points[current.index]
        if (current.handle === 'anchor') {
          const dx = location.x - node.x; const dy = location.y - node.y
          node.x = location.x; node.y = location.y
          if (node.incoming) node.incoming = { x: node.incoming.x + dx, y: node.incoming.y + dy }
          if (node.outgoing) node.outgoing = { x: node.outgoing.x + dx, y: node.outgoing.y + dy }
        } else node[current.handle] = location
        current.element.setAttribute('data-pen-points', JSON.stringify(current.points))
        current.element.setAttribute('d', penPath(current.points))
        renderOverlay(stage, [current.element.getAttribute('data-object-id') ?? ''])
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
              if (recognition.type === 'line') {
                const replacement = document.createElementNS(SVG_NS, 'line')
                for (const attribute of ['data-object-id', 'pointer-events', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) {
                  const value = current.element.node.getAttribute(attribute)
                  if (value !== null) replacement.setAttribute(attribute, value)
                }
                replacement.setAttribute('x1', rounded(recognition.start.x)); replacement.setAttribute('y1', rounded(recognition.start.y))
                replacement.setAttribute('x2', rounded(recognition.end.x)); replacement.setAttribute('y2', rounded(recognition.end.y))
                current.element.node.replaceWith(replacement)
              } else {
                const replacement = createLibraryShapeNode(recognition.shapeId, shapeTransformBox(recognition.shapeId, recognition.box), current.element.node, current.id)
                replacement.setAttribute('fill', fillEnabledRef.current ? fillColorRef.current : 'none')
                current.element.node.replaceWith(replacement)
              }
            }
          }
        }
        updateConnectors(stage.node)
        recordHistory(stage)
        select([current.id])
        if (!current.keepTool) chooseTool('select')
      } else if (current.type === 'pen-node') {
        if (current.moved) recordHistory(stage)
        select([current.element.getAttribute('data-object-id') ?? ''])
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
      if (event.key === 'Enter' && activePen.current) {
        event.preventDefault()
        finishPenAction.current()
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && selectedIdsRef.current.length) {
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
      if (activePen.current) {
        event.preventDefault()
        finishPenAction.current()
        return
      }
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
    setLayerRevision(value => value + 1)
    setMiniObjects(directObjects(stage.node).map((element, index) => ({ id: element.getAttribute('data-object-id') ?? `${index}`, box: getBox(element), color: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#7180bd' })).filter((item): item is MiniObject => Boolean(item.box)))
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
    setLayerRevision(value => value + 1)
    setMiniObjects(directObjects(stage.node).map((element, index) => ({ id: element.getAttribute('data-object-id') ?? `${index}`, box: getBox(element), color: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#7180bd' })).filter((item): item is MiniObject => Boolean(item.box)))
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
    updateConnectors(stage.node)
    recordHistory(stage)
  }

  function applyFillColor(value: string) {
    fillColorRef.current = value
    setFillColor(value)
    const stage = drawing.current
    if (!stage) return
    if (fillEnabledRef.current) {
      elementsForIds(stage.node, selectedIdsRef.current).filter(element => !['text', 'line'].includes(element.tagName.toLowerCase())).forEach(element => {
        element.setAttribute('fill', value)
        element.querySelectorAll('[fill]').forEach(child => child.setAttribute('fill', value))
      })
      recordHistory(stage)
    }
  }

  function applyFillEnabled(value: boolean) {
    fillEnabledRef.current = value
    setFillEnabled(value)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).filter(element => !['text', 'line'].includes(element.tagName.toLowerCase())).forEach(element => {
      element.setAttribute('fill', value ? fillColorRef.current : 'none')
      element.querySelectorAll('[fill]').forEach(child => child.setAttribute('fill', value ? fillColorRef.current : 'none'))
    })
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
    const next = Math.max(8, Math.min(160, value || 24))
    fontSizeRef.current = next
    setFontSize(next)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.tagName.toLowerCase() === 'text')
      .forEach(element => element.setAttribute('font-size', `${next}`))
    recordHistory(stage)
  }

  function applyRotation() {
    const stage = drawing.current
    const angle = Number(rotationDraft)
    if (!stage || !Number.isFinite(angle)) return
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => {
      const box = getBox(element)
      if (!box) return
      const base = element.getAttribute('data-editor-base-transform') ?? element.getAttribute('transform') ?? ''
      element.setAttribute('data-editor-base-transform', base)
      element.setAttribute('data-editor-rotation', `${angle}`)
      element.setAttribute('transform', `${base ? `${base} ` : ''}rotate(${rounded(angle)} ${rounded(box.x + box.width / 2)} ${rounded(box.y + box.height / 2)})`)
    })
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function alignSelection(axis: 'x' | 'y', alignment: 'start' | 'center' | 'end') {
    const stage = drawing.current
    if (!stage || selectedIdsRef.current.length < 2) return
    const elements = elementsForIds(stage.node, selectedIdsRef.current)
    const boxes = elements.map(getBox)
    const bounds = unionBoxes(boxes)
    if (!bounds) return
    elements.forEach((element, index) => {
      const box = boxes[index]
      if (!box) return
      const currentStart = axis === 'x' ? box.x : box.y
      const currentSize = axis === 'x' ? box.width : box.height
      const target = axis === 'x'
        ? alignment === 'start' ? bounds.x : alignment === 'center' ? bounds.x + bounds.width / 2 - currentSize / 2 : bounds.x + bounds.width - currentSize
        : alignment === 'start' ? bounds.y : alignment === 'center' ? bounds.y + bounds.height / 2 - currentSize / 2 : bounds.y + bounds.height - currentSize
      moveElementBy(element, axis === 'x' ? target - currentStart : 0, axis === 'y' ? target - currentStart : 0)
    })
    updateConnectors(stage.node)
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function distributeSelection(axis: 'x' | 'y') {
    const stage = drawing.current
    if (!stage || selectedIdsRef.current.length < 3) return
    const items = elementsForIds(stage.node, selectedIdsRef.current).map(element => ({ element, box: getBox(element) })).filter((item): item is { element: SVGElement; box: Box } => Boolean(item.box))
      .sort((a, b) => axis === 'x' ? a.box.x - b.box.x : a.box.y - b.box.y)
    if (items.length < 3) return
    const start = axis === 'x' ? items[0].box.x : items[0].box.y
    const finalBox = items.at(-1)!.box
    const end = axis === 'x' ? finalBox.x + finalBox.width : finalBox.y + finalBox.height
    const occupied = items.reduce((total, item) => total + (axis === 'x' ? item.box.width : item.box.height), 0)
    const gap = (end - start - occupied) / (items.length - 1)
    let cursor = start
    items.forEach(item => {
      const position = axis === 'x' ? item.box.x : item.box.y
      moveElementBy(item.element, axis === 'x' ? cursor - position : 0, axis === 'y' ? cursor - position : 0)
      cursor += (axis === 'x' ? item.box.width : item.box.height) + gap
    })
    updateConnectors(stage.node)
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function applyBoolean(operation: 'union' | 'subtract' | 'intersect') {
    const stage = drawing.current
    const originals = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    if (!stage || originals.length < 2) return
    const bounds = unionBoxes(originals.map(getBox))
    if (!bounds) return
    const cloneClean = (source: SVGElement) => {
      const clone = source.cloneNode(true) as SVGElement
      const nodes = [clone, ...Array.from(clone.querySelectorAll('*'))]
      nodes.forEach(node => {
        node.removeAttribute('data-object-id')
        node.removeAttribute('data-group-id')
        node.removeAttribute('data-start-target')
        node.removeAttribute('data-end-target')
        node.removeAttribute('data-start-anchor')
        node.removeAttribute('data-end-anchor')
      })
      return clone
    }
    const combined = document.createElementNS(SVG_NS, 'g')
    const id = crypto.randomUUID()
    combined.setAttribute('data-object-id', id)
    combined.setAttribute('data-layer-name', operation === 'union' ? 'Suma kształtów' : operation === 'subtract' ? 'Różnica kształtów' : 'Część wspólna')
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    if (operation === 'union') {
      originals.forEach(element => combined.append(cloneClean(element)))
    } else {
      const cutter = originals.at(-1)!
      const effectId = `editor-${operation}-${crypto.randomUUID()}`
      const effect = document.createElementNS(SVG_NS, operation === 'intersect' ? 'clipPath' : 'mask')
      effect.setAttribute('id', effectId)
      if (operation === 'intersect') {
        effect.setAttribute('clipPathUnits', 'userSpaceOnUse')
        effect.append(cloneClean(cutter))
        originals.slice(0, -1).forEach(element => combined.append(cloneClean(element)))
        combined.setAttribute('clip-path', `url(#${effectId})`)
      } else {
        effect.setAttribute('maskUnits', 'userSpaceOnUse')
        effect.setAttribute('x', '0'); effect.setAttribute('y', '0'); effect.setAttribute('width', `${WIDTH}`); effect.setAttribute('height', `${HEIGHT}`)
        const white = document.createElementNS(SVG_NS, 'rect')
        white.setAttribute('x', '0'); white.setAttribute('y', '0'); white.setAttribute('width', `${WIDTH}`); white.setAttribute('height', `${HEIGHT}`); white.setAttribute('fill', 'white')
        const black = cloneClean(cutter)
        ;[black, ...Array.from(black.querySelectorAll('*'))].forEach(node => { node.setAttribute('fill', 'black'); node.setAttribute('stroke', 'black') })
        effect.append(white, black)
        combined.append(cloneClean(originals[0]))
        combined.setAttribute('mask', `url(#${effectId})`)
      }
      defs.append(effect)
    }
    originals.forEach(element => element.remove())
    stage.node.append(combined)
    updateConnectors(stage.node)
    select([id])
    recordHistory(stage)
  }

  function addArtboard() {
    const stage = drawing.current
    if (!stage) return
    const [width, height] = artboardPreset.split('x').map(Number)
    const count = directObjects(stage.node).filter(element => element.hasAttribute('data-artboard')).length
    const columns = Math.max(1, Math.floor((WIDTH - 20) / (width + 20)))
    const rows = Math.max(1, Math.floor((HEIGHT - 20) / (height + 20)))
    if (count >= columns * rows) return
    const x = 20 + (count % columns) * (width + 20)
    const y = 20 + Math.floor(count / columns) * (height + 20)
    const board = stage.rect(width, height).move(x, y).fill('#ffffff').stroke({ color: '#aeb7cb', width: 1, dasharray: '7 5' })
    const id = crypto.randomUUID()
    board.attr({ 'data-object-id': id, 'data-artboard': 'true', 'data-layer-name': `Plansza ${count + 1}`, 'data-layer-locked': 'true', 'pointer-events': 'all' })
    const firstOther = directObjects(stage.node).find(element => element !== board.node)
    if (firstOther) stage.node.insertBefore(board.node, firstOther)
    recordHistory(stage)
    select([id])
  }

  function addGuide(axis: 'x' | 'y') {
    const value = axis === 'x' ? WIDTH / 2 : HEIGHT / 2
    setViewOptions(current => ({ ...current, guides: [...current.guides, { axis, value }] }))
  }

  function createSymbolFromSelection() {
    const stage = drawing.current
    const originals = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    const bounds = unionBoxes(originals.map(getBox))
    if (!stage || !bounds || !originals.length) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const symbol = document.createElementNS(SVG_NS, 'symbol')
    const id = `symbol-${crypto.randomUUID()}`
    symbol.setAttribute('id', id)
    symbol.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}`)
    originals.forEach(element => {
      const clone = element.cloneNode(true) as SVGElement
      ;[clone, ...Array.from(clone.querySelectorAll('*'))].forEach(node => { node.removeAttribute('data-object-id'); node.removeAttribute('data-group-id') })
      symbol.append(clone)
    })
    defs.append(symbol)
    const use = document.createElementNS(SVG_NS, 'use')
    const objectId = crypto.randomUUID()
    use.setAttribute('href', `#${id}`)
    use.setAttribute('x', `${bounds.x}`); use.setAttribute('y', `${bounds.y}`); use.setAttribute('width', `${bounds.width}`); use.setAttribute('height', `${bounds.height}`)
    use.setAttribute('data-object-id', objectId); use.setAttribute('data-layer-name', 'Wystąpienie symbolu'); use.setAttribute('pointer-events', 'all')
    const selected = new Set(originals.map(element => element.getAttribute('data-object-id')).filter((value): value is string => Boolean(value)))
    stage.node.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target]').forEach(line => {
      for (const side of ['start', 'end'] as const) if (selected.has(line.getAttribute(`data-${side}-target`) ?? '')) line.setAttribute(`data-${side}-target`, objectId)
    })
    originals.forEach(element => element.remove())
    stage.node.append(use)
    updateConnectors(stage.node)
    recordHistory(stage)
    select([objectId])
  }

  function insertSymbol(symbolId: string) {
    const stage = drawing.current
    const symbol = stage?.node.querySelector<SVGSymbolElement>(`symbol#${CSS.escape(symbolId)}`)
    if (!stage || !symbol) return
    const use = document.createElementNS(SVG_NS, 'use')
    const id = crypto.randomUUID()
    use.setAttribute('href', `#${symbolId}`)
    use.setAttribute('x', '100'); use.setAttribute('y', '100'); use.setAttribute('width', '180'); use.setAttribute('height', '120')
    use.setAttribute('data-object-id', id); use.setAttribute('data-layer-name', 'Wystąpienie symbolu'); use.setAttribute('pointer-events', 'all')
    stage.node.append(use)
    recordHistory(stage)
    select([id])
  }

  function setGradientFill() {
    const stage = drawing.current
    const elements = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    if (!stage || !elements.length) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const gradient = document.createElementNS(SVG_NS, 'linearGradient')
    const id = `gradient-${crypto.randomUUID()}`
    gradient.setAttribute('id', id); gradient.setAttribute('x1', '0%'); gradient.setAttribute('y1', '0%'); gradient.setAttribute('x2', '100%'); gradient.setAttribute('y2', '100%')
    for (const [offset, color] of [['0%', fillColor], ['100%', strokeColor]] as const) {
      const stop = document.createElementNS(SVG_NS, 'stop')
      stop.setAttribute('offset', offset); stop.setAttribute('stop-color', color); stop.setAttribute('stop-opacity', '1'); gradient.append(stop)
    }
    defs.append(gradient)
    elements.forEach(element => {
      element.setAttribute('fill', `url(#${id})`)
      element.querySelectorAll('[fill]').forEach(child => child.setAttribute('fill', `url(#${id})`))
    })
    recordHistory(stage)
  }

  function createCheckpoint() {
    const stage = drawing.current
    if (!stage) return
    const createdAt = Date.now()
    const checkpoint = { id: crypto.randomUUID(), label: `Punkt kontrolny · ${new Date(createdAt).toLocaleString('pl-PL')}`, createdAt, content: snapshotContent(stage) }
    setCheckpoints(current => [...current, checkpoint].slice(-20))
  }

  function restoreCheckpoint(checkpoint: Checkpoint) {
    const stage = drawing.current
    if (!stage) return
    stage.clear(); stage.svg(checkpoint.content); ensureObjectIds(stage.node); updateConnectors(stage.node)
    select([]); recordHistory(stage); renderOverlay(stage, [])
  }

  function addComment() {
    const box = selectionBounds
    setCommentDraft({ x: box ? box.x + box.width / 2 : WIDTH / 2, y: box ? box.y + box.height / 2 : HEIGHT / 2 })
  }

  function saveComment(text: string) {
    if (!commentDraft || !text.trim()) return
    setComments(current => [...current, { id: crypto.randomUUID(), x: commentDraft.x, y: commentDraft.y, text: text.trim() }])
    setCommentDraft(null)
  }

  function exportSvgSource(): string | undefined {
    const stage = drawing.current
    if (!stage) return undefined
    const copy = stage.node.cloneNode(true) as SVGSVGElement
    copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
    const removeBackground = fitToContent || (exportFormat === 'png' && exportTransparent)
    if (removeBackground) copy.querySelectorAll('[data-background]').forEach(element => element.remove())
    else copy.querySelectorAll('[data-background]').forEach(element => element.removeAttribute('data-background'))
    copy.setAttribute('width', `${exportSize.width}`); copy.setAttribute('height', `${exportSize.height}`)
    if (fitToContent) {
      const bounds = unionBoxes(directObjects(stage.node).map(getBox))
      if (bounds) {
        const margin = 20
        const x = Math.floor(bounds.x - margin); const y = Math.floor(bounds.y - margin)
        const width = Math.max(1, Math.ceil(bounds.width + margin * 2)); const height = Math.max(1, Math.ceil(bounds.height + margin * 2))
        copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
      }
    }
    return sanitizeSvg(new XMLSerializer().serializeToString(copy))
  }

  async function downloadExport() {
    try {
      const source = exportSvgSource()
      if (!source) return
      const filename = `${asset?.fileName?.replace(/\.svg$/i, '') || 'schemat'}.${exportFormat}`
      if (exportFormat === 'svg') {
        const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setWorkflowMessage('Pobrano plik SVG.')
        return
      }
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
      try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = exportSize.width; canvas.height = exportSize.height
      const context = canvas.getContext('2d')
      if (!context) return
      if (!exportTransparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!png) return
        const pngUrl = URL.createObjectURL(png); const link = document.createElement('a'); link.href = pngUrl; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000)
        setWorkflowMessage('Pobrano plik PNG.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setWorkflowMessage('Nie udało się przygotować eksportu. Sprawdź rozmiar i zawartość SVG.')
    }
  }

  async function importRaster(file?: File) {
    const stage = drawing.current
    if (!stage || !file) return
    if (!/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) { setWorkflowMessage('Obsługiwane są pliki PNG, JPEG, GIF i WebP.'); return }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Nie udało się odczytać obrazu.')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file)
      })
      const image = new Image(); image.src = data; await image.decode()
      const width = Math.min(360, image.naturalWidth); const height = width * image.naturalHeight / Math.max(image.naturalWidth, 1)
      const element = document.createElementNS(SVG_NS, 'image')
      element.setAttribute('href', data)
      element.setAttribute('x', '40'); element.setAttribute('y', '40'); element.setAttribute('width', `${width}`); element.setAttribute('height', `${height}`)
      const id = crypto.randomUUID()
      element.setAttribute('data-object-id', id); element.setAttribute('data-layer-name', file.name); element.setAttribute('pointer-events', 'all')
      stage.node.append(element)
      select([id]); recordHistory(stage); setWorkflowMessage(`Zaimportowano ${file.name}.`)
    } catch { setWorkflowMessage('Nie udało się odczytać wybranego obrazu.') }
  }

  async function vectorizeSelection() {
    const stage = drawing.current
    const imageElement = stage ? elementsForIds(stage.node, selectedIdsRef.current).find(element => element.tagName.toLowerCase() === 'image') as SVGImageElement | undefined : undefined
    if (!stage || !imageElement) return
    const source = imageElement.getAttribute('href') ?? imageElement.getAttribute('xlink:href')
    if (!source) return
    try {
    const image = new Image(); image.src = source; await image.decode()
    const size = Math.max(8, Math.min(80, vectorizeDetail))
    const ratio = image.naturalWidth / Math.max(image.naturalHeight, 1)
    const columns = ratio >= 1 ? size : Math.max(4, Math.round(size * ratio))
    const rows = ratio >= 1 ? Math.max(4, Math.round(size / ratio)) : size
    const canvas = document.createElement('canvas'); canvas.width = columns; canvas.height = rows
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0, columns, rows)
    const pixels = context.getImageData(0, 0, columns, rows).data
    const box = getBox(imageElement)
    if (!box) return
    const group = document.createElementNS(SVG_NS, 'g')
    const id = crypto.randomUUID()
    group.setAttribute('data-object-id', id); group.setAttribute('data-layer-name', 'Wektoryzacja obrazu')
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const offset = (y * columns + x) * 4
        if (pixels[offset + 3] < 36) continue
        const rect = document.createElementNS(SVG_NS, 'rect')
        rect.setAttribute('x', `${box.x + x * box.width / columns}`); rect.setAttribute('y', `${box.y + y * box.height / rows}`)
        rect.setAttribute('width', `${box.width / columns + .1}`); rect.setAttribute('height', `${box.height / rows + .1}`)
        rect.setAttribute('fill', `rgb(${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]})`)
        rect.setAttribute('fill-opacity', `${rounded(pixels[offset + 3] / 255)}`); group.append(rect)
      }
    }
    imageElement.replaceWith(group); select([id]); recordHistory(stage); setWorkflowMessage(`Utworzono wektory z obrazu (${columns} × ${rows} próbek).`)
    } catch { setWorkflowMessage('Nie udało się zwektoryzować tego obrazu.') }
  }

  function applyRouteSetting(enabled: boolean) {
    autoRouteRef.current = enabled
    setAutoRoute(enabled)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.tagName.toLowerCase() === 'line').forEach(element => {
      if (enabled) element.setAttribute('data-auto-route', 'true')
      else {
        element.removeAttribute('data-auto-route')
        const id = element.getAttribute('data-object-id')
        if (id) stage.node.querySelector(`[data-connector-visual-for="${CSS.escape(id)}"]`)?.remove()
        element.removeAttribute('stroke-opacity')
      }
    })
    updateConnectors(stage.node); recordHistory(stage)
  }

  function applySampledColor(color: string) {
    setStrokeColor(color); strokeColorRef.current = color
    setFillColor(color); fillColorRef.current = color
  }

  function applyObjectOpacity(value: number) {
    const next = Math.max(0, Math.min(100, value))
    setOpacity(next)
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.setAttribute('opacity', `${next / 100}`))
    recordHistory(stage)
  }

  function applyTypography(change: { family?: string; weight?: string; align?: string; italic?: boolean }) {
    const stage = drawing.current
    if (!stage) return
    const texts = elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.tagName.toLowerCase() === 'text')
    texts.forEach(element => {
      if (change.family) element.setAttribute('font-family', change.family)
      if (change.weight) element.setAttribute('font-weight', change.weight)
      if (change.align) element.setAttribute('text-anchor', change.align)
      if (change.italic !== undefined) element.setAttribute('font-style', change.italic ? 'italic' : 'normal')
    })
    if (change.italic !== undefined) { setFontItalic(change.italic); fontItalicRef.current = change.italic }
    recordHistory(stage)
  }

  function changeLayer(id: string, action: (element: SVGElement) => void) {
    const stage = drawing.current
    const element = stage ? elementsForIds(stage.node, [id])[0] : undefined
    if (!stage || !element) return
    action(element); setLayerRevision(value => value + 1); recordHistory(stage); renderOverlay(stage, selectedIdsRef.current)
  }

  function reorderLayer(id: string, direction: 'front' | 'back') {
    const stage = drawing.current
    if (!stage) return
    const objects = directObjects(stage.node)
    const index = objects.findIndex(element => element.getAttribute('data-object-id') === id)
    if (index < 0) return
    const element = objects[index]
    if (direction === 'front') stage.node.append(element)
    else {
      const previous = objects[index - 1]
      if (previous) stage.node.insertBefore(element, previous)
    }
    setLayerRevision(value => value + 1); recordHistory(stage); renderOverlay(stage, selectedIdsRef.current)
  }

  const save = () => {
    if (activePen.current) finishPenAction.current()
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
    { id: 'pen', label: 'Pióro Béziera, kliknij punkty i Enter, aby zakończyć', icon: Pencil },
    { id: 'text', label: 'Tekst na planszy', icon: Type },
  ]
  const layerItems = drawing.current ? [...directObjects(drawing.current.node)].reverse() : []
  const reusableSymbols = drawing.current ? Array.from(drawing.current.node.querySelectorAll<SVGSymbolElement>('defs symbol')) : []
  const selectedImage = drawing.current ? elementsForIds(drawing.current.node, selectedIds).find(element => element.tagName.toLowerCase() === 'image') : undefined
  const palette = ['#596fd8', '#e76c75', '#2b9a83', '#f0a84b', '#222c42', '#8a5bc2', '#3e8cc9', '#ffffff', '#111827']

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
        <nav className="drawing-feature-tabs" aria-label="Panele edytora SVG">
          {([
            ['canvas', 'Płótno', Grid3X3], ['style', 'Styl', Palette], ['layers', 'Warstwy i układ', Layers], ['workflow', 'Import, historia i eksport', History],
          ] as const).map(([id, label, Icon]) => <button key={id} className={activePanel === id ? 'selected' : ''} onClick={() => setActivePanel(id)} aria-pressed={activePanel === id}><Icon size={15} />{label}</button>)}
        </nav>
        <div className="drawing-feature-panel" role="tabpanel" data-revision={layerRevision}>
          {activePanel === 'canvas' && <div className="drawing-feature-row">
            <label className="fill-toggle"><input type="checkbox" checked={viewOptions.grid} onChange={event => setViewOptions(current => ({ ...current, grid: event.target.checked }))} />Siatka</label>
            <label className="drawing-select-control"><span>Odstęp</span><select value={viewOptions.gridSize} onChange={event => setViewOptions(current => ({ ...current, gridSize: Number(event.target.value) }))}>{[8, 10, 16, 20, 25, 32, 40, 50].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
            <label className="fill-toggle"><input type="checkbox" checked={viewOptions.snap} onChange={event => setViewOptions(current => ({ ...current, snap: event.target.checked }))} />Przyciągaj</label>
            <label className="fill-toggle"><input type="checkbox" checked={viewOptions.rulers} onChange={event => setViewOptions(current => ({ ...current, rulers: event.target.checked }))} /><Ruler size={14} />Linijki</label>
            <label className="fill-toggle"><input type="checkbox" checked={showMinimap} onChange={event => setShowMinimap(event.target.checked)} />Mini mapa</label>
            <button className="button secondary compact-feature-button" onClick={() => addGuide('x')}><Plus size={13} />Pionowa prowadnica</button>
            <button className="button secondary compact-feature-button" onClick={() => addGuide('y')}><Plus size={13} />Pozioma prowadnica</button>
            <button className="button secondary compact-feature-button" onClick={() => setViewOptions(current => ({ ...current, guides: [] }))} disabled={!viewOptions.guides.length}>Usuń prowadnice ({viewOptions.guides.length})</button>
            {viewOptions.guides.map((guide, index) => <div className="geometry-control guide-position-control" key={`${guide.axis}-${index}`}><span>{guide.axis === 'x' ? 'Pionowa X' : 'Pozioma Y'}</span><input type="number" min="0" max={guide.axis === 'x' ? WIDTH : HEIGHT} value={guide.value} onChange={event => setViewOptions(current => ({ ...current, guides: current.guides.map((item, currentIndex) => currentIndex === index ? { ...item, value: Number(event.target.value) } : item) }))} /><button className="tool-button" onClick={() => setViewOptions(current => ({ ...current, guides: current.guides.filter((_item, currentIndex) => currentIndex !== index) }))} aria-label="Usuń prowadnicę"><X size={12} /></button></div>)}
            <label className="drawing-select-control"><span>Plansza</span><select value={artboardPreset} onChange={event => setArtboardPreset(event.target.value)}><option value="360x220">Pozioma 360 × 220</option><option value="220x360">Pionowa 220 × 360</option><option value="220x220">Kwadrat 220 × 220</option></select></label>
            <button className="button secondary compact-feature-button" onClick={addArtboard}><Plus size={13} />Dodaj planszę</button>
            <span className="feature-help">Siatka i prowadnice są pomocnicze; nie trafiają do zapisanego SVG.</span>
          </div>}

          {activePanel === 'style' && <div className="drawing-feature-row drawing-style-feature-row">
            <div className="drawing-palette" aria-label="Paleta kolorów">{palette.map(color => <button key={color} className="palette-swatch" style={{ backgroundColor: color }} onClick={() => { applyStrokeColor(color); applyFillColor(color) }} title={`Ustaw kolor ${color}`} aria-label={`Ustaw kolor ${color}`} />)}</div>
            <button className={`button secondary compact-feature-button ${eyedropper ? 'feature-active' : ''}`} onClick={() => setEyedropper(value => !value)} title="Kliknij figurę, aby pobrać jej kolor"><Pipette size={14} />Pipeta</button>
            <button className="button secondary compact-feature-button" onClick={setGradientFill} disabled={!selectedIds.length} title="Utwórz gradient z kolorów wypełnienia i konturu">Gradient</button>
            <label className="line-width-control"><span>Przezroczystość</span><input type="range" min="0" max="100" step="1" value={opacity} onChange={event => applyObjectOpacity(Number(event.target.value))} /><output>{opacity}%</output></label>
            <label className="geometry-control"><span>Obrót °</span><input type="number" min="-360" max="360" step="1" value={rotationDraft} disabled={!selectedIds.length} onChange={event => setRotationDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyRotation() }} /></label>
            <button className="button secondary compact-feature-button" onClick={applyRotation} disabled={!selectedIds.length}><RotateCw size={13} />Obróć</button>
            <label className="drawing-select-control"><span>Krój pisma</span><select value={fontFamily} onChange={event => { setFontFamily(event.target.value); applyTypography({ family: event.target.value }) }}><option value="Inter, sans-serif">Inter</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="monospace">Monospace</option><option value="serif">Szeryfowy</option></select></label>
            <label className="drawing-select-control"><span>Grubość</span><select value={fontWeight} onChange={event => { setFontWeight(event.target.value); applyTypography({ weight: event.target.value }) }}><option value="400">Zwykła</option><option value="600">Półgruba</option><option value="700">Pogrubiona</option></select></label>
            <label className="drawing-select-control"><span>Wyrównanie</span><select value={textAlign} onChange={event => { setTextAlign(event.target.value); applyTypography({ align: event.target.value }) }}><option value="start">Do lewej</option><option value="middle">Do środka</option><option value="end">Do prawej</option></select></label>
            <label className="fill-toggle"><input type="checkbox" checked={fontItalic} onChange={event => applyTypography({ italic: event.target.checked })} disabled={!selectedIds.length} />Kursywa</label>
            <span className="feature-help">Typografia działa na zaznaczonych elementach tekstowych. Przezroczystość stosuje się do całej figury.</span>
          </div>}

          {activePanel === 'layers' && <div className="drawing-layer-workspace">
            <div className="drawing-feature-row">
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'start')} disabled={selectedIds.length < 2}><AlignStartHorizontal size={14} />Wyrównaj do lewej</button>
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'center')} disabled={selectedIds.length < 2}><AlignCenterHorizontal size={14} />Wyśrodkuj w poziomie</button>
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'end')} disabled={selectedIds.length < 2}><AlignEndHorizontal size={14} />Wyrównaj do prawej</button>
              <button className="button secondary compact-feature-button" onClick={() => distributeSelection('x')} disabled={selectedIds.length < 3}><ArrowDownWideNarrow size={14} />Rozłóż poziomo</button>
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'start')} disabled={selectedIds.length < 2}>Wyrównaj do góry</button>
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'center')} disabled={selectedIds.length < 2}>Wyśrodkuj w pionie</button>
              <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'end')} disabled={selectedIds.length < 2}>Wyrównaj do dołu</button>
              <button className="button secondary compact-feature-button" onClick={() => distributeSelection('y')} disabled={selectedIds.length < 3}>Rozłóż pionowo</button>
              <span className="toolbar-divider" />
              <button className="button secondary compact-feature-button" onClick={() => applyBoolean('union')} disabled={selectedIds.length < 2} title="Łączy zaznaczenie w jedną warstwę grupową, zachowując edytowalne figury">Połącz w grupę</button>
              <button className="button secondary compact-feature-button" onClick={() => applyBoolean('subtract')} disabled={selectedIds.length < 2}>Odejmij ostatnią</button>
              <button className="button secondary compact-feature-button" onClick={() => applyBoolean('intersect')} disabled={selectedIds.length < 2}>Część wspólna</button>
              <button className="button secondary compact-feature-button" onClick={createSymbolFromSelection} disabled={!selectedIds.length}>Zapisz zaznaczenie jako symbol</button>
              {reusableSymbols.map((symbol, index) => <button key={symbol.id} className="button secondary compact-feature-button" onClick={() => insertSymbol(symbol.id ?? '')} title="Wstaw ponownie edytowalny symbol"><Plus size={12} />Symbol {index + 1}</button>)}
            </div>
            <div className="drawing-layer-list" aria-label="Warstwy SVG">
              {!layerItems.length && <span className="feature-help">Dodane figury pojawią się tu jako warstwy.</span>}
              {layerItems.map((element, index) => {
                const id = element.getAttribute('data-object-id') ?? ''
                const hidden = element.getAttribute('visibility') === 'hidden'
                const locked = element.getAttribute('data-layer-locked') === 'true'
                const label = element.getAttribute('data-layer-name') ?? `${element.tagName.toLowerCase()} ${layerItems.length - index}`
                return <div key={id} className={`drawing-layer-row ${selectedIds.includes(id) ? 'selected' : ''}`}>
                  <button className="tool-button" onClick={() => select([id])} title="Zaznacz warstwę"><span className="drawing-layer-color" style={{ background: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#8490af' }} /></button>
                  <input aria-label={`Nazwa warstwy ${label}`} defaultValue={label} onBlur={event => changeLayer(id, item => item.setAttribute('data-layer-name', event.target.value.trim() || label))} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                  <button className="tool-button" onClick={() => changeLayer(id, item => item.setAttribute('visibility', hidden ? 'visible' : 'hidden'))} title={hidden ? 'Pokaż warstwę' : 'Ukryj warstwę'}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button className="tool-button" onClick={() => changeLayer(id, item => item.setAttribute('data-layer-locked', locked ? 'false' : 'true'))} title={locked ? 'Odblokuj warstwę' : 'Zablokuj warstwę'}>{locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                  <button className="tool-button" onClick={() => reorderLayer(id, 'front')} title="Przenieś na wierzch">↑</button>
                  <button className="tool-button" onClick={() => reorderLayer(id, 'back')} title="Przenieś na spód">↓</button>
                </div>
              })}
            </div>
          </div>}

          {activePanel === 'workflow' && <div className="drawing-workflow-grid">
            <section className="drawing-workflow-card"><h3><Waypoints size={15} />Połączenia i komentarze</h3>
              <label className="fill-toggle"><input type="checkbox" checked={autoRoute} onChange={event => applyRouteSetting(event.target.checked)} />Automatycznie omijaj figury dla strzałek</label>
              <button className="button secondary compact-feature-button" onClick={addComment}><MessageSquare size={14} />Dodaj komentarz do planszy</button>
              <p className="feature-help">Komentarze są zapisywane lokalnie na planszy i nie trafiają do wyeksportowanego SVG.</p>
              <div className="drawing-comment-list">{comments.map(comment => <div key={comment.id}><span>{comment.text}</span><button onClick={() => setComments(current => current.filter(item => item.id !== comment.id))} aria-label="Usuń komentarz"><X size={12} /></button></div>)}</div>
            </section>
            <section className="drawing-workflow-card"><h3><ImagePlus size={15} />Import i wektoryzacja</h3>
              <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { void importRaster(event.target.files?.[0]); event.currentTarget.value = '' }} />
              <button className="button secondary compact-feature-button" onClick={() => imageInput.current?.click()}><ImagePlus size={14} />Importuj obraz rastrowy</button>
              <label className="drawing-select-control"><span>Dokładność wektoryzacji</span><input type="range" min="8" max="80" step="4" value={vectorizeDetail} onChange={event => setVectorizeDetail(Number(event.target.value))} /><output>{vectorizeDetail}</output></label>
              <button className="button secondary compact-feature-button" onClick={() => { void vectorizeSelection() }} disabled={!selectedImage}>Zamień obraz na edytowalne kształty</button>
            </section>
            <section className="drawing-workflow-card"><h3><History size={15} />Historia i punkty kontrolne</h3>
              <button className="button secondary compact-feature-button" onClick={createCheckpoint}><Plus size={14} />Zapisz punkt kontrolny</button>
              <div className="drawing-checkpoint-list">{checkpoints.map(checkpoint => <div key={checkpoint.id}><button onClick={() => restoreCheckpoint(checkpoint)} title={checkpoint.label}>{checkpoint.label}</button><button onClick={() => setCheckpoints(current => current.filter(item => item.id !== checkpoint.id))} aria-label="Usuń punkt kontrolny"><X size={12} /></button></div>)}</div>
            </section>
            <section className="drawing-workflow-card"><h3><Download size={15} />Eksport</h3>
              <div className="drawing-feature-row"><label className="drawing-select-control"><span>Format</span><select value={exportFormat} onChange={event => setExportFormat(event.target.value as 'svg' | 'png')}><option value="svg">SVG</option><option value="png">PNG</option></select></label>
                <label className="geometry-control"><span>Szerokość</span><input type="number" min="1" max="4096" value={exportSize.width} onChange={event => setExportSize(current => ({ ...current, width: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                <label className="geometry-control"><span>Wysokość</span><input type="number" min="1" max="4096" value={exportSize.height} onChange={event => setExportSize(current => ({ ...current, height: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                {exportFormat === 'png' && <label className="fill-toggle"><input type="checkbox" checked={exportTransparent} onChange={event => setExportTransparent(event.target.checked)} />Przezroczyste tło</label>}
                <button className="button secondary compact-feature-button" onClick={() => { void downloadExport() }}><Download size={14} />Pobierz {exportFormat.toUpperCase()}</button>
              </div>
              {workflowMessage && <p className="feature-help" role="status">{workflowMessage}</p>}
            </section>
          </div>}
        </div>
        <div className="drawing-stage-wrap">
          <div className="drawing-canvas-area">
            <div ref={mount} className="drawing-stage" />
            {comments.map(comment => <div key={comment.id} className="drawing-comment-pin" style={{ left: `${comment.x / WIDTH * 100}%`, top: `${comment.y / HEIGHT * 100}%` }}>
              <button onClick={() => setActiveCommentId(activeCommentId === comment.id ? null : comment.id)} title={comment.text} aria-label="Pokaż komentarz"><MessageSquare size={13} /></button>
              {activeCommentId === comment.id && <div className="drawing-comment-popover">{comment.text}<button onClick={() => setComments(current => current.filter(item => item.id !== comment.id))}><X size={12} /></button></div>}
            </div>)}
            {commentDraft && <CommentComposer onSave={saveComment} onCancel={() => setCommentDraft(null)} />}
            {showMinimap && <div className="drawing-minimap" aria-label="Mini mapa planszy"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Podgląd całej planszy"><rect width={WIDTH} height={HEIGHT} fill="#fff" stroke="#ccd2df" />{miniObjects.map(item => <rect key={item.id} x={item.box.x} y={item.box.y} width={Math.max(2, item.box.width)} height={Math.max(2, item.box.height)} fill={item.color} opacity=".8" />)}</svg><span>{miniObjects.length} elementów</span></div>}
          </div>
        </div>
        <footer className="modal-footer advanced-modal-footer"><p>Pióro: klikaj węzły, przeciągaj uchwyty; Enter kończy ścieżkę. Pędzel wygładza szkice · Ctrl+G grupuje · Ctrl+Shift+G rozgrupowuje</p><div><button className="button secondary" onClick={onClose}>Anuluj</button><button className="button primary" onClick={save}>Zapisz grafikę</button></div></footer>
      </section>
    </div>
  )
}

function CommentComposer({ onSave, onCancel }: { onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  return <form className="drawing-comment-composer" onSubmit={event => { event.preventDefault(); onSave(value) }}>
    <label htmlFor="drawing-comment-text">Komentarz do planszy</label>
    <textarea id="drawing-comment-text" autoFocus value={value} onChange={event => setValue(event.target.value)} placeholder="Dodaj uwagę…" maxLength={600} />
    <div><button type="button" className="button secondary" onClick={onCancel}>Anuluj</button><button className="button primary" disabled={!value.trim()}>Dodaj</button></div>
  </form>
}
