import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AlignCenterHorizontal, AlignEndHorizontal, AlignStartHorizontal, ArrowDownWideNarrow, ArrowRight, Check, Combine, Eraser,
  ClipboardCopy, ClipboardPaste, Copy, Download, Eye, EyeOff, Grid3X3, Group, History, ImagePlus, Layers,
  Hand, Lasso, Lock, MessageSquare, Minus, MousePointer2, Palette, Pencil, Pipette, Plus, RectangleHorizontal,
  Redo2, RotateCw, Ruler, Shapes, Trash2, Type, Undo2, Ungroup, Unlock, Waypoints, X,
} from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'
import { shapeById, shapeCategories, shapeLibrary } from './shapeLibrary'
import { findGeometrySnap, lassoIntersectsBox, outlineOpenStroke, reversePathData } from './svgEditorGeometry'

type Tool = 'select' | 'pan' | 'lasso' | 'eraser' | 'shapeBuilder' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'freehand' | 'text' | 'pen'
type ArrowMode = 'end' | 'start' | 'both' | 'none'
type Box = { x: number; y: number; width: number; height: number }
type ViewBox = Box
type Point = { x: number; y: number; pressure?: number; tiltX?: number; tiltY?: number }
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type GeometryDraft = { x: string; y: string; width: string; height: string }
type Snap = { delta: number; target: number } | undefined
type Interaction =
  | { type: 'draw'; tool: Tool; element: any; id: string; x: number; y: number; keepTool: boolean; startTarget?: string; startAnchor?: string }
  | { type: 'freehand'; element: any; id: string; points: Point[]; pressureSensitive: boolean }
  | { type: 'eraser'; changed: boolean; last: Point }
  | { type: 'connect'; line: SVGLineElement; id: string; side: 'start' | 'end'; x: number; y: number; moved: boolean }
  | { type: 'move'; ids: string[]; elements: SVGElement[]; others: Box[]; startX: number; startY: number; lastX: number; lastY: number; bounds: Box; moved: boolean }
  | { type: 'resize'; ids: string[]; targets: { element: SVGElement; source: SVGElement; box: Box }[]; startBounds: Box; handle: ResizeHandle; moved: boolean }
  | { type: 'pen-node'; element: SVGPathElement; index: number; indices: number[]; handle: 'anchor' | 'incoming' | 'outgoing'; points: PenNode[]; moved: boolean }
  | { type: 'lasso'; points: Point[]; additive: boolean; initialIds: string[]; moved: boolean }
  | { type: 'gradient-handle'; element: SVGElement; gradient: SVGLinearGradientElement; index: 0 | 1 | 2; bounds: Box; moved: boolean }
  | { type: 'guide'; index: number; axis: 'x' | 'y'; moved: boolean; created?: boolean }
  | { type: 'pan'; startClientX: number; startClientY: number; viewBox: ViewBox }
  | { type: 'marquee'; x: number; y: number; additive: boolean; initialIds: string[]; moved: boolean }

type OverlayOptions = {
  marquee?: Box
  lasso?: Point[]
  dimensions?: Box
  snapX?: number
  snapY?: number
  movingBounds?: Box
  otherBounds?: Box[]
}

type EditorComment = { id: string; x: number; y: number; text: string }
type Checkpoint = { id: string; label: string; createdAt: number; content: string }
type MiniObject = { id: string; box: Box; color: string }
type EditorPanel = 'canvas' | 'style' | 'layers' | 'workflow' | null
type DocumentUnit = 'px' | 'mm' | 'in'
type EditorGuide = { axis: 'x' | 'y'; value: number; locked?: boolean }
type SvgLibraryItem = { id: string; name: string; markup: string; kind?: 'component' | 'template'; packageId?: string }
type SvgPalettePreset = { id: string; name: string; colors: string[] }
type StylusProfile = { smoothing: number; pressureSensitivity: number; tiltSensitivity: number; palmRejection: boolean }
type BrushPreset = { id: string; name: string; color: string; width: number; smoothing: number; pressureSensitivity: number; tiltSensitivity: number }
type EditorViewOptions = { grid: boolean; gridSize: number; snap: boolean; snapGeometry: boolean; smartGuides: boolean; rulers: boolean; guides: EditorGuide[] }

type TextEdit = { input: HTMLInputElement; x: number; y: number; element?: SVGElement; fontSize: number; keepTool: boolean; parent?: SVGElement; parentId?: string }
type Drawing = Svg
type PenNode = Point & { incoming?: Point; outgoing?: Point; mode?: 'smooth' | 'corner' | 'symmetric' }
type ActivePen = { id: string; element: SVGPathElement; points: PenNode[] }

const WIDTH = 800
const HEIGHT = 500
const SNAP_DISTANCE = 4
const MAX_FREEHAND_POINTS = 1600
const MIN_VIEW_EXTENT = .02
const MAX_VIEW_EXTENT = 10_000_000
const OBJECT_TAGS = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'use'])
const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_STYLUS_PROFILE: StylusProfile = { smoothing: .85, pressureSensitivity: 1, tiltSensitivity: 1, palmRejection: true }
const BUILTIN_BRUSH_PRESETS: BrushPreset[] = [
  { id: 'pencil', name: 'Ołówek', color: '#596fd8', width: 2, smoothing: .9, pressureSensitivity: 1.15, tiltSensitivity: .7 },
  { id: 'marker', name: 'Marker', color: '#2b9a83', width: 8, smoothing: .35, pressureSensitivity: .45, tiltSensitivity: 1.5 },
]

function readLocalJson<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback } catch { return fallback }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1200)
}

function readViewBox(stage: SVGSVGElement): ViewBox {
  const values = (stage.getAttribute('viewBox') ?? `0 0 ${WIDTH} ${HEIGHT}`).split(/[ ,]+/).map(Number)
  return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
    ? { x: values[0], y: values[1], width: values[2], height: values[3] }
    : { x: 0, y: 0, width: WIDTH, height: HEIGHT }
}

function colorContrastOnWhite(value: string): number | undefined {
  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)
  if (!match) return undefined
  const hex = match[1].length === 3 ? match[1].split('').map(character => character + character).join('') : match[1]
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
  return 1.05 / (luminance + .05)
}

function canConnectToPort(element: SVGElement | undefined, side: 'start' | 'end'): boolean {
  const type = element?.getAttribute('data-connector-port') ?? 'free'
  return type === 'free' || type === 'both' || (side === 'start' ? type === 'output' : type === 'input')
}

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
    const control1 = start.mode === 'corner' ? start : start.outgoing ?? { x: start.x + (end.x - previous.x) / 6, y: start.y + (end.y - previous.y) / 6 }
    const control2 = end.mode === 'corner' ? end : end.incoming ?? { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 }
    path += ` C ${rounded(control1.x)} ${rounded(control1.y)} ${rounded(control2.x)} ${rounded(control2.y)} ${rounded(end.x)} ${rounded(end.y)}`
  }
  return path
}

function smoothStroke(points: Point[], smoothing = 1): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${rounded(points[0].x)} ${rounded(points[0].y)} l 0.1 0`
  let path = `M ${rounded(points[0].x)} ${rounded(points[0].y)}`
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)]
    const start = points[index]
    const end = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const tension = Math.max(0, Math.min(1.5, smoothing)) / 6
    const control1 = { x: start.x + (end.x - previous.x) * tension, y: start.y + (end.y - previous.y) * tension }
    const control2 = { x: end.x - (next.x - start.x) * tension, y: end.y - (next.y - start.y) * tension }
    path += ` C ${rounded(control1.x)} ${rounded(control1.y)} ${rounded(control2.x)} ${rounded(control2.y)} ${rounded(end.x)} ${rounded(end.y)}`
  }
  return path
}

function pressureStroke(points: Point[], width: number, sensitivity = 1, tiltSensitivity = 1): string {
  if (!points.length) return ''
  const roundedPoint = (value: number) => Number(value.toFixed(2))
  if (points.length === 1) {
    const pressure = Math.max(.08, Math.min(1, .5 + ((points[0].pressure ?? .5) - .5) * sensitivity))
    const tilt = Math.min(1, Math.hypot(points[0].tiltX ?? 0, points[0].tiltY ?? 0) / 90)
    const radius = Math.max(.1, width * (.18 + pressure * 1.22) / 2 * (1 + tilt * tiltSensitivity * .32))
    const x = roundedPoint(points[0].x); const y = roundedPoint(points[0].y); const r = roundedPoint(radius)
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`
  }
  const left: Point[] = []
  const right: Point[] = []
  points.forEach((point, index) => {
    const before = points[Math.max(0, index - 1)]
    const after = points[Math.min(points.length - 1, index + 1)]
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy) || 1
    const pressure = Math.max(.08, Math.min(1, .5 + ((point.pressure ?? .5) - .5) * sensitivity))
    const baseRadius = Math.max(.1, width * (.18 + pressure * 1.22) / 2)
    const tilt = Math.min(1, Math.hypot(point.tiltX ?? 0, point.tiltY ?? 0) / 90)
    const tiltAngle = Math.atan2(point.tiltY ?? 0, point.tiltX ?? 0)
    const normalAngle = Math.atan2(-dx, dy)
    const alignment = Math.cos(normalAngle - tiltAngle)
    const majorRadius = baseRadius * (1 + tilt * tiltSensitivity)
    const minorRadius = baseRadius * Math.max(.45, 1 - tilt * tiltSensitivity * .3)
    const radius = Math.sqrt((majorRadius * alignment) ** 2 + (minorRadius * Math.sqrt(Math.max(0, 1 - alignment ** 2))) ** 2)
    const nx = -dy / length * radius
    const ny = dx / length * radius
    left.push({ x: point.x + nx, y: point.y + ny })
    right.push({ x: point.x - nx, y: point.y - ny })
  })
  return [...left, ...right.reverse()].map((point, index) => `${index ? 'L' : 'M'} ${roundedPoint(point.x)} ${roundedPoint(point.y)}`).join(' ') + ' Z'
}

function appendFreehandSample(points: Point[], next: Point, minDistance: number) {
  const last = points.at(-1)
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < minDistance) return
  points.push(next)
  if (points.length <= MAX_FREEHAND_POINTS) return

  // Keep the whole path and its newest point while bounding redraw cost on long strokes.
  const newest = points.at(-1)!
  const reduced = points.filter((_point, index) => index % 2 === 0)
  if (reduced.at(-1) !== newest) reduced.push(newest)
  points.splice(0, points.length, ...reduced)
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
  const rawPointData = element.getAttribute('data-freehand-points')
  if (rawPointData) {
    try {
      const parsed = JSON.parse(rawPointData) as Point[] | Point[][]
      const groups = Array.isArray(parsed[0]) ? parsed as Point[][] : [parsed as Point[]]
      element.setAttribute('data-freehand-points', JSON.stringify(groups.map(points => points.map(point => ({ ...point, x: point.x + deltaX, y: point.y + deltaY })))))
    } catch { /* The visible path can still move if its optional eraser cache is damaged. */ }
  }
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

function checkpointDiffPreview(currentContent: string, priorContent: string, width: number, height: number): string {
  const parse = (content: string) => new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${content}</svg>`, 'image/svg+xml').documentElement
  const current = parse(currentContent); const prior = parse(priorContent)
  const directElements = (root: Element) => Array.from(root.children).filter((element): element is SVGElement => element instanceof SVGElement && OBJECT_TAGS.has(element.tagName.toLowerCase()))
  const currentObjects = directElements(current); const priorObjects = directElements(prior)
  const byId = (objects: SVGElement[]) => new Map(objects.map((element, index) => [element.getAttribute('data-object-id') || `old-index-${index}`, element]))
  const oldById = byId(priorObjects); const newById = byId(currentObjects)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS); svg.setAttribute('width', `${width}`); svg.setAttribute('height', `${height}`); svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const oldDefs = prior.querySelector('defs')
  const newDefs = current.querySelector('defs')
  if (newDefs) svg.append(newDefs.cloneNode(true))
  else if (oldDefs) svg.append(oldDefs.cloneNode(true))
  currentObjects.forEach((object, index) => {
    const id = object.getAttribute('data-object-id') || `old-index-${index}`
    const old = oldById.get(id)
    const clone = object.cloneNode(true) as SVGElement
    const state = !old ? 'dodano' : old.outerHTML === object.outerHTML ? 'bez-zmian' : 'zmieniono'
    clone.setAttribute('data-porownanie', state)
    if (state === 'bez-zmian') clone.style.setProperty('opacity', '.16', 'important')
    else {
      clone.style.setProperty('stroke', state === 'dodano' ? '#188866' : '#d38a18', 'important')
      clone.style.setProperty('stroke-width', '4', 'important')
      clone.style.setProperty('stroke-dasharray', state === 'dodano' ? 'none' : '7 4', 'important')
    }
    svg.append(clone)
  })
  priorObjects.forEach((object, index) => {
    const id = object.getAttribute('data-object-id') || `old-index-${index}`
    if (newById.has(id)) return
    const clone = object.cloneNode(true) as SVGElement
    clone.setAttribute('data-porownanie', 'usunieto')
    clone.style.setProperty('opacity', '.75', 'important')
    clone.style.setProperty('stroke', '#ce4b58', 'important')
    clone.style.setProperty('stroke-width', '4', 'important')
    clone.style.setProperty('stroke-dasharray', '5 4', 'important')
    svg.append(clone)
  })
  return sanitizeSvg(new XMLSerializer().serializeToString(svg))
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

function extendsDocument(bounds: Box | undefined, size: { width: number; height: number }): boolean {
  if (!bounds) return false
  const tolerance = .5
  return bounds.x < -tolerance || bounds.y < -tolerance
    || bounds.x + bounds.width > size.width + tolerance
    || bounds.y + bounds.height > size.height + tolerance
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
  stage.querySelectorAll<SVGLineElement>('line[data-start-target], line[data-end-target], line[data-auto-route="true"], line[data-connector-label]').forEach(line => {
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
    const lineId = line.getAttribute('data-object-id') ?? line.parentElement?.closest('[data-object-id]')?.getAttribute('data-object-id')
    const routeEnabled = line.getAttribute('data-auto-route') === 'true'
    const routeStyle = line.getAttribute('data-route-style') ?? 'orthogonal'
    const hasLabel = Boolean(line.getAttribute('data-connector-label')?.trim())
    const existingRoute = lineId ? stage.querySelector<SVGPathElement>(`[data-connector-visual-for="${CSS.escape(lineId)}"]`) : null
    if ((!routeEnabled && !hasLabel) || !lineId) {
      existingRoute?.remove()
      if (lineId) stage.querySelector(`[data-connector-label-for="${CSS.escape(lineId)}"]`)?.remove()
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
    const route = routeStyle === 'straight' ? [startPoint, endPoint] : routes.sort((a, b) => score(a) - score(b))[0]
    let pathData = route.map((point, index) => `${index ? 'L' : 'M'} ${rounded(point.x)} ${rounded(point.y)}`).join(' ')
    if (routeStyle === 'rounded' && route.length > 2) {
      const parts = [`M ${rounded(route[0].x)} ${rounded(route[0].y)}`]
      for (let index = 1; index < route.length - 1; index++) {
        const previous = route[index - 1]; const corner = route[index]; const next = route[index + 1]
        const radius = Math.min(12, Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2)
        const before = { x: corner.x + (previous.x - corner.x) * radius / Math.max(radius, Math.hypot(previous.x - corner.x, previous.y - corner.y)), y: corner.y + (previous.y - corner.y) * radius / Math.max(radius, Math.hypot(previous.x - corner.x, previous.y - corner.y)) }
        const after = { x: corner.x + (next.x - corner.x) * radius / Math.max(radius, Math.hypot(next.x - corner.x, next.y - corner.y)), y: corner.y + (next.y - corner.y) * radius / Math.max(radius, Math.hypot(next.x - corner.x, next.y - corner.y)) }
        parts.push(`L ${rounded(before.x)} ${rounded(before.y)} Q ${rounded(corner.x)} ${rounded(corner.y)} ${rounded(after.x)} ${rounded(after.y)}`)
      }
      parts.push(`L ${rounded(route.at(-1)!.x)} ${rounded(route.at(-1)!.y)}`)
      pathData = parts.join(' ')
    }
    const visual = existingRoute ?? document.createElementNS(SVG_NS, 'path')
    visual.setAttribute('data-connector-visual-for', lineId)
    visual.setAttribute('id', `connector-route-${lineId}`)
    visual.setAttribute('d', pathData)
    visual.setAttribute('fill', 'none')
    visual.setAttribute('stroke', routeEnabled ? (line.getAttribute('stroke') ?? '#596fd8') : 'none')
    visual.setAttribute('stroke-width', line.getAttribute('stroke-width') ?? '3')
    visual.setAttribute('stroke-linecap', 'round')
    visual.setAttribute('stroke-linejoin', 'round')
    for (const side of ['start', 'end'] as const) {
      const marker = line.getAttribute(`marker-${side}`)
      if (marker) visual.setAttribute(`marker-${side}`, marker)
      else visual.removeAttribute(`marker-${side}`)
    }
    if (!existingRoute) stage.append(visual)
    if (routeEnabled) line.setAttribute('stroke-opacity', '0')
    else line.removeAttribute('stroke-opacity')
    if (hasLabel) {
      const label = stage.querySelector<SVGTextElement>(`[data-connector-label-for="${CSS.escape(lineId)}"]`) ?? document.createElementNS(SVG_NS, 'text')
      label.setAttribute('data-connector-label-for', lineId); label.setAttribute('data-object-id', `connector-label-${lineId}`)
      label.setAttribute('fill', line.getAttribute('stroke') ?? '#39445e'); label.setAttribute('font-size', '13'); label.setAttribute('pointer-events', 'all')
      let textPath = label.querySelector('textPath')
      if (!textPath) { textPath = document.createElementNS(SVG_NS, 'textPath'); textPath.setAttribute('startOffset', '50%'); textPath.setAttribute('text-anchor', 'middle'); label.append(textPath) }
      textPath.setAttribute('href', `#connector-route-${lineId}`); textPath.textContent = line.getAttribute('data-connector-label') ?? ''
      if (!label.parentNode) stage.append(label)
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

function getSnap(bounds: Box, others: Box[], axis: 'x' | 'y', reference: Box = { x: 0, y: 0, width: WIDTH, height: HEIGHT }): Snap {
  const isX = axis === 'x'
  const start = isX ? bounds.x : bounds.y
  const size = isX ? bounds.width : bounds.height
  const movingPoints = [start, start + size / 2, start + size]
  const targetPoints = others.flatMap(box => {
    const targetStart = isX ? box.x : box.y
    const targetSize = isX ? box.width : box.height
    return [targetStart, targetStart + targetSize / 2, targetStart + targetSize]
  })
  const referenceStart = isX ? reference.x : reference.y
  const referenceSize = isX ? reference.width : reference.height
  targetPoints.push(referenceStart, referenceStart + referenceSize / 2, referenceStart + referenceSize)

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
  const viewport = readViewBox(stage.node)
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
    layer.rect(viewport.width, viewport.height).move(viewport.x, viewport.y).fill(`url(#${patternId})`)
  }
  const guides = (() => { try { return JSON.parse(stage.node.getAttribute('data-editor-guides') ?? '[]') as EditorGuide[] } catch { return [] } })()
  const selectedPenNodeValue = stage.node.getAttribute('data-selected-pen-node')
  const selectedPenNode = selectedPenNodeValue === null ? -1 : Number(selectedPenNodeValue)
  const selectedPenNodes = (() => { try { return new Set(JSON.parse(stage.node.getAttribute('data-selected-pen-nodes') ?? '[]') as number[]) } catch { return new Set([selectedPenNode]) } })()
  guides.forEach((guide, index) => {
    const line = guide.axis === 'x'
      ? layer.line(guide.value, viewport.y, guide.value, viewport.y + viewport.height)
      : layer.line(viewport.x, guide.value, viewport.x + viewport.width, guide.value)
    line.stroke({ color: '#e3518b', width: 1, dasharray: '5 4' }).attr({ 'data-editor-guide-index': `${index}`, 'pointer-events': guide.locked ? 'none' : 'stroke', cursor: guide.locked ? 'default' : (guide.axis === 'x' ? 'ew-resize' : 'ns-resize') })
  })
  if (stage.node.getAttribute('data-editor-rulers') === 'true') {
    const step = Math.max(10, Math.pow(10, Math.floor(Math.log10(Math.max(viewport.width / 8, 1)))) / 2)
    const firstX = Math.ceil(viewport.x / step) * step
    const firstY = Math.ceil(viewport.y / step) * step
    layer.rect(viewport.width, 15).move(viewport.x, viewport.y).fill('#f6f7fb').attr({ 'data-ruler-axis': 'y', 'pointer-events': 'all', cursor: 'crosshair' })
    layer.rect(19, viewport.height).move(viewport.x, viewport.y).fill('#f6f7fb').attr({ 'data-ruler-axis': 'x', 'pointer-events': 'all', cursor: 'crosshair' })
    for (let x = firstX; x <= viewport.x + viewport.width; x += step) {
      layer.line(x, viewport.y, x, viewport.y + 9).stroke({ color: '#8992a6', width: 1 })
      layer.text(`${rounded(x)}`).font({ family: 'sans-serif', size: 8 }).fill('#737d93').move(x + 2, viewport.y + 2)
    }
    for (let y = firstY; y <= viewport.y + viewport.height; y += step) {
      layer.line(viewport.x, y, viewport.x + 9, y).stroke({ color: '#8992a6', width: 1 })
      layer.text(`${rounded(y)}`).font({ family: 'sans-serif', size: 8 }).fill('#737d93').move(viewport.x + 2, y + 2)
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
        layer.circle(10).center(point.x, point.y).fill(selectedPenNodes.has(index) || index === selectedPenNode ? '#d9f8ef' : '#fff').stroke({ color: selectedPenNodes.has(index) || index === selectedPenNode ? '#159879' : '#5066d2', width: 1.7 })
          .attr({ 'data-pen-node': `${index}`, 'data-pen-object': element.getAttribute('data-object-id') ?? '', 'pointer-events': 'all', cursor: 'move' })
      })
    }
    if (stage.node.getAttribute('data-active-tool') === 'select') {
      const gradientId = element.getAttribute('fill')?.match(/^url\(["']?#([^\s)'\"]+)["']?\)$/)?.[1]
      const gradient = gradientId ? stage.node.querySelector<SVGLinearGradientElement>(`linearGradient[id="${CSS.escape(gradientId)}"]`) : null
      if (gradient) {
        const objectBox = gradient.getAttribute('gradientUnits') !== 'userSpaceOnUse'
        const coordinate = (attribute: string, base: number, size: number, fallback: number) => {
          const value = gradient.getAttribute(attribute)
          if (value === null) return fallback
          if (value.endsWith('%')) return objectBox ? base + size * Number.parseFloat(value) / 100 : size * Number.parseFloat(value) / 100
          const number = Number(value)
          return objectBox ? base + size * number : number
        }
        const start = {
          x: coordinate('x1', box.x, box.width, box.x),
          y: coordinate('y1', box.y, box.height, box.y),
        }
        const end = {
          x: coordinate('x2', box.x, box.width, box.x + box.width),
          y: coordinate('y2', box.y, box.height, box.y),
        }
        layer.line(start.x, start.y, end.x, end.y).stroke({ color: '#5369d2', width: 1.5, dasharray: '4 3' })
        const stops = Array.from(gradient.querySelectorAll('stop'))
        const middle = stops[1]
        const offset = Number.parseFloat(middle?.getAttribute('offset') ?? '50') / (middle?.getAttribute('offset')?.endsWith('%') === false ? 1 : 100)
        const stopPoint = { x: start.x + (end.x - start.x) * offset, y: start.y + (end.y - start.y) * offset }
        for (const [index, point] of [[0, start], [2, end], [1, stopPoint]] as const) {
          layer.circle(index === 1 ? 9 : 11).center(point.x, point.y).fill(index === 1 ? (middle?.getAttribute('stop-color') ?? '#fff') : '#fff')
            .stroke({ color: '#5369d2', width: 2 }).attr({ 'data-gradient-handle': `${index}`, 'data-gradient-object': element.getAttribute('data-object-id') ?? '', 'pointer-events': 'all', cursor: 'move' })
        }
      }
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
  const selectedLines = elementsForIds(stage.node, ids).flatMap(element => {
    if (element.tagName.toLowerCase() === 'line') return [element as SVGLineElement]
    return Array.from(element.children).filter(child => child.tagName.toLowerCase() === 'line') as SVGLineElement[]
  })
  const showTargetAnchors = stage.node.hasAttribute('data-connector-dragging')
  const anchorElements = (showTargetAnchors ? directObjects(stage.node) : elementsForIds(stage.node, ids))
    .filter(element => !['line', 'text'].includes(element.tagName.toLowerCase()))
  for (const element of anchorElements) {
    const id = element.getAttribute('data-object-id')
    if (!id) continue
    for (const name of anchorNames()) {
      const point = anchorPosition(element, name)
      if (!point) continue
      const port = element.getAttribute('data-connector-port') ?? 'free'
      const color = port === 'input' ? '#2b9a83' : port === 'output' ? '#e76c75' : port === 'both' ? '#8a5bc2' : '#6879db'
      layer.circle(8).center(point.x, point.y).fill('#ffffff').stroke({ color, width: 1.7 })
        .attr({ 'data-anchor-target': id, 'data-anchor': name, 'data-port-type': port, 'pointer-events': 'all', cursor: 'crosshair', 'aria-label': `${port} port ${name}` })
    }
  }
  if (activeTool === 'select' && !stage.node.hasAttribute('data-connector-dragging')) {
    for (const line of selectedLines) {
      const id = line.getAttribute('data-object-id')
      if (!id) continue
      for (const side of ['start', 'end'] as const) {
        const x = Number(line.getAttribute(side === 'start' ? 'x1' : 'x2'))
        const y = Number(line.getAttribute(side === 'start' ? 'y1' : 'y2'))
        const lineId = line.getAttribute('data-object-id') ?? line.parentElement?.closest('[data-object-id]')?.getAttribute('data-object-id')
        if (!lineId) continue
        layer.circle(12).center(x, y).fill('#fff').stroke({ color: '#25a68a', width: 2 })
          .attr({ 'data-connector-handle': lineId, 'data-connector-side': side, 'pointer-events': 'all', cursor: 'crosshair' })
      }
    }
  }
  if (options.marquee) {
    const box = options.marquee
    layer.rect(box.width, box.height).move(box.x, box.y).fill('#7587e51c').stroke({ color: '#6378dd', width: 1.5, dasharray: '6 4' })
  }
  if (options.lasso?.length) {
    const points = [...options.lasso, ...(options.lasso.length > 2 ? [options.lasso[0]] : [])]
    layer.polyline(points.map(point => `${point.x},${point.y}`).join(' ')).fill('#7587e51c')
      .stroke({ color: '#6378dd', width: 1.5, dasharray: '6 4', linejoin: 'round' })
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
  if (options.snapX !== undefined) layer.line(options.snapX, viewport.y, options.snapX, viewport.y + viewport.height).stroke({ color: '#e25b91', width: 1.5, dasharray: '5 5' })
  if (options.snapY !== undefined) layer.line(viewport.x, options.snapY, viewport.x + viewport.width, options.snapY).stroke({ color: '#e25b91', width: 1.5, dasharray: '5 5' })
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

function resizedBounds(start: Box, handle: ResizeHandle, point: { x: number; y: number }, keepSquare = false, aspectRatio?: number): Box {
  if (keepSquare || aspectRatio) {
    const ratio = keepSquare ? 1 : Math.max(.1, aspectRatio ?? start.width / Math.max(start.height, .1))
    const centerX = start.x + start.width / 2
    const centerY = start.y + start.height / 2
    const hasX = handle.includes('w') || handle.includes('e')
    const hasY = handle.includes('n') || handle.includes('s')
    const anchorX = handle.includes('w') ? start.x + start.width : start.x
    const anchorY = handle.includes('n') ? start.y + start.height : start.y
    const rawWidth = hasX ? Math.abs(point.x - anchorX) : start.width
    const rawHeight = hasY ? Math.abs(point.y - anchorY) : start.height
    const width = Math.max(.1, hasX && hasY ? Math.max(rawWidth, rawHeight * ratio) : hasX ? rawWidth : rawHeight * ratio)
    const height = width / ratio
    return {
      x: hasX ? (handle.includes('w') ? anchorX - width : anchorX) : centerX - width / 2,
      y: hasY ? (handle.includes('n') ? anchorY - height : anchorY) : centerY - height / 2,
      width,
      height,
    }
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
  const interactionPointerId = useRef<number | null>(null)
  const activeStylusPointerId = useRef<number | null>(null)
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
  const smartShapeIdRef = useRef('auto')
  const smartDrawingRef = useRef(true)
  const strokeColorRef = useRef('#596fd8')
  const fillColorRef = useRef('#dfe4ff')
  const fillEnabledRef = useRef(true)
  const strokeWidthRef = useRef(3)
  const fontSizeRef = useRef(24)
  const polygonSidesRef = useRef(6)
  const arrowModeRef = useRef<ArrowMode>('end')
  const viewBoxRef = useRef<ViewBox>({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
  const documentSizeRef = useRef({ width: WIDTH, height: HEIGHT })
  const spacePanRef = useRef(false)
  const viewOptionsRef = useRef<EditorViewOptions>({ grid: false, gridSize: 20, snap: false, snapGeometry: false, smartGuides: true, rulers: false, guides: [] })
  const autoRouteRef = useRef(false)
  const eyedropperRef = useRef(false)
  const fontFamilyRef = useRef('Inter, sans-serif')
  const fontWeightRef = useRef('600')
  const textAlignRef = useRef('start')
  const fontItalicRef = useRef(false)
  const smoothingRef = useRef(DEFAULT_STYLUS_PROFILE.smoothing)
  const pressureSensitivityRef = useRef(DEFAULT_STYLUS_PROFILE.pressureSensitivity)
  const tiltSensitivityRef = useRef(DEFAULT_STYLUS_PROFILE.tiltSensitivity)
  const palmRejectionRef = useRef(DEFAULT_STYLUS_PROFILE.palmRejection)
  const eraserSizeRef = useRef(18)
  const eraserModeRef = useRef<'partial' | 'whole'>('partial')
  const [activePanel, setActivePanel] = useState<EditorPanel>('canvas')
  const [shapeLibraryOpen, setShapeLibraryOpen] = useState(false)
  const [infiniteCanvas, setInfiniteCanvas] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [smartShapeId, setSmartShapeId] = useState('auto')
  const [smartDrawing, setSmartDrawing] = useState(true)
  const [strokeColor, setStrokeColor] = useState('#596fd8')
  const [fillColor, setFillColor] = useState('#dfe4ff')
  const [fillEnabled, setFillEnabled] = useState(true)
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [eraserSize, setEraserSize] = useState(18)
  const [eraserMode, setEraserMode] = useState<'partial' | 'whole'>('partial')
  const [stylusProfile, setStylusProfile] = useState<StylusProfile>(() => ({ ...DEFAULT_STYLUS_PROFILE, ...readLocalJson<Partial<StylusProfile>>('no-tie-svg-stylus-profile', {}) }))
  const [brushPresets, setBrushPresets] = useState<BrushPreset[]>(() => {
    const saved = readLocalJson<unknown>('no-tie-svg-brush-presets', [])
    if (!Array.isArray(saved)) return []
    return (saved as Partial<BrushPreset>[]).filter((item): item is BrushPreset => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.color === 'string' && /^#[\da-f]{6}$/i.test(item.color) && Number.isFinite(item.width) && Number.isFinite(item.smoothing) && Number.isFinite(item.pressureSensitivity) && Number.isFinite(item.tiltSensitivity))).map(item => ({ ...item, width: Math.max(.5, Math.min(24, item.width)), smoothing: Math.max(0, Math.min(1.5, item.smoothing)), pressureSensitivity: Math.max(0, Math.min(2, item.pressureSensitivity)), tiltSensitivity: Math.max(0, Math.min(2, item.tiltSensitivity)) }))
  })
  const [brushPresetId, setBrushPresetId] = useState('current')
  const [brushPresetName, setBrushPresetName] = useState('')
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
  const [exportFormat, setExportFormat] = useState<'svg' | 'png' | 'pdf'>('svg')
  const [exportTransparent, setExportTransparent] = useState(true)
  const [vectorizeDetail, setVectorizeDetail] = useState(32)
  const [workflowMessage, setWorkflowMessage] = useState('')
  const [showMinimap, setShowMinimap] = useState(true)
  const [viewBox, setViewBox] = useState<ViewBox>(viewBoxRef.current)
  const [documentSize, setDocumentSize] = useState({ width: WIDTH, height: HEIGHT })
  const [documentUnit, setDocumentUnit] = useState<DocumentUnit>('px')
  const [lockDocumentRatio, setLockDocumentRatio] = useState(true)
  const documentRatio = useRef(WIDTH / HEIGHT)
  const shortcutKeyRef = useRef('p')
  const [guideLockAll, setGuideLockAll] = useState(false)
  const [selectedPenNodeIndex, setSelectedPenNodeIndex] = useState<number | null>(null)
  const [selectedPenNodeIndices, setSelectedPenNodeIndices] = useState<number[]>([])
  const selectedPenNodeIndicesRef = useRef<number[]>([])
  const selectedPenPathIdRef = useRef<string | null>(null)
  const [penNodeMode, setPenNodeMode] = useState<'smooth' | 'corner' | 'symmetric'>('smooth')
  const [cornerRadius, setCornerRadius] = useState(8)
  const [fillRule, setFillRule] = useState<'nonzero' | 'evenodd'>('nonzero')
  const [letterSpacing, setLetterSpacing] = useState('0')
  const [lineHeight, setLineHeight] = useState('1.2')
  const [baselineShift, setBaselineShift] = useState('0')
  const [textPathOffset, setTextPathOffset] = useState(0)
  const [textPathAnchor, setTextPathAnchor] = useState<'start' | 'middle' | 'end'>('start')
  const [textPathSide, setTextPathSide] = useState<'left' | 'right'>('left')
  const [textPathDistance, setTextPathDistance] = useState(0)
  const [blendMode, setBlendMode] = useState('normal')
  const [patternTileSize, setPatternTileSize] = useState(16)
  const [patternStrokeWidth, setPatternStrokeWidth] = useState(2)
  const [patternBackground, setPatternBackground] = useState('')
  const [fontSwapSource, setFontSwapSource] = useState('')
  const [fontSwapTarget, setFontSwapTarget] = useState('Inter, sans-serif')
  const [colorNameDraft, setColorNameDraft] = useState('')
  const [replaceColorSource, setReplaceColorSource] = useState('#ffffff')
  const [namedColors, setNamedColors] = useState<{ name: string; color: string }[]>([])
  const [imageBrightness, setImageBrightness] = useState(100)
  const [imageContrast, setImageContrast] = useState(100)
  const [imageSaturation, setImageSaturation] = useState(100)
  const [linkedImageId, setLinkedImageId] = useState('')
  const [compareCheckpointId, setCompareCheckpointId] = useState('')
  const [shapeBuilderOperation, setShapeBuilderOperation] = useState<'union' | 'subtract' | 'intersect' | 'exclude'>('union')
  const [assetLibrary, setAssetLibrary] = useState<SvgLibraryItem[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('no-tie-svg-assets') ?? '[]')
      return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.markup === 'string').map(item => ({ ...item, kind: item.kind === 'template' ? 'template' as const : 'component' as const })) : []
    } catch { return [] }
  })
  const [assetNameDraft, setAssetNameDraft] = useState('')
  const [gradientKind, setGradientKind] = useState<'linear' | 'radial'>('linear')
  const [gradientAngle, setGradientAngle] = useState(45)
  const [gradientMiddle, setGradientMiddle] = useState('#9daaf5')
  const [connectorStyle, setConnectorStyle] = useState<'straight' | 'orthogonal' | 'rounded'>('orthogonal')
  const [connectorLabel, setConnectorLabel] = useState('')
  const [connectorPortType, setConnectorPortType] = useState<'free' | 'input' | 'output' | 'both'>('free')
  const [groupConstraint, setGroupConstraint] = useState<'free' | 'aspect'>('free')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [accessibilityReport, setAccessibilityReport] = useState<string[]>([])
  const [optimizationEnabled, setOptimizationEnabled] = useState(true)
  const [layoutDirection, setLayoutDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const [layoutSpacing, setLayoutSpacing] = useState(56)
  const [documentA11yTitle, setDocumentA11yTitle] = useState(asset?.fileName?.replace(/\.svg$/i, '') ?? 'Schemat')
  const [documentA11yDescription, setDocumentA11yDescription] = useState('Diagram utworzony w edytorze SVG.')
  const [paletteNameDraft, setPaletteNameDraft] = useState('')
  const [paletteDraftColors, setPaletteDraftColors] = useState(['#596fd8', '#e76c75', '#2b9a83', '#f0a84b', '#8a5bc2', '#3e8cc9'])
  const [activePaletteId, setActivePaletteId] = useState('')
  const [customPalettes, setCustomPalettes] = useState<SvgPalettePreset[]>(() => readLocalJson('no-tie-svg-palettes', []))
  const [offsetDistance, setOffsetDistance] = useState(4)
  const [patternKind, setPatternKind] = useState<'dots' | 'lines' | 'diagonal'>('dots')
  const [optimizationReport, setOptimizationReport] = useState('')
  const [accessibilityOpen, setAccessibilityOpen] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<{ fill: string; stroke: string; strokeWidth: string; opacity: string; fontSize: string; fontFamily: string } | null>(null)
  const [stylePresets, setStylePresets] = useState<{ name: string; fill: string; stroke: string; strokeWidth: string; opacity: string; fontSize: string; fontFamily: string }[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('no-tie-svg-style-presets') ?? '[]')
      return Array.isArray(stored) ? stored.filter(item => item && typeof item.name === 'string' && typeof item.fill === 'string' && typeof item.stroke === 'string') : []
    } catch { return [] }
  })
  const [shortcutKey, setShortcutKey] = useState(() => {
    try { return localStorage.getItem('no-tie-svg-command-shortcut') || 'p' } catch { return 'p' }
  })
  const imageInput = useRef<HTMLInputElement>(null)
  const replaceImageInput = useRef<HTMLInputElement>(null)
  const linkImageInput = useRef<HTMLInputElement>(null)
  const editorSessionId = useRef('')
  if (!editorSessionId.current) editorSessionId.current = crypto.randomUUID()
  const storageId = asset?.id ?? editorSessionId.current
  const [loadedCommentsKey, setLoadedCommentsKey] = useState('')
  const [loadedCheckpointsKey, setLoadedCheckpointsKey] = useState('')
  const [loadedColorsKey, setLoadedColorsKey] = useState('')

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { smartShapeIdRef.current = smartShapeId }, [smartShapeId])
  useEffect(() => { smartDrawingRef.current = smartDrawing }, [smartDrawing])
  useEffect(() => { strokeColorRef.current = strokeColor }, [strokeColor])
  useEffect(() => { fillColorRef.current = fillColor }, [fillColor])
  useEffect(() => { fillEnabledRef.current = fillEnabled }, [fillEnabled])
  useEffect(() => { strokeWidthRef.current = strokeWidth }, [strokeWidth])
  useEffect(() => { eraserSizeRef.current = eraserSize }, [eraserSize])
  useEffect(() => { eraserModeRef.current = eraserMode }, [eraserMode])
  useEffect(() => { fontSizeRef.current = fontSize }, [fontSize])
  useEffect(() => { polygonSidesRef.current = polygonSides }, [polygonSides])
  useEffect(() => { arrowModeRef.current = arrowMode }, [arrowMode])
  useEffect(() => { viewOptionsRef.current = viewOptions }, [viewOptions])
  useEffect(() => { documentSizeRef.current = documentSize }, [documentSize])
  useEffect(() => { shortcutKeyRef.current = shortcutKey }, [shortcutKey])
  useEffect(() => { autoRouteRef.current = autoRoute }, [autoRoute])
  useEffect(() => { fontFamilyRef.current = fontFamily }, [fontFamily])
  useEffect(() => { fontWeightRef.current = fontWeight }, [fontWeight])
  useEffect(() => { textAlignRef.current = textAlign }, [textAlign])
  useEffect(() => { fontItalicRef.current = fontItalic }, [fontItalic])
  useEffect(() => {
    smoothingRef.current = stylusProfile.smoothing
    pressureSensitivityRef.current = stylusProfile.pressureSensitivity
    tiltSensitivityRef.current = stylusProfile.tiltSensitivity
    palmRejectionRef.current = stylusProfile.palmRejection
    try { localStorage.setItem('no-tie-svg-stylus-profile', JSON.stringify(stylusProfile)) } catch { /* The active profile remains available in memory. */ }
  }, [stylusProfile])
  useEffect(() => {
    try { localStorage.setItem('no-tie-svg-brush-presets', JSON.stringify(brushPresets.slice(-20))) } catch { /* Presets remain available during this editor session. */ }
  }, [brushPresets])
  useEffect(() => { eyedropperRef.current = eyedropper; if (drawing.current) renderOverlay(drawing.current, selectedIdsRef.current) }, [eyedropper])

  useEffect(() => {
    const stage = drawing.current?.node
    if (!stage) return
    stage.setAttribute('data-editor-grid', `${viewOptions.grid}`)
    stage.setAttribute('data-editor-grid-size', `${viewOptions.gridSize}`)
    stage.setAttribute('data-editor-smart-guides', `${viewOptions.smartGuides}`)
    stage.setAttribute('data-editor-rulers', `${viewOptions.rulers}`)
    stage.setAttribute('data-editor-guides', JSON.stringify(viewOptions.guides))
    renderOverlay(drawing.current!, selectedIdsRef.current)
  }, [viewOptions])

  useEffect(() => {
    viewBoxRef.current = viewBox
    const stage = drawing.current
    if (!stage) return
    stage.viewbox(viewBox.x, viewBox.y, viewBox.width, viewBox.height)
    renderOverlay(stage, selectedIdsRef.current)
  }, [viewBox])

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
  useEffect(() => {
    const key = `no-tie-svg-colors:${storageId}`
    try { setNamedColors(JSON.parse(localStorage.getItem(key) ?? '[]') as { name: string; color: string }[]) } catch { setNamedColors([]) }
    setLoadedColorsKey(key)
  }, [storageId])
  useEffect(() => {
    const key = `no-tie-svg-colors:${storageId}`
    if (loadedColorsKey !== key) return
    try { localStorage.setItem(key, JSON.stringify(namedColors.slice(-24))) } catch { /* storage may be unavailable in private windows */ }
  }, [storageId, namedColors, loadedColorsKey])
  useEffect(() => {
    try { localStorage.setItem('no-tie-svg-assets', JSON.stringify(assetLibrary.slice(-40))) } catch { /* the asset library stays available for this editor session */ }
  }, [assetLibrary])
  useEffect(() => { try { localStorage.setItem('no-tie-svg-palettes', JSON.stringify(customPalettes.slice(-20))) } catch { /* palettes remain usable for this session */ } }, [customPalettes])

  const chooseTool = (nextTool: Tool) => {
    if (activePen.current && nextTool !== 'pen') finishPenAction.current()
    if (nextTool === 'freehand') select([])
    toolRef.current = nextTool
    setTool(nextTool)
    if (drawing.current) {
      drawing.current.node.setAttribute('data-active-tool', nextTool)
      renderOverlay(drawing.current, selectedIdsRef.current)
    }
  }

  function changeViewBox(next: ViewBox) {
    const safe = { x: Number.isFinite(next.x) ? next.x : 0, y: Number.isFinite(next.y) ? next.y : 0, width: Math.max(1, next.width), height: Math.max(1, next.height) }
    viewBoxRef.current = safe
    setViewBox(safe)
    if (drawing.current) drawing.current.viewbox(safe.x, safe.y, safe.width, safe.height)
  }

  function zoomAtCenter(scale: number) {
    const current = viewBoxRef.current
    const width = Math.max(MIN_VIEW_EXTENT, Math.min(MAX_VIEW_EXTENT, current.width * scale))
    const height = width * current.height / current.width
    const centerX = current.x + current.width / 2
    const centerY = current.y + current.height / 2
    changeViewBox({ x: centerX - width / 2, y: centerY - height / 2, width, height })
  }

  function fitViewToContent(selectionOnly = false) {
    const stage = drawing.current
    if (!stage) return
    const bounds = selectionOnly
      ? unionBoxes(elementsForIds(stage.node, selectedIdsRef.current).map(getBox))
      : unionBoxes(directObjects(stage.node).map(getBox))
    if (!bounds) {
      changeViewBox({ x: 0, y: 0, width: documentSize.width, height: documentSize.height })
      return
    }
    const margin = Math.max(12, Math.max(bounds.width, bounds.height) * .06)
    const aspect = viewBoxRef.current.width / viewBoxRef.current.height
    let width = bounds.width + margin * 2
    let height = bounds.height + margin * 2
    if (width / height > aspect) height = width / aspect
    else width = height * aspect
    changeViewBox({ x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height })
  }

  function unitScale(unit = documentUnit) {
    return unit === 'mm' ? 96 / 25.4 : unit === 'in' ? 96 : 1
  }

  function displayedDimension(value: number) {
    return Number((value / unitScale()).toFixed(documentUnit === 'px' ? 0 : 2))
  }

  function changeDocumentDimension(axis: 'width' | 'height', displayedValue: number) {
    const value = Math.max(1, displayedValue * unitScale())
    const current = documentSizeRef.current
    const next = axis === 'width'
      ? { width: value, height: lockDocumentRatio ? value / documentRatio.current : current.height }
      : { height: value, width: lockDocumentRatio ? value * documentRatio.current : current.width }
    if (!lockDocumentRatio) documentRatio.current = next.width / next.height
    documentSizeRef.current = next
    setDocumentSize(next)
    if (drawing.current) {
      drawing.current.node.setAttribute('width', `${next.width}`)
      drawing.current.node.setAttribute('height', `${next.height}`)
      drawing.current.node.querySelectorAll<SVGRectElement>('[data-background]').forEach(background => background.setAttribute(axis, `${axis === 'width' ? next.width : next.height}`))
    }
    changeViewBox({ x: 0, y: 0, width: next.width, height: next.height })
  }

  function documentLength(value: number) {
    return `${Number((value / unitScale()).toFixed(documentUnit === 'px' ? 0 : 2))}${documentUnit}`
  }

  const select = (ids: string[]) => {
    const stage = drawing.current
    const unique = [...new Set(stage ? expandGroupSelection(stage.node, ids) : ids)]
    selectedIdsRef.current = unique
    setSelectedIds(unique)
    if (stage) {
      setHasSelectedGroup(elementsForIds(stage.node, unique).some(element => element.hasAttribute('data-group-id')))
      const selectedElements = elementsForIds(stage.node, unique)
      const selectedPenPath = selectedElements.find(element => element.hasAttribute('data-editor-pen'))
      const selectedPenPathId = selectedPenPath?.getAttribute('data-object-id') ?? null
      if (!selectedPenPathId) {
        selectedPenPathIdRef.current = null
        setSelectedPenNodeIndex(null)
        selectedPenNodeIndicesRef.current = []
        setSelectedPenNodeIndices([])
        stage.node.removeAttribute('data-selected-pen-node')
        stage.node.removeAttribute('data-selected-pen-nodes')
      } else if (selectedPenPathIdRef.current !== selectedPenPathId) {
        selectedPenPathIdRef.current = selectedPenPathId
        setSelectedPenNodeIndex(null)
        selectedPenNodeIndicesRef.current = []
        setSelectedPenNodeIndices([])
        stage.node.removeAttribute('data-selected-pen-node')
        stage.node.removeAttribute('data-selected-pen-nodes')
      } else if (selectedPenNodeIndex !== null) stage.node.setAttribute('data-selected-pen-node', `${selectedPenNodeIndex}`)
      const bounds = unionBoxes(selectedElements.map(getBox))
      setSelectionBounds(bounds ?? null)
      setGeometryDraft(bounds ? boxDraft(bounds) : null)
      setRotationDraft(selectedElements[0]?.getAttribute('data-editor-rotation') ?? '0')
      const first = selectedElements[0]
      setFillRule(first?.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero')
      setBlendMode(first?.getAttribute('mix-blend-mode') || 'normal')
      setLetterSpacing(`${Number.parseFloat(first?.getAttribute('letter-spacing') ?? '0') || 0}`)
      setLineHeight(`${Number.parseFloat(first?.getAttribute('line-height') ?? '1.2') || 1.2}`)
      setBaselineShift(`${Number.parseFloat(first?.getAttribute('baseline-shift') ?? '0') || 0}`)
      const textPath = first?.querySelector('textPath')
      setTextPathOffset(Math.max(0, Math.min(100, Number.parseFloat(textPath?.getAttribute('startOffset') ?? '0') || 0)))
      setTextPathAnchor((first?.getAttribute('text-anchor') as 'start' | 'middle' | 'end') || 'start')
      setTextPathSide(textPath?.getAttribute('side') === 'right' ? 'right' : 'left')
      setTextPathDistance(Number.parseFloat(first?.getAttribute('dy') ?? '0') || 0)
      setOpacity(Math.round(Number(first?.getAttribute('opacity') ?? 1) * 100))
      if (first) setSelectedStyle({ fill: first.getAttribute('fill') ?? 'none', stroke: first.getAttribute('stroke') ?? 'none', strokeWidth: first.getAttribute('stroke-width') ?? '1', opacity: first.getAttribute('opacity') ?? '1', fontSize: first.getAttribute('font-size') ?? '', fontFamily: first.getAttribute('font-family') ?? '' })
      setGroupConstraint(selectedElements.some(element => element.getAttribute('data-layout-constraint') === 'aspect') ? 'aspect' : 'free')
      const selectedLine = selectedElements.find(element => element.tagName.toLowerCase() === 'line')
      if (selectedLine) {
        const style = selectedLine.getAttribute('data-route-style')
        setConnectorStyle(style === 'straight' || style === 'rounded' ? style : 'orthogonal')
        setConnectorLabel(selectedLine.getAttribute('data-connector-label') ?? '')
        const routed = selectedLine.getAttribute('data-auto-route') === 'true'
        setAutoRoute(routed); autoRouteRef.current = routed
      } else {
        setAutoRoute(false); autoRouteRef.current = false; setConnectorLabel('')
      }
      const selectedShape = selectedElements.find(element => !['line', 'text'].includes(element.tagName.toLowerCase()))
      const port = selectedShape?.getAttribute('data-connector-port')
      setConnectorPortType(port === 'input' || port === 'output' || port === 'both' ? port : 'free')
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
      const selectedRaster = selectedElements.find(element => element.tagName.toLowerCase() === 'image')
      if (selectedRaster) {
        const filterId = selectedRaster.getAttribute('data-image-filter')
        const filter = filterId ? stage.node.querySelector<SVGFilterElement>(`filter[id="${CSS.escape(filterId)}"]`) : null
        const transfer = filter?.querySelector('feComponentTransfer')
        const slope = Number(transfer?.querySelector('feFuncR')?.getAttribute('slope'))
        const intercept = Number(transfer?.querySelector('feFuncR')?.getAttribute('intercept'))
        const saturation = Number(filter?.querySelector('feColorMatrix')?.getAttribute('values'))
        if (Number.isFinite(slope) && slope >= 0 && Number.isFinite(intercept)) {
          setImageContrast(Math.round(slope * 100))
          setImageBrightness(Math.round((intercept - .5 * (1 - slope) + 1) * 100))
        } else { setImageContrast(100); setImageBrightness(100) }
        setImageSaturation(Number.isFinite(saturation) && saturation >= 0 ? Math.round(saturation * 100) : 100)
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
    const stage = SVG().addTo(mount.current).size('100%', '100%').viewbox(0, 0, WIDTH, HEIGHT).attr({ preserveAspectRatio: 'none', tabindex: 0, 'data-active-tool': 'select', 'data-editor-infinite-canvas': `${infiniteCanvas}` })
    if (asset?.svg) {
      try {
        const parsed = new DOMParser().parseFromString(sanitizeSvg(asset.svg), 'image/svg+xml')
        stage.svg(parsed.documentElement.innerHTML)
        const parsedViewBox = parsed.documentElement.getAttribute('viewBox')
        if (parsedViewBox) {
          const values = parsedViewBox.split(/[ ,]+/).map(Number)
          if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) stage.viewbox(values[0], values[1], values[2], values[3])
        }
      } catch {
        stage.rect(WIDTH, HEIGHT).fill('#fffdf9').attr({ 'data-background': 'true' })
      }
    } else {
      stage.rect(WIDTH, HEIGHT).fill('#fffdf9').attr({ 'data-background': 'true' })
    }
    ensureObjectIds(stage.node)
    updateConnectors(stage.node)
    const initialViewBox = readViewBox(stage.node)
    viewBoxRef.current = initialViewBox
    setViewBox(initialViewBox)
    documentSizeRef.current = { width: initialViewBox.width, height: initialViewBox.height }
    documentRatio.current = initialViewBox.width / initialViewBox.height
    setDocumentSize({ width: initialViewBox.width, height: initialViewBox.height })
    setExportSize({ width: Math.round(initialViewBox.width), height: Math.round(initialViewBox.height) })
    stage.node.setAttribute('data-editor-grid', `${viewOptionsRef.current.grid}`)
    stage.node.setAttribute('data-editor-grid-size', `${viewOptionsRef.current.gridSize}`)
    stage.node.setAttribute('data-editor-smart-guides', `${viewOptionsRef.current.smartGuides}`)
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

    const point = (event: PointerEvent, snap = true) => {
      const bounds = stage.node.getBoundingClientRect()
      const visible = viewBoxRef.current
      const isStylus = event.pointerType === 'pen'
      const pressure = isStylus ? (event.pressure > 0 ? event.pressure : .5) : undefined
      const tiltX = isStylus ? event.tiltX : undefined
      const tiltY = isStylus ? event.tiltY : undefined
      const location = {
        x: Number((visible.x + (event.clientX - bounds.left) * visible.width / bounds.width).toFixed(1)),
        y: Number((visible.y + (event.clientY - bounds.top) * visible.height / bounds.height).toFixed(1)),
      }
      const withPressure = (value: Point): Point => pressure === undefined ? value : { ...value, pressure, tiltX, tiltY }
      if (snap && viewOptionsRef.current.snapGeometry) {
        const threshold = Math.max(visible.width / Math.max(bounds.width, 1), visible.height / Math.max(bounds.height, 1)) * 9
        const excludedIds = toolRef.current === 'select' ? selectedIdsRef.current : []
        const target = findGeometrySnap(stage.node, location, excludedIds, threshold)
        if (target) return withPressure({ x: Number(target.x.toFixed(1)), y: Number(target.y.toFixed(1)) })
      }
      if (snap && viewOptionsRef.current.snap) {
        const size = Math.max(2, viewOptionsRef.current.gridSize)
        return withPressure({ x: Math.round(location.x / size) * size, y: Math.round(location.y / size) * size })
      }
      return withPressure(location)
    }

    const eraseAt = (event: PointerEvent, location: Point, previous: Point = location): boolean => {
      const scale = Math.max(viewBoxRef.current.width / Math.max(stage.node.clientWidth, 1), viewBoxRef.current.height / Math.max(stage.node.clientHeight, 1))
      const radius = Math.max(2, eraserSizeRef.current * scale / 2)
      const distanceToSegment = (point: Point, start: Point, end: Point) => {
        const dx = end.x - start.x; const dy = end.y - start.y
        const length = dx * dx + dy * dy
        const ratio = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0
        return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy))
      }
      const segmentsNear = (a: Point, b: Point, c: Point, d: Point, distance: number) => {
        const cross = (first: Point, second: Point, third: Point) => (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
        const abC = cross(a, b, c); const abD = cross(a, b, d); const cdA = cross(c, d, a); const cdB = cross(c, d, b)
        const onSegment = (point: Point, start: Point, end: Point) => point.x >= Math.min(start.x, end.x) - 1e-8 && point.x <= Math.max(start.x, end.x) + 1e-8 && point.y >= Math.min(start.y, end.y) - 1e-8 && point.y <= Math.max(start.y, end.y) + 1e-8
        if ((abC * abD < 0 && cdA * cdB < 0)
          || (Math.abs(abC) < 1e-8 && onSegment(c, a, b))
          || (Math.abs(abD) < 1e-8 && onSegment(d, a, b))
          || (Math.abs(cdA) < 1e-8 && onSegment(a, c, d))
          || (Math.abs(cdB) < 1e-8 && onSegment(b, c, d))) return true
        return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b)) <= distance
      }
      const rawTarget = document.elementFromPoint(event.clientX, event.clientY)
      const hitTarget = findObjectTarget(stage.node, rawTarget)
      const wholeStrokeTargets = new Set<SVGElement>()
      if (hitTarget) wholeStrokeTargets.add(hitTarget)
      if (eraserModeRef.current === 'whole') {
        const bounds = stage.node.getBoundingClientRect()
        const view = viewBoxRef.current
        const toClient = (point: Point) => ({ x: bounds.left + (point.x - view.x) * bounds.width / view.width, y: bounds.top + (point.y - view.y) * bounds.height / view.height })
        const startClient = toClient(previous); const endClient = toClient(location)
        const length = Math.hypot(endClient.x - startClient.x, endClient.y - startClient.y)
        const steps = Math.max(1, Math.ceil(length / Math.max(3, eraserSizeRef.current * .35)))
        const offset = eraserSizeRef.current / 2
        const diagonal = offset * Math.SQRT1_2
        const offsets = [[0, 0], [offset, 0], [-offset, 0], [0, offset], [0, -offset], [diagonal, diagonal], [diagonal, -diagonal], [-diagonal, diagonal], [-diagonal, -diagonal]]
        for (let index = 0; index <= steps; index++) {
          const ratio = index / steps
          const x = startClient.x + (endClient.x - startClient.x) * ratio
          const y = startClient.y + (endClient.y - startClient.y) * ratio
          offsets.forEach(([dx, dy]) => {
            const target = findObjectTarget(stage.node, document.elementFromPoint(x + dx, y + dy))
            if (target) wholeStrokeTargets.add(target)
          })
        }
      }
      let changed = false
      directObjects(stage.node).forEach(element => {
        if (element.getAttribute('data-layer-locked') === 'true' || element.getAttribute('visibility') === 'hidden') return
        if (eraserModeRef.current === 'whole') {
          if (wholeStrokeTargets.has(element)) { element.remove(); changed = true }
          return
        }
        const rawPoints = element.getAttribute('data-freehand-points')
        if (rawPoints) {
          let localPrevious = previous
          let localLocation = location
          let scaleToLocal = 1
          let scaleToRoot = 1
          try {
            const elementMatrix = (element as SVGGraphicsElement).getScreenCTM()
            const rootMatrix = stage.node.getScreenCTM()
            if (elementMatrix && rootMatrix) {
              const localToRoot = rootMatrix.inverse().multiply(elementMatrix)
              const rootToLocal = localToRoot.inverse()
              localPrevious = new DOMPoint(previous.x, previous.y).matrixTransform(rootToLocal)
              localLocation = new DOMPoint(location.x, location.y).matrixTransform(rootToLocal)
              scaleToLocal = Math.max(Math.hypot(rootToLocal.a, rootToLocal.b), Math.hypot(rootToLocal.c, rootToLocal.d))
              scaleToRoot = Math.max(Math.hypot(localToRoot.a, localToRoot.b), Math.hypot(localToRoot.c, localToRoot.d))
            }
          } catch { /* Use the SVG's untransformed coordinates if a matrix is unavailable. */ }
          const strokeWidth = Number(element.getAttribute('stroke-width')) || strokeWidthRef.current
          const effectiveRadius = radius * scaleToLocal + Math.max(.5, strokeWidth * .55)
          const boundsRadius = radius + Math.max(.5, strokeWidth * .55 * scaleToRoot)
          const bounds = getBox(element)
          const sweepBounds = { left: Math.min(previous.x, location.x), right: Math.max(previous.x, location.x), top: Math.min(previous.y, location.y), bottom: Math.max(previous.y, location.y) }
          if (bounds && (sweepBounds.right < bounds.x - boundsRadius || sweepBounds.left > bounds.x + bounds.width + boundsRadius || sweepBounds.bottom < bounds.y - boundsRadius || sweepBounds.top > bounds.y + bounds.height + boundsRadius)) return
          let pointGroups: Point[][] = []
          try {
            const parsed = JSON.parse(rawPoints) as Point[] | Point[][]
            pointGroups = Array.isArray(parsed[0]) ? parsed as Point[][] : [parsed as Point[]]
          } catch { /* Treat a damaged point cache as a regular path and allow whole-stroke erasing. */ }
          if (pointGroups.length) {
            let erased = false
            const remainingGroups = pointGroups.flatMap(points => {
              if (points.length === 1) {
                if (distanceToSegment(points[0], localPrevious, localLocation) <= effectiveRadius) { erased = true; return [] }
                return [points]
              }
              if (points.length < 2) return [points]
              const removed = new Set<number>()
              points.forEach((point, index) => {
                if (distanceToSegment(point, localPrevious, localLocation) <= effectiveRadius) removed.add(index)
                if (index && segmentsNear(localPrevious, localLocation, points[index - 1], point, effectiveRadius)) { removed.add(index - 1); removed.add(index) }
              })
              if (!removed.size) return [points]
              erased = true
              const chunks: Point[][] = []
              let chunk: Point[] = []
              points.forEach((point, index) => {
                if (removed.has(index)) {
                  if (chunk.length > 1) chunks.push(chunk)
                  chunk = []
                } else chunk.push(point)
              })
              if (chunk.length > 1) chunks.push(chunk)
              return chunks
            })
            if (erased) {
              if (!remainingGroups.length) element.remove()
              else {
                const pressureStrokeElement = element.hasAttribute('data-pressure-stroke')
                const width = Number(element.getAttribute('stroke-width')) || strokeWidthRef.current
                const smoothing = Number(element.getAttribute('data-freehand-smoothing'))
                const pressureSensitivity = Number(element.getAttribute('data-freehand-pressure-sensitivity'))
                const tiltSensitivity = Number(element.getAttribute('data-freehand-tilt-sensitivity'))
                const pathData = remainingGroups.map(points => pressureStrokeElement
                  ? pressureStroke(points, width, Number.isFinite(pressureSensitivity) ? pressureSensitivity : pressureSensitivityRef.current, Number.isFinite(tiltSensitivity) ? tiltSensitivity : tiltSensitivityRef.current)
                  : smoothStroke(points, Number.isFinite(smoothing) ? smoothing : smoothingRef.current)).join(' ')
                element.setAttribute('d', pathData)
                element.setAttribute('data-freehand-points', JSON.stringify(remainingGroups))
              }
              changed = true
            }
          }
        }
      })
      return changed
    }

    const beginTextEdit = (location: { x: number; y: number }, existing?: SVGElement, keepTool = false, parent?: SVGElement) => {
      textEdit.current?.input.remove()
      const container = mount.current
      if (!container) return
      const bounds = stage.node.getBoundingClientRect()
      const existingBox = existing ? getBox(existing) : undefined
      const parentBox = parent ? getBox(parent) : undefined
      const x = parentBox ? parentBox.x + parentBox.width / 2 : existingBox?.x ?? location.x
      const y = parentBox ? parentBox.y + parentBox.height / 2 : existingBox?.y ?? location.y
      const size = Number(existing?.getAttribute('font-size')) || (parentBox
        ? Math.max(8, Math.min(fontSizeRef.current, parentBox.width / 6, parentBox.height * .45))
        : fontSizeRef.current)
      const input = document.createElement('input')
      input.className = `canvas-text-input${parent ? ' canvas-child-text-input' : ''}`
      input.type = 'text'
      input.value = existing?.textContent ?? ''
      input.placeholder = 'Wpisz tekst…'
      input.setAttribute('aria-label', 'Tekst schematu')
      const visible = viewBoxRef.current
      input.style.left = `${(x - visible.x) * bounds.width / visible.width}px`
      input.style.top = `${(y - visible.y) * bounds.height / visible.height}px`
      input.style.fontSize = `${size * bounds.width / visible.width}px`
      input.style.color = existing?.getAttribute('fill') ?? strokeColorRef.current
      if (parentBox) input.style.width = `${Math.max(44, Math.min(320, parentBox.width * bounds.width / visible.width * .86))}px`
      container.append(input)
      textEdit.current = { input, x, y, element: existing, fontSize: size, keepTool, parent, parentId: parent?.getAttribute('data-object-id') ?? undefined }

      const cancel = () => {
        if (textEdit.current?.input !== input) return
        textEdit.current = null
        input.remove()
      }
      const commit = () => {
        const editing = textEdit.current
        if (!editing || editing.input !== input) return
        const value = input.value.trim()
        let changed = false
        if (editing.element) {
          if (value) editing.element.textContent = value
          else editing.element.remove()
          changed = true
        } else if (editing.parent && value) {
          let textParent = editing.parent
          let objectId = editing.parentId ?? textParent.getAttribute('data-object-id') ?? crypto.randomUUID()
          if (textParent.tagName.toLowerCase() !== 'g') {
            const wrapper = document.createElementNS(SVG_NS, 'g')
            const carriedAttributes = [
              'data-object-id', 'data-layer-name', 'data-layer-locked', 'data-group-id', 'data-layout-constraint', 'data-connector-port', 'aria-label', 'role', 'tabindex',
              'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
              'visibility', 'display', 'paint-order', 'shape-rendering', 'vector-effect',
            ]
            carriedAttributes.forEach(name => {
              const attribute = textParent.getAttribute(name)
              if (attribute !== null) { wrapper.setAttribute(name, attribute); textParent.removeAttribute(name) }
            })
            wrapper.setAttribute('data-object-id', objectId)
            textParent.replaceWith(wrapper)
            wrapper.append(textParent)
            textParent = wrapper
          }
          const stageMatrix = stage.node.getScreenCTM()
          const parentMatrix = (textParent as SVGGraphicsElement).getScreenCTM()
          const localPoint = stageMatrix && parentMatrix
            ? new DOMPoint(editing.x, editing.y).matrixTransform(stageMatrix).matrixTransform(parentMatrix.inverse())
            : new DOMPoint(editing.x, editing.y)
          const child = document.createElementNS(SVG_NS, 'text')
          child.textContent = value
          child.setAttribute('x', rounded(localPoint.x))
          child.setAttribute('y', rounded(localPoint.y))
          child.setAttribute('text-anchor', 'middle')
          child.setAttribute('dominant-baseline', 'middle')
          child.setAttribute('font-family', fontFamilyRef.current)
          child.setAttribute('font-size', `${editing.fontSize}`)
          child.setAttribute('font-weight', fontWeightRef.current)
          child.setAttribute('fill', strokeColorRef.current)
          child.setAttribute('pointer-events', 'all')
          if (fontItalicRef.current) child.setAttribute('font-style', 'italic')
          textParent.append(child)
          select([objectId])
          updateConnectors(stage.node)
          if (!editing.keepTool) chooseTool('select')
          changed = true
        } else if (value) {
          const created = stage.text(value).move(editing.x, editing.y).font({ family: fontFamilyRef.current, size: editing.fontSize, weight: fontWeightRef.current }).fill(strokeColorRef.current)
          created.attr({ 'text-anchor': textAlignRef.current })
          if (fontItalicRef.current) created.attr({ 'font-style': 'italic' })
          const id = crypto.randomUUID()
          created.attr({ 'data-object-id': id, 'pointer-events': 'all' })
          select([id])
          if (!editing.keepTool) chooseTool('select')
          changed = true
        }
        textEdit.current = null
        input.remove()
        if (changed) {
          recordHistory(stage)
          renderOverlay(stage, selectedIdsRef.current)
        }
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
      } else if (currentTool === 'freehand') {
        element = stage.path(`M ${rounded(location.x)} ${rounded(location.y)} l 0.1 0`)
      }
      if (!element) return
      element.stroke({ color, width: size, linecap: 'round', linejoin: 'round' })
      element.fill(fillEnabledRef.current && !['line', 'arrow', 'freehand'].includes(currentTool) ? fillColorRef.current : 'none')
      if (currentTool === 'arrow' && autoRouteRef.current) element.attr('data-auto-route', 'true')
      const id = crypto.randomUUID()
      element.attr({ 'data-object-id': id, 'pointer-events': 'all' })
      select(currentTool === 'freehand' ? [] : [id])
      return { element, id }
    }

    const start = (event: PointerEvent) => {
      if (interactionPointerId.current !== null && interactionPointerId.current !== event.pointerId) {
        event.preventDefault()
        return
      }
      if (event.pointerType === 'pen') activeStylusPointerId.current = event.pointerId
      const currentTool = toolRef.current
      if (event.pointerType === 'touch' && (activeStylusPointerId.current !== null || (palmRejectionRef.current && currentTool === 'freehand'))) {
        event.preventDefault()
        return
      }
      const clickedObject = findObjectTarget(stage.node, event.target)
      const allowTextDoubleClick = currentTool === 'select'
        && (event.pointerType === 'mouse' || event.pointerType === 'pen')
        && clickedObject?.tagName.toLowerCase() === 'text'
      if (!allowTextDoubleClick) event.preventDefault()
      stage.node.focus({ preventScroll: true })
      const penPan = event.pointerType === 'pen' && event.button === 2
      const wantsPan = currentTool === 'pan' || event.button === 1 || spacePanRef.current || penPan
      const location = point(event, !wantsPan && currentTool !== 'lasso')
      if (wantsPan) {
        stage.node.setPointerCapture(event.pointerId)
        interactionPointerId.current = event.pointerId
        interaction.current = { type: 'pan', startClientX: event.clientX, startClientY: event.clientY, viewBox: { ...viewBoxRef.current } }
        stage.node.setAttribute('data-panning', 'true')
        return
      }
      const guideHit = event.target instanceof Element ? event.target.closest('[data-editor-guide-index]') : null
      const rulerHit = event.target instanceof Element ? event.target.closest('[data-ruler-axis]') : null
      if (guideHit || rulerHit) {
        const guides = viewOptionsRef.current.guides
        const axis = (guideHit ? guides[Number(guideHit.getAttribute('data-editor-guide-index'))]?.axis : rulerHit?.getAttribute('data-ruler-axis')) as 'x' | 'y' | undefined
        if (!axis) return
        const guideIndex = guideHit ? Number(guideHit.getAttribute('data-editor-guide-index')) : guides.length
        if (guideHit && (guides[guideIndex]?.locked || guideLockAll)) return
        if (rulerHit) setViewOptions(current => ({ ...current, guides: [...current.guides, { axis, value: axis === 'x' ? location.x : location.y, locked: guideLockAll }] }))
        stage.node.setPointerCapture(event.pointerId)
        interactionPointerId.current = event.pointerId
        interaction.current = { type: 'guide', index: guideIndex, axis, moved: false, created: Boolean(rulerHit) }
        return
      }
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
      interactionPointerId.current = event.pointerId
      if (currentTool === 'lasso') {
        interaction.current = { type: 'lasso', points: [location], additive: event.shiftKey, initialIds: event.shiftKey ? selectedIdsRef.current : [], moved: false }
        renderOverlay(stage, selectedIdsRef.current, { lasso: [location] })
        return
      }
      if (currentTool === 'eraser') {
        const location = point(event, false)
        interaction.current = { type: 'eraser', changed: eraseAt(event, location), last: location }
        return
      }
      if (currentTool === 'shapeBuilder') {
        const id = clickedObject?.getAttribute('data-object-id')
        if (!id || clickedObject?.getAttribute('data-layer-locked') === 'true') { if (!event.shiftKey && !id) select([]); return }
        const current = selectedIdsRef.current
        select(event.shiftKey ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id])
        return
      }
      if (currentTool !== 'select') {
        const anchorCandidate = (currentTool === 'line' || currentTool === 'arrow') ? findAnchorHit(event.target) : undefined
        const anchorElement = anchorCandidate ? elementsForIds(stage.node, [anchorCandidate.id])[0] : undefined
        const anchor = anchorElement?.getAttribute('data-layer-locked') === 'true' || !canConnectToPort(anchorElement, 'start') ? undefined : anchorCandidate
        const target = anchor ? elementsForIds(stage.node, [anchor.id])[0] : undefined
        const anchorPoint = target && anchor ? anchorPosition(target, anchor.anchor) : undefined
        const startPoint = anchorPoint ?? location
        const created = startShape(currentTool, startPoint)
        if (created) {
          if (currentTool === 'freehand') {
            const pressureSensitive = event.pointerType === 'pen'
            if (pressureSensitive) {
              created.element.attr({ d: pressureStroke([startPoint], strokeWidthRef.current, pressureSensitivityRef.current, tiltSensitivityRef.current), fill: strokeColorRef.current, stroke: 'none', 'data-pressure-stroke': 'true' })
            }
            created.element.attr({
              'data-freehand-points': JSON.stringify([[startPoint]]),
              'data-freehand-smoothing': `${smoothingRef.current}`,
              'data-freehand-pressure-sensitivity': `${pressureSensitivityRef.current}`,
              'data-freehand-tilt-sensitivity': `${tiltSensitivityRef.current}`,
            })
            interaction.current = { type: 'freehand', element: created.element, id: created.id, points: [startPoint], pressureSensitive }
          } else {
            if (anchor && anchorPoint) created.element.attr({ 'data-start-target': anchor.id, 'data-start-anchor': anchor.anchor })
            interaction.current = { type: 'draw', tool: currentTool, element: created.element, id: created.id, x: startPoint.x, y: startPoint.y, keepTool: event.ctrlKey, startTarget: anchor?.id, startAnchor: anchor?.anchor }
            if ((currentTool === 'line' || currentTool === 'arrow') && anchor && anchorPoint) {
              stage.node.setAttribute('data-connector-dragging', 'true')
              renderOverlay(stage, selectedIdsRef.current)
            }
          }
        }
        return
      }

      const gradientHit = event.target instanceof Element ? event.target.closest('[data-gradient-handle][data-gradient-object]') : null
      if (gradientHit) {
        const id = gradientHit.getAttribute('data-gradient-object')
        const element = id ? elementsForIds(stage.node, [id])[0] : undefined
        const gradientId = element?.getAttribute('fill')?.match(/^url\(["']?#([^\s)'\"]+)["']?\)$/)?.[1]
        const gradient = gradientId ? stage.node.querySelector<SVGLinearGradientElement>(`linearGradient[id="${CSS.escape(gradientId)}"]`) : null
        const bounds = element ? getBox(element) : undefined
        if (element && gradient && bounds) {
          interaction.current = { type: 'gradient-handle', element, gradient, bounds, index: Number(gradientHit.getAttribute('data-gradient-handle')) as 0 | 1 | 2, moved: false }
          return
        }
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
          const currentNodes = selectedPenPathIdRef.current === id ? selectedPenNodeIndicesRef.current : []
          const nextNodes = event.shiftKey
            ? currentNodes.includes(index) ? currentNodes.filter(value => value !== index) : [...currentNodes, index]
            : [index]
          selectedPenNodeIndicesRef.current = nextNodes
          setSelectedPenNodeIndices(nextNodes)
          setSelectedPenNodeIndex(nextNodes.at(-1) ?? null)
          setPenNodeMode(points[index].mode ?? 'smooth')
          select([id!])
          stage.node.setAttribute('data-selected-pen-nodes', JSON.stringify(nextNodes))
          if (nextNodes.length) stage.node.setAttribute('data-selected-pen-node', `${nextNodes.at(-1)}`)
          else stage.node.removeAttribute('data-selected-pen-node')
          if (!event.shiftKey || nextNodes.includes(index)) interaction.current = { type: 'pen-node', element, index, indices: nextNodes, handle, points, moved: false }
          renderOverlay(stage, [id!])
          return
        }
      }

      const connectorHandle = findConnectorHandle(event.target)
      if (connectorHandle) {
        const selectedObject = elementsForIds(stage.node, [connectorHandle.id])[0]
        const line = selectedObject?.tagName.toLowerCase() === 'line'
          ? selectedObject as SVGLineElement
          : selectedObject?.querySelector(':scope > line') as SVGLineElement | null ?? undefined
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
      const others = directObjects(stage.node).filter(element => !ids.includes(element.getAttribute('data-object-id') ?? '') && element.getAttribute('visibility') !== 'hidden').map(getBox).filter((box): box is Box => Boolean(box))
      interaction.current = { type: 'move', ids, elements, others, startX: location.x, startY: location.y, lastX: 0, lastY: 0, bounds, moved: false }
    }

    const move = (event: PointerEvent) => {
      if (interactionPointerId.current !== null && interactionPointerId.current !== event.pointerId) return
      const current = interaction.current
      if (!current) return
      const location = point(event, current.type !== 'pan' && current.type !== 'lasso' && current.type !== 'eraser')
      if (current.type === 'pan') {
        const bounds = stage.node.getBoundingClientRect()
        const dx = (event.clientX - current.startClientX) * current.viewBox.width / Math.max(1, bounds.width)
        const dy = (event.clientY - current.startClientY) * current.viewBox.height / Math.max(1, bounds.height)
        changeViewBox({ ...current.viewBox, x: current.viewBox.x - dx, y: current.viewBox.y - dy })
      } else if (current.type === 'guide') {
        current.moved = true
        const value = current.axis === 'x' ? location.x : location.y
        setViewOptions(options => ({ ...options, guides: options.guides.map((guide, index) => index === current.index ? { ...guide, value } : guide) }))
      } else if (current.type === 'lasso') {
        const last = current.points.at(-1)!
        if (Math.hypot(location.x - last.x, location.y - last.y) >= 2 && current.points.length < 1600) current.points.push(location)
        current.moved = current.moved || current.points.length > 2
        renderOverlay(stage, selectedIdsRef.current, { lasso: current.points })
      } else if (current.type === 'eraser') {
        current.changed = eraseAt(event, location, current.last) || current.changed
        current.last = location
      } else if (current.type === 'gradient-handle') {
        current.moved = true
        if (current.index === 2) {
          const x1 = Number.parseFloat(current.gradient.getAttribute('x1') ?? '0')
          const y1 = Number.parseFloat(current.gradient.getAttribute('y1') ?? '0')
          const x2 = Number.parseFloat(current.gradient.getAttribute('x2') ?? '1')
          const y2 = Number.parseFloat(current.gradient.getAttribute('y2') ?? '0')
          const startX = current.gradient.getAttribute('gradientUnits') === 'userSpaceOnUse' ? x1 : current.bounds.x + current.bounds.width * (current.gradient.getAttribute('x1')?.endsWith('%') ? x1 / 100 : x1)
          const startY = current.gradient.getAttribute('gradientUnits') === 'userSpaceOnUse' ? y1 : current.bounds.y + current.bounds.height * (current.gradient.getAttribute('y1')?.endsWith('%') ? y1 / 100 : y1)
          const endX = current.gradient.getAttribute('gradientUnits') === 'userSpaceOnUse' ? x2 : current.bounds.x + current.bounds.width * (current.gradient.getAttribute('x2')?.endsWith('%') ? x2 / 100 : x2)
          const endY = current.gradient.getAttribute('gradientUnits') === 'userSpaceOnUse' ? y2 : current.bounds.y + current.bounds.height * (current.gradient.getAttribute('y2')?.endsWith('%') ? y2 / 100 : y2)
          const dx = endX - startX; const dy = endY - startY
          const ratio = Math.max(0, Math.min(1, ((location.x - startX) * dx + (location.y - startY) * dy) / Math.max(.001, dx * dx + dy * dy)))
          const stop = current.gradient.querySelectorAll('stop')[1]
          stop?.setAttribute('offset', `${Number((ratio * 100).toFixed(1))}%`)
        } else {
          const units = current.gradient.getAttribute('gradientUnits')
          const x = units === 'userSpaceOnUse' ? location.x : (location.x - current.bounds.x) / Math.max(.1, current.bounds.width)
          const y = units === 'userSpaceOnUse' ? location.y : (location.y - current.bounds.y) / Math.max(.1, current.bounds.height)
          const suffix = units === 'userSpaceOnUse' ? '' : '%'
          const valueX = units === 'userSpaceOnUse' ? x : x * 100
          const valueY = units === 'userSpaceOnUse' ? y : y * 100
          current.gradient.setAttribute(current.index === 0 ? 'x1' : 'x2', `${Number(valueX.toFixed(2))}${suffix}`)
          current.gradient.setAttribute(current.index === 0 ? 'y1' : 'y2', `${Number(valueY.toFixed(2))}${suffix}`)
        }
        renderOverlay(stage, [current.element.getAttribute('data-object-id') ?? ''])
      } else if (current.type === 'freehand') {
        const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
        samples.forEach(sample => {
          appendFreehandSample(current.points, point(sample), 1.2)
        })
        current.element.attr('d', current.pressureSensitive ? pressureStroke(current.points, strokeWidthRef.current, pressureSensitivityRef.current, tiltSensitivityRef.current) : smoothStroke(current.points, smoothingRef.current))
        renderOverlay(stage, [])
      } else if (current.type === 'pen-node') {
        current.moved = true
        const node = current.points[current.index]
        if (current.indices.length > 1 || current.handle === 'anchor') {
          const dx = location.x - node.x; const dy = location.y - node.y
          current.indices.forEach(index => {
            const selected = current.points[index]
            selected.x += dx; selected.y += dy
            if (selected.incoming) selected.incoming = { x: selected.incoming.x + dx, y: selected.incoming.y + dy }
            if (selected.outgoing) selected.outgoing = { x: selected.outgoing.x + dx, y: selected.outgoing.y + dy }
          })
        } else {
          node[current.handle] = location
          if (node.mode === 'symmetric' || node.mode === 'smooth') {
            const otherHandle = current.handle === 'incoming' ? 'outgoing' : 'incoming'
            const dx = location.x - node.x; const dy = location.y - node.y
            const currentLength = Math.hypot(dx, dy)
            const otherLength = node[otherHandle] ? Math.hypot(node[otherHandle]!.x - node.x, node[otherHandle]!.y - node.y) : currentLength
            const length = node.mode === 'symmetric' ? currentLength : otherLength
            const angle = Math.atan2(dy, dx) + Math.PI
            node[otherHandle] = { x: node.x + Math.cos(angle) * length, y: node.y + Math.sin(angle) * length }
          }
        }
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
        else if (current.tool === 'line' || current.tool === 'arrow') {
          const hovered = document.elementFromPoint(event.clientX, event.clientY)
          const hit = findAnchorHit(hovered)
          const endShape = hit ? elementsForIds(stage.node, [hit.id])[0] : undefined
          const end = endShape && hit ? anchorPosition(endShape, hit.anchor) : undefined
          if (hit && end && hit.id !== current.startTarget && canConnectToPort(endShape, 'end')) {
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
        if (hit && targetPoint && hit.id !== current.id && hit.id !== otherTarget && canConnectToPort(target, current.side)) {
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
        const constrained = current.targets.some(target => target.element.getAttribute('data-layout-constraint') === 'aspect')
        const bounds = resizedBounds(current.startBounds, current.handle, location, keepSquare, constrained ? current.startBounds.width / Math.max(current.startBounds.height, .1) : undefined)
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
        const reference = { x: 0, y: 0, ...documentSizeRef.current }
        const snapX = viewOptionsRef.current.smartGuides ? getSnap(xBounds, current.others, 'x', reference) : undefined
        const snapY = viewOptionsRef.current.smartGuides ? getSnap(yBounds, current.others, 'y', reference) : undefined
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
      if (activeStylusPointerId.current === event.pointerId) activeStylusPointerId.current = null
      if (interactionPointerId.current !== null && interactionPointerId.current !== event.pointerId) return
      const current = interaction.current
      if (!current) {
        if (interactionPointerId.current === event.pointerId) interactionPointerId.current = null
        return
      }
      interaction.current = null
      interactionPointerId.current = null
      if (current.type === 'pan') {
        stage.node.removeAttribute('data-panning')
      } else if (current.type === 'eraser') {
        if (current.changed) {
          updateConnectors(stage.node)
          select([])
          recordHistory(stage)
        }
      } else if (current.type === 'guide') {
        if (!current.moved && !current.created && current.index < viewOptionsRef.current.guides.length) setViewOptions(options => ({ ...options, guides: options.guides.filter((_guide, index) => index !== current.index) }))
      } else if (current.type === 'lasso') {
        const location = point(event, false)
        const last = current.points.at(-1)!
        if (Math.hypot(location.x - last.x, location.y - last.y) >= 1) current.points.push(location)
        if (current.moved && current.points.length >= 3) {
          const matches = directObjects(stage.node).filter(element => element.getAttribute('data-layer-locked') !== 'true' && element.getAttribute('visibility') !== 'hidden')
            .filter(element => { const box = getBox(element); return box && lassoIntersectsBox(current.points, box) })
            .map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
          select(current.additive ? [...current.initialIds, ...matches] : matches)
        } else if (!current.additive) {
          const target = findObjectTarget(stage.node, document.elementFromPoint(event.clientX, event.clientY))
          select(target?.getAttribute('data-object-id') ? [target.getAttribute('data-object-id')!] : [])
        }
        renderOverlay(stage, selectedIdsRef.current)
      } else if (current.type === 'gradient-handle') {
        if (current.moved) recordHistory(stage)
        select([current.element.getAttribute('data-object-id') ?? ''])
      } else if (current.type === 'freehand') {
        const location = point(event)
        appendFreehandSample(current.points, location, .5)
        current.element.attr('d', current.pressureSensitive ? pressureStroke(current.points, strokeWidthRef.current, pressureSensitivityRef.current, tiltSensitivityRef.current) : smoothStroke(current.points, smoothingRef.current))
        current.element.attr('data-freehand-points', JSON.stringify([current.points]))
        const bounds = pointsBounds(current.points)
        const hasStylusDynamics = current.pressureSensitive && current.points.some(point => Math.abs((point.pressure ?? .5) - .5) > .08 || Math.hypot(point.tiltX ?? 0, point.tiltY ?? 0) > 8)
        if (smartDrawingRef.current && !hasStylusDynamics) {
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
                if (current.pressureSensitive) {
                  replacement.setAttribute('stroke', strokeColorRef.current)
                  replacement.setAttribute('stroke-width', String(strokeWidthRef.current))
                }
                replacement.setAttribute('x1', rounded(recognition.start.x)); replacement.setAttribute('y1', rounded(recognition.start.y))
                replacement.setAttribute('x2', rounded(recognition.end.x)); replacement.setAttribute('y2', rounded(recognition.end.y))
                current.element.node.replaceWith(replacement)
              } else {
                const replacement = createLibraryShapeNode(recognition.shapeId, shapeTransformBox(recognition.shapeId, recognition.box), current.element.node, current.id)
                replacement.setAttribute('fill', fillEnabledRef.current ? fillColorRef.current : 'none')
                if (current.pressureSensitive) {
                  replacement.setAttribute('stroke', strokeColorRef.current)
                  replacement.setAttribute('stroke-width', String(strokeWidthRef.current))
                  replacement.setAttribute('stroke-linecap', 'round')
                  replacement.setAttribute('stroke-linejoin', 'round')
                }
                current.element.node.replaceWith(replacement)
              }
            }
          }
        }
        updateConnectors(stage.node)
        recordHistory(stage)
        select([])
      } else if (current.type === 'pen-node') {
        if (current.moved) recordHistory(stage)
        select([current.element.getAttribute('data-object-id') ?? ''])
      } else if (current.type === 'draw') {
        current.keepTool = current.keepTool || event.ctrlKey
        if (current.tool === 'line' || current.tool === 'arrow') {
          const hit = findAnchorHit(document.elementFromPoint(event.clientX, event.clientY))
          const target = hit ? elementsForIds(stage.node, [hit.id])[0] : undefined
          const anchor = target && hit ? anchorPosition(target, hit.anchor) : undefined
          if (hit && anchor && hit.id !== current.startTarget && canConnectToPort(target, 'end')) {
            current.element.plot(current.x, current.y, anchor.x, anchor.y)
            current.element.attr({ 'data-end-target': hit.id, 'data-end-anchor': hit.anchor })
          }
          updateConnectors(stage.node)
        }
        stage.node.removeAttribute('data-connector-dragging')
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
        const ids = new Set(elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.getAttribute('data-layer-locked') !== 'true').map(element => element.getAttribute('data-object-id') ?? ''))
        if (!ids.size) return
        detachConnectors(stage.node, [...ids])
        elementsForIds(stage.node, [...ids]).forEach(element => {
          if (element.tagName.toLowerCase() === 'line') {
            const id = element.getAttribute('data-object-id')
            if (id) {
              stage.node.querySelector(`[data-connector-visual-for="${CSS.escape(id)}"]`)?.remove()
              stage.node.querySelector(`[data-connector-label-for="${CSS.escape(id)}"]`)?.remove()
            }
          }
          element.remove()
        })
        updateConnectors(stage.node)
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
      const editingText = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'))
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !editingText && event.key.toLowerCase() === shortcutKeyRef.current.toLowerCase()) {
        event.preventDefault(); event.stopPropagation(); setCommandPaletteOpen(true); setCommandQuery(''); return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
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
      const clickedText = event.target instanceof Element ? event.target.closest('text') as SVGElement | null : null
      if (clickedText) {
        event.preventDefault()
        const bounds = getBox(clickedText)
        if (bounds) beginTextEdit({ x: bounds.x, y: bounds.y }, clickedText, event.ctrlKey)
        return
      }
      if (target && target.tagName.toLowerCase() !== 'text' && target.getAttribute('data-layer-locked') !== 'true') {
        event.preventDefault()
        const bounds = getBox(target)
        if (bounds) beginTextEdit({ x: bounds.x, y: bounds.y }, undefined, event.ctrlKey, target)
      }
    }

    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const bounds = stage.node.getBoundingClientRect()
      const current = viewBoxRef.current
      const ratioX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
      const ratioY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
      const anchorX = current.x + ratioX * current.width
      const anchorY = current.y + ratioY * current.height
      const scale = event.deltaY < 0 ? .88 : 1.14
      const width = Math.max(MIN_VIEW_EXTENT, Math.min(MAX_VIEW_EXTENT, current.width * scale))
      const height = width * current.height / current.width
      changeViewBox({ x: anchorX - ratioX * width, y: anchorY - ratioY * height, width, height })
    }
    const spaceDown = (event: KeyboardEvent) => {
      const dialog = mount.current?.closest('[role="dialog"]')
      const editing = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'))
      if (event.code !== 'Space' || editing || !(event.target instanceof Node) || !dialog?.contains(event.target)) return
      spacePanRef.current = true
      event.preventDefault()
    }
    const spaceUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePanRef.current = false
    }

    stage.node.addEventListener('pointerdown', start)
    stage.node.addEventListener('pointermove', move)
    stage.node.addEventListener('pointerup', finish)
    stage.node.addEventListener('pointercancel', finish)
    stage.node.addEventListener('keydown', keydown)
    stage.node.addEventListener('dblclick', doubleClick)
    stage.node.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', spaceDown, true)
    window.addEventListener('keyup', spaceUp, true)
    window.addEventListener('keydown', historyKeydown, true)
    return () => {
      stage.node.removeEventListener('pointerdown', start)
      stage.node.removeEventListener('pointermove', move)
      stage.node.removeEventListener('pointerup', finish)
      stage.node.removeEventListener('pointercancel', finish)
      stage.node.removeEventListener('keydown', keydown)
      stage.node.removeEventListener('dblclick', doubleClick)
      stage.node.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', spaceDown, true)
      window.removeEventListener('keyup', spaceUp, true)
      window.removeEventListener('keydown', historyKeydown, true)
      textEdit.current?.input.remove()
      textEdit.current = null
      stage.remove()
      drawing.current = null
    }
  }, [asset?.id, asset?.svg])

  useEffect(() => {
    drawing.current?.node.setAttribute('data-editor-infinite-canvas', `${infiniteCanvas}`)
  }, [infiniteCanvas])

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
    const deletable = selectedElements().filter(element => element.getAttribute('data-layer-locked') !== 'true')
    const ids = deletable.map(element => element.getAttribute('data-object-id') ?? '')
    if (!stage || !ids.length) return
    detachConnectors(stage.node, ids)
    deletable.forEach(element => {
      if (element.tagName.toLowerCase() === 'line') {
        const id = element.getAttribute('data-object-id')
        if (id) {
          stage.node.querySelector(`[data-connector-visual-for="${CSS.escape(id)}"]`)?.remove()
          stage.node.querySelector(`[data-connector-label-for="${CSS.escape(id)}"]`)?.remove()
        }
      }
      element.remove()
    })
    updateConnectors(stage.node)
    select([])
    recordHistory(stage)
    renderOverlay(stage, [])
    stage.node.focus({ preventScroll: true })
  }

  function toggleSelectedLock() {
    const stage = drawing.current
    const elements = selectedElements()
    if (!stage || !elements.length) return
    const lock = elements.some(element => element.getAttribute('data-layer-locked') !== 'true')
    elements.forEach(element => element.setAttribute('data-layer-locked', `${lock}`))
    setLayerRevision(value => value + 1)
    if (lock) select([])
    recordHistory(stage)
    renderOverlay(stage, selectedIdsRef.current)
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
    if (toolRef.current === 'freehand') setBrushPresetId('current')
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
    if (toolRef.current === 'freehand') setBrushPresetId('current')
    const stage = drawing.current
    if (!stage) return
    elementsForIds(stage.node, selectedIdsRef.current).forEach(element => element.setAttribute('stroke-width', `${value}`))
    recordHistory(stage)
  }

  function insertLibraryShape(shapeId: string) {
    const stage = drawing.current
    if (!stage) return
    const viewport = viewBoxRef.current
    const size = Math.min(120, viewport.width * .35, viewport.height * .35)
    const id = crypto.randomUUID()
    const group = createLibraryShapeNode(shapeId, {
      x: viewport.x + (viewport.width - size) / 2,
      y: viewport.y + (viewport.height - size) / 2,
      width: size,
      height: size,
    }, undefined, id)
    group.setAttribute('fill', fillEnabledRef.current ? fillColorRef.current : 'none')
    group.setAttribute('stroke', strokeColorRef.current)
    group.setAttribute('stroke-width', `${strokeWidthRef.current}`)
    group.setAttribute('stroke-linecap', 'round')
    group.setAttribute('stroke-linejoin', 'round')
    stage.node.append(group)
    updateConnectors(stage.node)
    recordHistory(stage)
    chooseTool('select')
    select([id])
    setLayerRevision(value => value + 1)
  }

  function applyBrushPreset(preset: BrushPreset) {
    strokeColorRef.current = preset.color
    strokeWidthRef.current = preset.width
    smoothingRef.current = preset.smoothing
    pressureSensitivityRef.current = preset.pressureSensitivity
    tiltSensitivityRef.current = preset.tiltSensitivity
    setStrokeColor(preset.color)
    setStrokeWidth(preset.width)
    setStylusProfile(current => ({ ...current, smoothing: preset.smoothing, pressureSensitivity: preset.pressureSensitivity, tiltSensitivity: preset.tiltSensitivity }))
    setBrushPresetId(preset.id)
  }

  function saveBrushPreset() {
    const name = brushPresetName.trim().slice(0, 32)
    if (!name) return
    const preset: BrushPreset = {
      id: crypto.randomUUID(), name, color: strokeColor, width: strokeWidth,
      smoothing: stylusProfile.smoothing, pressureSensitivity: stylusProfile.pressureSensitivity,
      tiltSensitivity: stylusProfile.tiltSensitivity,
    }
    setBrushPresets(current => [...current.filter(item => item.name.toLocaleLowerCase('pl') !== name.toLocaleLowerCase('pl')), preset].slice(-20))
    setBrushPresetId(preset.id)
    setBrushPresetName('')
  }

  function removeBrushPreset() {
    if (BUILTIN_BRUSH_PRESETS.some(item => item.id === brushPresetId)) return
    setBrushPresets(current => current.filter(item => item.id !== brushPresetId))
    setBrushPresetId('current')
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

  function alignSelectionToKey(alignment: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') {
    const stage = drawing.current
    const ids = selectedIdsRef.current
    const keyElement = stage && ids.length > 1 ? elementsForIds(stage.node, [ids[0]])[0] : undefined
    const keyBox = keyElement ? getBox(keyElement) : undefined
    if (!stage || !keyBox) return
    const horizontal = ['left', 'centerX', 'right'].includes(alignment)
    const target = horizontal
      ? alignment === 'left' ? keyBox.x : alignment === 'centerX' ? keyBox.x + keyBox.width / 2 : keyBox.x + keyBox.width
      : alignment === 'top' ? keyBox.y : alignment === 'centerY' ? keyBox.y + keyBox.height / 2 : keyBox.y + keyBox.height
    ids.slice(1).map(id => elementsForIds(stage.node, [id])[0]).filter((element): element is SVGElement => Boolean(element)).forEach(element => {
      const box = getBox(element)
      if (!box) return
      const position = horizontal
        ? alignment === 'left' ? keyBox.x : alignment === 'centerX' ? target - box.width / 2 : target - box.width
        : alignment === 'top' ? keyBox.y : alignment === 'centerY' ? target - box.height / 2 : target - box.height
      moveElementBy(element, horizontal ? position - box.x : 0, horizontal ? 0 : position - box.y)
    })
    updateConnectors(stage.node); recordHistory(stage); select(ids)
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

  function applyBoolean(operation: 'union' | 'subtract' | 'intersect' | 'exclude') {
    const stage = drawing.current
    const originals = stage ? selectedIdsRef.current.map(id => elementsForIds(stage.node, [id])[0]).filter((element): element is SVGElement => Boolean(element)) : []
    if (!stage || originals.length < 2 || (operation === 'exclude' && originals.length !== 2)) return
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
    combined.setAttribute('data-layer-name', operation === 'union' ? 'Suma kształtów' : operation === 'subtract' ? 'Różnica kształtów' : operation === 'exclude' ? 'Wykluczające się kształty' : 'Część wspólna')
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    if (operation === 'union') {
      const maskId = `editor-union-${crypto.randomUUID()}`
      const mask = document.createElementNS(SVG_NS, 'mask')
      mask.setAttribute('id', maskId); mask.setAttribute('maskUnits', 'userSpaceOnUse')
      mask.setAttribute('x', `${bounds.x}`); mask.setAttribute('y', `${bounds.y}`); mask.setAttribute('width', `${Math.max(1, bounds.width)}`); mask.setAttribute('height', `${Math.max(1, bounds.height)}`)
      originals.forEach(source => {
        const silhouette = cloneClean(source)
        ;[silhouette, ...Array.from(silhouette.querySelectorAll('*'))].forEach(node => { node.setAttribute('fill', 'white'); node.setAttribute('stroke', 'white') })
        mask.append(silhouette)
      })
      defs.append(mask)
      const silhouette = document.createElementNS(SVG_NS, 'rect')
      silhouette.setAttribute('x', `${bounds.x}`); silhouette.setAttribute('y', `${bounds.y}`); silhouette.setAttribute('width', `${Math.max(1, bounds.width)}`); silhouette.setAttribute('height', `${Math.max(1, bounds.height)}`)
      silhouette.setAttribute('fill', originals[0].getAttribute('fill') && originals[0].getAttribute('fill') !== 'none' ? originals[0].getAttribute('fill')! : fillColorRef.current)
      silhouette.setAttribute('mask', `url(#${maskId})`)
      combined.append(silhouette)
    } else if (operation === 'exclude') {
      originals.slice(0, 2).forEach((element, index) => {
        const maskId = `editor-exclude-${crypto.randomUUID()}`
        const mask = document.createElementNS(SVG_NS, 'mask')
        mask.setAttribute('id', maskId); mask.setAttribute('maskUnits', 'userSpaceOnUse')
        mask.setAttribute('x', `${bounds.x}`); mask.setAttribute('y', `${bounds.y}`)
        mask.setAttribute('width', `${Math.max(1, bounds.width)}`); mask.setAttribute('height', `${Math.max(1, bounds.height)}`)
        const white = document.createElementNS(SVG_NS, 'rect')
        white.setAttribute('x', `${bounds.x}`); white.setAttribute('y', `${bounds.y}`)
        white.setAttribute('width', `${Math.max(1, bounds.width)}`); white.setAttribute('height', `${Math.max(1, bounds.height)}`); white.setAttribute('fill', 'white')
        const other = originals[index === 0 ? 1 : 0]
        const black = cloneClean(other)
        ;[black, ...Array.from(black.querySelectorAll('*'))].forEach(node => { node.setAttribute('fill', 'black'); node.setAttribute('stroke', 'black') })
        mask.append(white, black); defs.append(mask)
        const subject = cloneClean(element)
        subject.setAttribute('mask', `url(#${maskId})`)
        combined.append(subject)
      })
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
        effect.setAttribute('x', '0'); effect.setAttribute('y', '0'); effect.setAttribute('width', `${documentSizeRef.current.width}`); effect.setAttribute('height', `${documentSizeRef.current.height}`)
        const white = document.createElementNS(SVG_NS, 'rect')
        white.setAttribute('x', '0'); white.setAttribute('y', '0'); white.setAttribute('width', `${documentSizeRef.current.width}`); white.setAttribute('height', `${documentSizeRef.current.height}`); white.setAttribute('fill', 'white')
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

  function selectedElements() {
    const stage = drawing.current
    return stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
  }

  function updateSelected(action: (element: SVGElement, index: number) => void) {
    const stage = drawing.current
    const elements = selectedElements()
    if (!stage || !elements.length) return
    elements.forEach(action)
    updateConnectors(stage.node)
    recordHistory(stage)
    select(selectedIdsRef.current)
  }

  function applyPathOperation(operation: 'close' | 'simplify' | 'split' | 'join') {
    const stage = drawing.current
    if (!stage) return
    const paths = selectedElements().filter(element => element.tagName.toLowerCase() === 'path') as SVGPathElement[]
    if (!paths.length) return
    if (operation === 'join' && paths.length > 1) {
      const sourceTransform = paths[0].getAttribute('transform') ?? ''
      if (paths.some(path => (path.getAttribute('transform') ?? '') !== sourceTransform)) {
        setWorkflowMessage('Przed połączeniem ścieżek dopasuj ich transformacje do siebie.')
        return
      }
      if (paths.some(path => path.id && stage.node.querySelector(`[href="#${CSS.escape(path.id)}"]`))) {
        setWorkflowMessage('Odłącz najpierw tekst umieszczony na tych ścieżkach.')
        return
      }
      detachConnectors(stage.node, paths.map(path => path.getAttribute('data-object-id') ?? '').filter(Boolean))
      const joined = document.createElementNS(SVG_NS, 'path')
      const id = crypto.randomUUID()
      joined.setAttribute('d', paths.map(path => path.getAttribute('d') ?? '').join(' '))
      if (sourceTransform) joined.setAttribute('transform', sourceTransform)
      joined.removeAttribute('data-editor-pen'); joined.removeAttribute('data-pen-points')
      for (const attribute of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity']) {
        const value = paths[0].getAttribute(attribute)
        if (value !== null) joined.setAttribute(attribute, value)
      }
      joined.setAttribute('data-object-id', id); joined.setAttribute('data-layer-name', 'Połączone ścieżki')
      paths.forEach(path => path.remove()); stage.node.append(joined); select([id])
    } else if (operation === 'split' && paths.length === 1) {
      const source = paths[0]
      try {
        const length = source.getTotalLength()
        if (length < 2) return
        detachConnectors(stage.node, [source.getAttribute('data-object-id') ?? ''])
        const samples = Array.from({ length: 101 }, (_, index) => source.getPointAtLength(length * index / 100))
        const pathData = (points: SVGPoint[]) => points.map((point, index) => `${index ? 'L' : 'M'} ${rounded(point.x)} ${rounded(point.y)}`).join(' ')
        const clones = [samples.slice(0, 51), samples.slice(50)].map(points => {
          const clone = source.cloneNode(false) as SVGPathElement
          clone.setAttribute('d', pathData(points)); clone.setAttribute('data-object-id', crypto.randomUUID()); clone.setAttribute('fill', 'none')
          clone.removeAttribute('data-editor-pen'); clone.removeAttribute('data-pen-points')
          clone.removeAttribute('data-group-id')
          clone.removeAttribute('id')
          return clone
        })
        if (source.id) clones[0].setAttribute('id', source.id)
        source.replaceWith(...clones); select(clones.map(element => element.getAttribute('data-object-id')!))
      } catch { setWorkflowMessage('Nie udało się podzielić tej ścieżki.') }
    } else {
      paths.forEach(path => {
        let data = path.getAttribute('d') ?? ''
        if (operation === 'close') {
          if (!/z\s*$/i.test(data)) path.setAttribute('d', `${data} Z`)
          path.removeAttribute('data-editor-pen'); path.removeAttribute('data-pen-points')
        } else {
          try {
            const length = path.getTotalLength()
            const sampleCount = Math.max(3, Math.min(800, Math.ceil(length / 2)))
            const samples = Array.from({ length: sampleCount }, (_, index) => {
              const point = path.getPointAtLength(length * index / (sampleCount - 1))
              return { x: point.x, y: point.y }
            })
            const simplified = simplifyStroke(samples, Math.max(0.5, offsetDistance / 3))
            data = simplified.map((point, index) => `${index ? 'L' : 'M'} ${rounded(point.x)} ${rounded(point.y)}`).join(' ')
            path.setAttribute('d', data); path.removeAttribute('data-editor-pen'); path.removeAttribute('data-pen-points')
          } catch { /* Ignore paths the browser cannot measure. */ }
        }
      })
    }
    updateConnectors(stage.node)
    recordHistory(stage); select(selectedIdsRef.current)
  }

  function reverseSelectedPaths() {
    const stage = drawing.current
    const paths = selectedElements().filter(element => element.tagName.toLowerCase() === 'path') as SVGPathElement[]
    if (!stage || !paths.length) return
    paths.forEach(path => {
      if (path.hasAttribute('data-editor-pen')) {
        const points = readPenPoints(path).reverse().map(point => ({ ...point, incoming: point.outgoing, outgoing: point.incoming }))
        path.setAttribute('data-pen-points', JSON.stringify(points))
        path.setAttribute('d', penPath(points) + (/z\s*$/i.test(path.getAttribute('d') ?? '') ? ' Z' : ''))
      } else {
        const reversed = reversePathData(path)
        if (reversed) path.setAttribute('d', reversed)
      }
    })
    recordHistory(stage); select(selectedIdsRef.current)
  }

  function convertStrokeToPath() {
    const stage = drawing.current
    const sources = selectedElements().filter(element => {
      const tag = element.tagName.toLowerCase()
      if (element.getAttribute('stroke') === 'none') return false
      if (tag === 'path') return !/z\s*$/i.test(element.getAttribute('d') ?? '')
      return tag === 'line' && !element.hasAttribute('data-start-target') && !element.hasAttribute('data-end-target') && !element.hasAttribute('data-auto-route')
    })
    if (!stage || !sources.length) return
    let converted = 0
    sources.forEach(source => {
      const sourceTag = source.tagName.toLowerCase()
      const path = sourceTag === 'path' ? source as SVGPathElement : document.createElementNS(SVG_NS, 'path')
      if (sourceTag === 'line') {
        path.setAttribute('d', `M ${source.getAttribute('x1') ?? 0} ${source.getAttribute('y1') ?? 0} L ${source.getAttribute('x2') ?? 0} ${source.getAttribute('y2') ?? 0}`)
        const transform = source.getAttribute('transform')
        if (transform) path.setAttribute('transform', transform)
        path.setAttribute('stroke-width', source.getAttribute('stroke-width') ?? `${strokeWidthRef.current}`)
        path.setAttribute('stroke', source.getAttribute('stroke') ?? strokeColorRef.current)
        stage.node.append(path)
      }
      const outlined = outlineOpenStroke(path)
      if (sourceTag === 'line') path.remove()
      if (!outlined) return
      const id = source.getAttribute('data-object-id') ?? crypto.randomUUID()
      outlined.setAttribute('fill', source.getAttribute('stroke') ?? strokeColorRef.current)
      outlined.setAttribute('stroke', 'none')
      outlined.setAttribute('fill-rule', 'evenodd')
      for (const attribute of ['transform', 'opacity', 'data-layer-name', 'data-group-id']) {
        const value = source.getAttribute(attribute)
        if (value !== null) outlined.setAttribute(attribute, value)
      }
      outlined.setAttribute('data-object-id', id)
      outlined.setAttribute('data-layer-name', `${source.getAttribute('data-layer-name') || 'Ścieżka'} · kontur`)
      source.replaceWith(outlined)
      converted++
    })
    if (converted) { recordHistory(stage); select(selectedIdsRef.current); setWorkflowMessage(`Zamieniono obrysy na wypełnione ścieżki (${converted}).`) }
    else setWorkflowMessage('Zamiana działa na otwartych ścieżkach i zwykłych liniach.')
  }

  function roundSelectedPenNodes() {
    const stage = drawing.current
    const path = selectedElements().find(element => element.hasAttribute('data-editor-pen')) as SVGPathElement | undefined
    const selected = selectedPenNodeIndicesRef.current.length ? selectedPenNodeIndicesRef.current : selectedPenNodeIndex === null ? [] : [selectedPenNodeIndex]
    if (!stage || !path || !selected.length) return
    const points = readPenPoints(path)
    const radius = Math.max(.1, cornerRadius)
    selected.filter(index => index > 0 && index < points.length - 1).sort((a, b) => b - a).forEach(index => {
      const previous = points[index - 1]
      const node = points[index]
      const next = points[index + 1]
      const beforeLength = Math.hypot(previous.x - node.x, previous.y - node.y)
      const afterLength = Math.hypot(next.x - node.x, next.y - node.y)
      const trim = Math.min(radius, beforeLength * .42, afterLength * .42)
      if (trim < .1) return
      const beforeDirection = { x: (previous.x - node.x) / beforeLength, y: (previous.y - node.y) / beforeLength }
      const afterDirection = { x: (next.x - node.x) / afterLength, y: (next.y - node.y) / afterLength }
      const before: PenNode = {
        x: node.x + beforeDirection.x * trim, y: node.y + beforeDirection.y * trim,
        mode: 'smooth', outgoing: { x: node.x + beforeDirection.x * trim * .45, y: node.y + beforeDirection.y * trim * .45 },
      }
      const after: PenNode = {
        x: node.x + afterDirection.x * trim, y: node.y + afterDirection.y * trim,
        mode: 'smooth', incoming: { x: node.x + afterDirection.x * trim * .45, y: node.y + afterDirection.y * trim * .45 },
      }
      points.splice(index, 1, before, after)
    })
    const closed = /z\s*$/i.test(path.getAttribute('d') ?? '')
    path.setAttribute('data-pen-points', JSON.stringify(points)); path.setAttribute('d', `${penPath(points)}${closed ? ' Z' : ''}`)
    selectedPenNodeIndicesRef.current = []
    setSelectedPenNodeIndices([]); setSelectedPenNodeIndex(null)
    stage.node.removeAttribute('data-selected-pen-nodes'); stage.node.removeAttribute('data-selected-pen-node')
    recordHistory(stage); renderOverlay(stage, selectedIdsRef.current)
  }

  function applyFillRule(value: 'nonzero' | 'evenodd') {
    setFillRule(value)
    updateSelected(element => { if (element.tagName.toLowerCase() === 'path' || element.tagName.toLowerCase() === 'polygon') element.setAttribute('fill-rule', value) })
  }

  function applyBlendMode(value: string) {
    setBlendMode(value)
    updateSelected(element => { if (value === 'normal') element.removeAttribute('mix-blend-mode'); else element.setAttribute('mix-blend-mode', value) })
  }

  function createSelectionMask() {
    const stage = drawing.current
    const ids = selectedIdsRef.current
    if (!stage || ids.length < 2) return
    const target = elementsForIds(stage.node, [ids[0]])[0]
    const source = elementsForIds(stage.node, [ids.at(-1)!])[0]
    if (!target || !source || target === source) return
    const bounds = getBox(source)
    if (!bounds) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const id = `editor-mask-${crypto.randomUUID()}`
    const mask = document.createElementNS(SVG_NS, 'mask')
    mask.setAttribute('id', id); mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('maskContentUnits', 'userSpaceOnUse')
    mask.setAttribute('x', `${bounds.x}`); mask.setAttribute('y', `${bounds.y}`); mask.setAttribute('width', `${Math.max(1, bounds.width)}`); mask.setAttribute('height', `${Math.max(1, bounds.height)}`)
    const shape = source.cloneNode(true) as SVGElement
    ;[shape, ...Array.from(shape.querySelectorAll('*'))].forEach(node => { node.removeAttribute('data-object-id'); node.removeAttribute('data-layer-name'); node.setAttribute('fill', '#fff'); node.setAttribute('stroke', '#fff') })
    mask.append(shape); defs.append(mask)
    target.setAttribute('mask', `url(#${id})`)
    source.setAttribute('visibility', 'hidden'); source.setAttribute('data-layer-name', `${source.getAttribute('data-layer-name') || 'Kształt'} · źródło maski`)
    recordHistory(stage); select([target.getAttribute('data-object-id') ?? ''])
  }

  function applyStrokeOffset() {
    const stage = drawing.current
    if (!stage) return
    const elements = selectedElements()
    elements.forEach(source => {
      const clone = source.cloneNode(true) as SVGElement
      const id = source.getAttribute('data-object-id') ?? crypto.randomUUID()
      const label = source.getAttribute('data-layer-name') ?? 'Obrys'
      source.removeAttribute('data-object-id'); source.removeAttribute('data-layer-name')
      clone.removeAttribute('data-object-id'); clone.removeAttribute('data-layer-name')
      clone.setAttribute('fill', 'none')
      clone.setAttribute('stroke', fillColorRef.current)
      clone.setAttribute('stroke-width', `${Math.max(.5, Number(source.getAttribute('stroke-width')) || strokeWidthRef.current) + Math.max(0, offsetDistance) * 2}`)
      clone.setAttribute('stroke-linejoin', 'round'); clone.setAttribute('pointer-events', 'none')
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('data-object-id', id); group.setAttribute('data-layer-name', label); group.setAttribute('data-layout-constraint', source.getAttribute('data-layout-constraint') ?? '')
      if (!source.getAttribute('data-layout-constraint')) group.removeAttribute('data-layout-constraint')
      group.append(clone, source); source.replaceWith(group)
    })
    recordHistory(stage); select(selectedIdsRef.current)
    setWorkflowMessage('Dodano edytowalny obrys o wskazanym odsunięciu.')
  }

  function clipSelectedImage() {
    const stage = drawing.current
    const elements = selectedElements()
    const image = elements.find(element => element.tagName.toLowerCase() === 'image')
    const shape = elements.find(element => element !== image && element.tagName.toLowerCase() !== 'text')
    if (!stage || !image || !shape) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const clip = document.createElementNS(SVG_NS, 'clipPath')
    const id = `clip-${crypto.randomUUID()}`
    clip.setAttribute('id', id); clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
    const clone = shape.cloneNode(true) as SVGElement
    clone.removeAttribute('data-object-id'); clone.removeAttribute('data-layer-name'); clone.removeAttribute('fill'); clone.removeAttribute('stroke')
    clip.append(clone); defs.append(clip); image.setAttribute('clip-path', `url(#${id})`)
    shape.setAttribute('visibility', 'hidden')
    shape.setAttribute('data-layer-name', `${shape.getAttribute('data-layer-name') || 'Kształt'} · maska przycięcia`)
    recordHistory(stage); select([image.getAttribute('data-object-id') ?? '']); setWorkflowMessage('Przycięto obraz do kształtu. Kształt źródłowy ukryto; możesz go przywrócić w warstwach.')
  }

  function applyGradient() {
    const stage = drawing.current
    const elements = selectedElements()
    if (!stage || !elements.length) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const id = `gradient-${crypto.randomUUID()}`
    const gradient = document.createElementNS(SVG_NS, gradientKind === 'linear' ? 'linearGradient' : 'radialGradient')
    gradient.setAttribute('id', id); gradient.setAttribute('gradientUnits', 'objectBoundingBox')
    if (gradientKind === 'linear') {
      const radians = gradientAngle * Math.PI / 180
      gradient.setAttribute('x1', `${50 - Math.cos(radians) * 50}%`); gradient.setAttribute('y1', `${50 - Math.sin(radians) * 50}%`)
      gradient.setAttribute('x2', `${50 + Math.cos(radians) * 50}%`); gradient.setAttribute('y2', `${50 + Math.sin(radians) * 50}%`)
    } else { gradient.setAttribute('cx', '50%'); gradient.setAttribute('cy', '50%'); gradient.setAttribute('r', '70%') }
    for (const [offset, color] of [['0%', fillColor], ['50%', gradientMiddle], ['100%', strokeColor]] as const) {
      const stop = document.createElementNS(SVG_NS, 'stop')
      stop.setAttribute('offset', offset); stop.setAttribute('stop-color', color); gradient.append(stop)
    }
    defs.append(gradient)
    elements.forEach(element => element.setAttribute('fill', `url(#${id})`))
    recordHistory(stage)
  }

  function applyPattern() {
    const stage = drawing.current
    const elements = selectedElements()
    if (!stage || !elements.length) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const pattern = document.createElementNS(SVG_NS, 'pattern')
    const id = `pattern-${crypto.randomUUID()}`
    const size = Math.max(4, patternTileSize)
    pattern.setAttribute('id', id); pattern.setAttribute('patternUnits', 'userSpaceOnUse'); pattern.setAttribute('width', `${size}`); pattern.setAttribute('height', `${size}`)
    if (patternBackground) { const background = document.createElementNS(SVG_NS, 'rect'); background.setAttribute('width', `${size}`); background.setAttribute('height', `${size}`); background.setAttribute('fill', patternBackground); pattern.append(background) }
    if (patternKind === 'dots') {
      const dot = document.createElementNS(SVG_NS, 'circle'); dot.setAttribute('cx', `${size / 2}`); dot.setAttribute('cy', `${size / 2}`); dot.setAttribute('r', `${Math.max(1, patternStrokeWidth)}`); dot.setAttribute('fill', strokeColor); pattern.append(dot)
    } else {
      const line = document.createElementNS(SVG_NS, 'path')
      line.setAttribute('d', patternKind === 'lines' ? `M 0 ${size / 2} H ${size}` : `M 0 ${size} L ${size} 0 M ${-size} ${size} L ${size} ${-size} M 0 ${size * 2} L ${size * 2} 0`)
      line.setAttribute('stroke', strokeColor); line.setAttribute('stroke-width', `${Math.max(.5, patternStrokeWidth)}`); pattern.append(line)
    }
    defs.append(pattern); elements.forEach(element => element.setAttribute('fill', `url(#${id})`)); recordHistory(stage)
  }

  function applyTextToPath() {
    const stage = drawing.current
    const elements = selectedElements()
    const path = elements.find(element => element.tagName.toLowerCase() === 'path')
    const text = elements.find(element => element.tagName.toLowerCase() === 'text')
    if (!stage || !path || !text) return
    const pathId = path.id || `text-path-${crypto.randomUUID()}`
    path.setAttribute('id', pathId)
    const textPath = document.createElementNS(SVG_NS, 'textPath')
    textPath.setAttribute('href', `#${pathId}`); textPath.setAttribute('startOffset', `${textPathOffset}%`); textPath.setAttribute('side', textPathSide); textPath.textContent = text.textContent ?? ''
    const result = document.createElementNS(SVG_NS, 'text')
    for (const attribute of ['fill', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor']) {
      const value = text.getAttribute(attribute)
      if (value !== null) result.setAttribute(attribute, value)
    }
    const id = crypto.randomUUID()
    result.setAttribute('data-object-id', id); result.setAttribute('data-layer-name', 'Tekst na ścieżce'); result.setAttribute('text-anchor', textPathAnchor); result.setAttribute('dy', `${textPathDistance}px`); result.append(textPath)
    text.replaceWith(result); select([id]); recordHistory(stage)
  }

  function applyTextPathOptions(offset = textPathOffset, anchor = textPathAnchor, side = textPathSide, distance = textPathDistance) {
    const stage = drawing.current
    const text = selectedElements().find(element => element.querySelector('textPath'))
    const textPath = text?.querySelector('textPath')
    if (!stage || !text || !textPath) return
    textPath.setAttribute('startOffset', `${offset}%`)
    textPath.setAttribute('side', side)
    text.setAttribute('text-anchor', anchor)
    text.setAttribute('dy', `${distance}px`)
    recordHistory(stage); select(selectedIdsRef.current)
  }

  function replaceDocumentFont(from: string, to: string) {
    const stage = drawing.current
    if (!stage || !from || !to) return
    let changed = 0
    stage.node.querySelectorAll<SVGTextElement>('text').forEach(text => {
      if ((text.getAttribute('font-family') ?? '').trim() === from) { text.setAttribute('font-family', to); changed++ }
    })
    if (changed) { recordHistory(stage); select(selectedIdsRef.current); setWorkflowMessage(`Zamieniono krój pisma w ${changed} elementach tekstowych.`) }
  }

  function addNamedColor() {
    const name = colorNameDraft.trim()
    if (!name) return
    setNamedColors(current => [...current.filter(item => item.name !== name), { name, color: fillColor }].slice(-24))
    setColorNameDraft('')
  }

  function replaceDocumentColor(from: string, to: string) {
    const stage = drawing.current
    const source = toHexColor(from)
    const target = toHexColor(to)
    if (!stage || !source || !target) return
    let changed = 0
    const apply = (element: Element, attribute: string, styleKey?: string) => {
      const value = attribute === 'style' ? (element as SVGElement).style.getPropertyValue(styleKey ?? '') : element.getAttribute(attribute)
      if (!value || toHexColor(value)?.toLowerCase() !== source.toLowerCase()) return
      if (attribute === 'style') (element as SVGElement).style.setProperty(styleKey ?? '', target)
      else element.setAttribute(attribute, target)
      changed++
    }
    stage.node.querySelectorAll<SVGElement>('[fill], [stroke], [stop-color], [style]').forEach(element => {
      for (const attribute of ['fill', 'stroke', 'stop-color']) apply(element, attribute)
      for (const key of ['fill', 'stroke', 'stop-color']) apply(element, 'style', key)
    })
    if (changed) { recordHistory(stage); select(selectedIdsRef.current); setWorkflowMessage(`Zamieniono kolor w ${changed} miejscach dokumentu.`) }
  }

  function applyImageAdjustments(overrides: { brightness?: number; contrast?: number; saturation?: number } = {}) {
    const stage = drawing.current
    const images = selectedElements().filter(element => element.tagName.toLowerCase() === 'image') as SVGImageElement[]
    if (!stage || !images.length) return
    const brightness = overrides.brightness ?? imageBrightness
    const contrast = overrides.contrast ?? imageContrast
    const saturationValue = overrides.saturation ?? imageSaturation
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    images.forEach(image => {
      const id = image.getAttribute('data-image-filter') ?? `image-filter-${crypto.randomUUID()}`
      image.setAttribute('data-image-filter', id)
      let filter = defs.querySelector<SVGFilterElement>(`filter[id="${CSS.escape(id)}"]`)
      if (!filter) { filter = document.createElementNS(SVG_NS, 'filter'); filter.setAttribute('id', id); filter.setAttribute('color-interpolation-filters', 'sRGB'); defs.append(filter) }
      filter.replaceChildren()
      const saturation = document.createElementNS(SVG_NS, 'feColorMatrix')
      saturation.setAttribute('type', 'saturate'); saturation.setAttribute('values', `${saturationValue / 100}`)
      const transfer = document.createElementNS(SVG_NS, 'feComponentTransfer')
      const intercept = (brightness - 100) / 100 + .5 * (1 - contrast / 100)
      for (const channel of ['R', 'G', 'B']) {
        const functionNode = document.createElementNS(SVG_NS, `feFunc${channel}`)
        functionNode.setAttribute('type', 'linear'); functionNode.setAttribute('slope', `${contrast / 100}`); functionNode.setAttribute('intercept', `${intercept}`)
        transfer.append(functionNode)
      }
      const alpha = document.createElementNS(SVG_NS, 'feFuncA'); alpha.setAttribute('type', 'identity'); transfer.append(alpha)
      filter.append(saturation, transfer); image.setAttribute('filter', `url(#${id})`)
    })
    recordHistory(stage)
  }

  function resetImageAdjustments() {
    setImageBrightness(100); setImageContrast(100); setImageSaturation(100)
    const stage = drawing.current
    const images = selectedElements().filter(image => image.tagName.toLowerCase() === 'image')
    if (!stage || !images.length) return
    images.forEach(image => {
      const filterId = image.getAttribute('data-image-filter')
      if (filterId) stage.node.querySelector(`filter[id="${CSS.escape(filterId)}"]`)?.remove()
      image.removeAttribute('filter'); image.removeAttribute('data-image-filter')
    })
    recordHistory(stage)
  }

  async function relinkImage(file?: File) {
    const stage = drawing.current
    const image = stage ? elementsForIds(stage.node, [linkedImageId])[0] as SVGImageElement | undefined : undefined
    if (!stage || !image || !file || !/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) return
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
      image.setAttribute('href', data); image.setAttribute('data-layer-name', file.name)
      recordHistory(stage); setWorkflowMessage(`Osadzono obraz ${file.name} w dokumencie SVG.`)
    } catch { setWorkflowMessage('Nie udało się podpiąć wybranego pliku obrazu.') }
  }

  function saveSelectionAsAsset() {
    const stage = drawing.current
    const selected = selectedElements()
    if (!stage || !selected.length) return
    const root = document.createElementNS(SVG_NS, 'svg')
    root.setAttribute('xmlns', SVG_NS); root.setAttribute('viewBox', `0 0 ${documentSize.width} ${documentSize.height}`)
    const defs = stage.node.querySelector('defs')
    if (defs) root.append(defs.cloneNode(true))
    selected.forEach(element => root.append(element.cloneNode(true)))
    const name = assetNameDraft.trim() || selected[0].getAttribute('data-layer-name') || 'Zasób SVG'
    const markup = sanitizeSvg(new XMLSerializer().serializeToString(root))
    setAssetLibrary(current => [...current, { id: crypto.randomUUID(), name, markup, kind: 'component' as const }].slice(-40))
    setAssetNameDraft('')
    setWorkflowMessage(`Dodano „${name}” do biblioteki zasobów.`)
  }

  function insertLibraryAsset(id: string) {
    const stage = drawing.current
    const assetItem = assetLibrary.find(item => item.id === id)
    if (!stage || !assetItem) return
    try {
      const parsed = new DOMParser().parseFromString(sanitizeSvg(assetItem.markup), 'image/svg+xml')
      const defsSource = parsed.documentElement.querySelector('defs')
      const rootDefs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
      if (!rootDefs.parentNode) stage.node.prepend(rootDefs)
      const definitionCopies = defsSource ? Array.from(defsSource.children).map(element => element.cloneNode(true) as Element) : []
      const objectCopies = Array.from(parsed.documentElement.children).filter(element => element.tagName.toLowerCase() !== 'defs').map(element => element.cloneNode(true) as Element)
      const copies = [...definitionCopies, ...objectCopies]
      const idMap = new Map<string, string>()
      copies.forEach(copy => [copy, ...Array.from(copy.querySelectorAll('*'))].forEach(element => {
        const old = element.getAttribute('id')
        if (old) { const next = `asset-${crypto.randomUUID()}`; idMap.set(old, next); element.setAttribute('id', next) }
      }))
      copies.forEach(copy => [copy, ...Array.from(copy.querySelectorAll('*'))].forEach(element => Array.from(element.attributes).forEach(attribute => {
        let value = attribute.value
        idMap.forEach((next, old) => { value = value.replaceAll(`url(#${old})`, `url(#${next})`).replaceAll(`#${old}`, `#${next}`) })
        element.setAttribute(attribute.name, value)
        element.removeAttribute('data-object-id'); element.removeAttribute('data-group-id')
      })))
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('data-object-id', crypto.randomUUID()); group.setAttribute('data-layer-name', assetItem.name)
      if (assetItem.packageId) {
        const sourceBox = (parsed.documentElement.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
        if (sourceBox.length === 4 && sourceBox.every(Number.isFinite) && sourceBox[2] > 0 && sourceBox[3] > 0) {
          const [, , sourceWidth, sourceHeight] = sourceBox
          const scale = Math.max(.01, Math.min(2, 160 / sourceWidth, 100 / sourceHeight))
          const centerX = viewBoxRef.current.x + viewBoxRef.current.width / 2
          const centerY = viewBoxRef.current.y + viewBoxRef.current.height / 2
          const offsetX = centerX - (sourceBox[0] + sourceWidth / 2) * scale
          const offsetY = centerY - (sourceBox[1] + sourceHeight / 2) * scale
          group.setAttribute('transform', `translate(${rounded(offsetX)} ${rounded(offsetY)}) scale(${rounded(scale)}) translate(${-sourceBox[0]} ${-sourceBox[1]})`)
        }
      }
      definitionCopies.forEach(copy => rootDefs.append(copy))
      objectCopies.forEach(copy => group.append(copy))
      stage.node.append(group); recordHistory(stage); select([group.getAttribute('data-object-id') ?? ''])
    } catch { setWorkflowMessage('Nie udało się wstawić zapisanego zasobu SVG.') }
  }

  function flowTextIntoShape() {
    const stage = drawing.current
    const elements = selectedElements()
    const text = elements.find(element => element.tagName.toLowerCase() === 'text') as SVGTextElement | undefined
    const shape = elements.find(element => !['text', 'line'].includes(element.tagName.toLowerCase()))
    const bounds = shape ? getBox(shape) : undefined
    if (!stage || !text || !shape || !bounds) return
    const fontSize = Number(text.getAttribute('font-size')) || fontSizeRef.current
    const lineHeight = fontSize * Math.max(.5, Number.parseFloat(text.getAttribute('line-height') ?? '1.2') || 1.2)
    const maxWidth = Math.max(10, bounds.width - fontSize * .4)
    const maxLines = Math.max(1, Math.floor((bounds.height - fontSize * .25) / lineHeight))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) context.font = `${text.getAttribute('font-weight') ?? '400'} ${fontSize}px ${text.getAttribute('font-family') ?? 'sans-serif'}`
    const words = (text.textContent ?? '').trim().split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let line = ''
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word
      const width = context?.measureText(candidate).width ?? candidate.length * fontSize * .55
      if (line && width > maxWidth) { lines.push(line); line = word }
      else line = candidate
    })
    if (line) lines.push(line)
    const visibleLines = lines.slice(0, maxLines)
    text.replaceChildren()
    visibleLines.forEach((content, index) => {
      const span = document.createElementNS(SVG_NS, 'tspan')
      span.setAttribute('x', `${bounds.x + fontSize * .2}`)
      span.setAttribute('dy', index === 0 ? `${fontSize}` : `${lineHeight}`)
      span.textContent = content
      text.append(span)
    })
    text.setAttribute('x', `${bounds.x + fontSize * .2}`); text.setAttribute('y', `${bounds.y}`)
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const id = `text-flow-${crypto.randomUUID()}`
    const clip = document.createElementNS(SVG_NS, 'clipPath')
    clip.setAttribute('id', id); clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
    const source = shape.cloneNode(true) as SVGElement
    ;[source, ...Array.from(source.querySelectorAll('*'))].forEach(element => { element.removeAttribute('data-object-id'); element.removeAttribute('data-layer-name') })
    clip.append(source); defs.append(clip); text.setAttribute('clip-path', `url(#${id})`)
    recordHistory(stage); select([text.getAttribute('data-object-id') ?? ''])
    setWorkflowMessage(lines.length > visibleLines.length ? `Tekst dopasowano do kształtu; pominięto ${lines.length - visibleLines.length} wierszy.` : `Tekst ułożono w ${visibleLines.length} wierszach wewnątrz kształtu.`)
  }

  function applyImageTransform(axis: 'x' | 'y') {
    updateSelected(element => {
      if (element.tagName.toLowerCase() !== 'image') return
      const box = { x: Number(element.getAttribute('x')) || 0, y: Number(element.getAttribute('y')) || 0, width: Number(element.getAttribute('width')) || 1, height: Number(element.getAttribute('height')) || 1 }
      if (!element.hasAttribute('data-editor-base-transform')) element.setAttribute('data-editor-base-transform', element.getAttribute('transform') ?? '')
      const key = axis === 'x' ? 'data-image-flip-x' : 'data-image-flip-y'
      const next = element.getAttribute(key) !== 'true'
      if (next) element.setAttribute(key, 'true')
      else element.removeAttribute(key)
      const transforms = [element.getAttribute('data-editor-base-transform')]
      if (element.getAttribute('data-image-flip-x') === 'true') transforms.push(`translate(${2 * box.x + box.width} 0) scale(-1 1)`)
      if (element.getAttribute('data-image-flip-y') === 'true') transforms.push(`translate(0 ${2 * box.y + box.height}) scale(1 -1)`)
      const transform = transforms.filter(Boolean).join(' ').trim()
      if (transform) element.setAttribute('transform', transform)
      else element.removeAttribute('transform')
    })
  }

  async function replaceSelectedImage(file?: File) {
    const stage = drawing.current
    const image = selectedElements().find(element => element.tagName.toLowerCase() === 'image') as SVGImageElement | undefined
    if (!stage || !image || !file || !/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) return
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(); reader.onerror = () => reject(); reader.readAsDataURL(file) })
      image.setAttribute('href', data); image.setAttribute('data-layer-name', file.name); recordHistory(stage)
      setWorkflowMessage(`Zastąpiono obraz plikiem ${file.name}.`)
    } catch { setWorkflowMessage('Nie udało się zastąpić obrazu.') }
  }

  function copyStyle() {
    const element = selectedElements()[0]
    if (!element) return
    setSelectedStyle({ fill: element.getAttribute('fill') ?? 'none', stroke: element.getAttribute('stroke') ?? 'none', strokeWidth: element.getAttribute('stroke-width') ?? '1', opacity: element.getAttribute('opacity') ?? '1', fontSize: element.getAttribute('font-size') ?? '', fontFamily: element.getAttribute('font-family') ?? '' })
  }

  function pasteStyle() {
    if (!selectedStyle) return
    updateSelected(element => {
      for (const [attribute, value] of [['fill', selectedStyle.fill], ['stroke', selectedStyle.stroke], ['stroke-width', selectedStyle.strokeWidth], ['opacity', selectedStyle.opacity], ['font-size', selectedStyle.fontSize], ['font-family', selectedStyle.fontFamily]] as const) {
        if (value) element.setAttribute(attribute, value)
      }
    })
  }

  function saveCustomPalette() {
    const name = paletteNameDraft.trim()
    if (!name) return
    const preset: SvgPalettePreset = { id: crypto.randomUUID(), name, colors: paletteDraftColors.map(color => toHexColor(color) ?? '#596fd8') }
    setCustomPalettes(current => [...current.filter(item => item.name.toLocaleLowerCase('pl') !== name.toLocaleLowerCase('pl')), preset].slice(-20))
    setActivePaletteId(preset.id); setPaletteNameDraft('')
    setWorkflowMessage(`Zapisano paletę „${name}”.`)
  }

  function removeCustomPalette(id: string) {
    setCustomPalettes(current => current.filter(item => item.id !== id))
    if (activePaletteId === id) setActivePaletteId('')
  }

  function saveStylePreset() {
    const element = selectedElements()[0]
    if (!element) return
    const name = window.prompt('Nazwa zapisywanego stylu:')?.trim()
    if (!name) return
    const preset = { name, fill: element.getAttribute('fill') ?? 'none', stroke: element.getAttribute('stroke') ?? 'none', strokeWidth: element.getAttribute('stroke-width') ?? '1', opacity: element.getAttribute('opacity') ?? '1', fontSize: element.getAttribute('font-size') ?? '', fontFamily: element.getAttribute('font-family') ?? '' }
    setStylePresets(current => {
      const next = [...current.filter(item => item.name !== name), preset].slice(-20)
      try { localStorage.setItem('no-tie-svg-style-presets', JSON.stringify(next)) } catch { /* Keep the preset for this editing session. */ }
      return next
    })
  }

  function applyStylePreset(preset: (typeof stylePresets)[number]) {
    updateSelected(element => {
      for (const [attribute, value] of [['fill', preset.fill], ['stroke', preset.stroke], ['stroke-width', preset.strokeWidth], ['opacity', preset.opacity], ['font-size', preset.fontSize], ['font-family', preset.fontFamily]] as const) {
        if (value) element.setAttribute(attribute, value)
      }
    })
  }

  function addSelectedNodeTitle() {
    updateSelected((element, index) => {
      if (!element.getAttribute('aria-label')) element.setAttribute('aria-label', element.getAttribute('data-layer-name') || `${element.tagName.toLowerCase()} ${index + 1}`)
    })
  }

  function inspectAccessibility() {
    const stage = drawing.current
    if (!stage) return
    const objects = directObjects(stage.node)
    const issues: string[] = []
    objects.forEach((element, index) => {
      const label = element.getAttribute('aria-label') || element.querySelector('title')?.textContent
      if (!label) issues.push(`${element.tagName.toLowerCase()} ${index + 1}: brak opisu dostępności`)
      if (element.tagName.toLowerCase() === 'image' && !(element as SVGImageElement).getAttribute('aria-label')) issues.push(`${element.tagName.toLowerCase()} ${index + 1}: obraz nie ma tekstu alternatywnego`)
      if (element.tagName.toLowerCase() === 'text') {
        const contrast = colorContrastOnWhite(element.getAttribute('fill') ?? '#000000')
        if (contrast !== undefined && contrast < 4.5) issues.push(`tekst ${index + 1}: kontrast ${contrast.toFixed(1)}:1 jest niższy niż zalecane 4.5:1 na białym tle`)
      }
    })
    setAccessibilityReport(issues); setAccessibilityOpen(true)
  }

  function applyAccessibilityExport() {
    const stage = drawing.current
    if (!stage) return
    const title = stage.node.querySelector('title') ?? document.createElementNS(SVG_NS, 'title')
    const description = stage.node.querySelector('desc') ?? document.createElementNS(SVG_NS, 'desc')
    title.id ||= `svg-title-${crypto.randomUUID()}`
    description.id ||= `svg-description-${crypto.randomUUID()}`
    title.textContent = documentA11yTitle.trim() || 'Schemat SVG'
    description.textContent = documentA11yDescription.trim() || 'Diagram wektorowy.'
    if (!title.parentNode) stage.node.prepend(title)
    if (!description.parentNode) title.after(description)
    stage.node.setAttribute('role', 'img')
    stage.node.setAttribute('aria-labelledby', `${title.id} ${description.id}`)
    stage.node.setAttribute('focusable', 'true')
    const ordered = directObjects(stage.node)
      .filter(element => !['line'].includes(element.tagName.toLowerCase()))
      .sort((first, second) => {
        const firstOrder = Number(first.getAttribute('data-a11y-order'))
        const secondOrder = Number(second.getAttribute('data-a11y-order'))
        const firstHasOrder = Number.isFinite(firstOrder) && firstOrder > 0
        const secondHasOrder = Number.isFinite(secondOrder) && secondOrder > 0
        if (firstHasOrder && secondHasOrder) return firstOrder - secondOrder
        if (firstHasOrder) return -1
        if (secondHasOrder) return 1
        return 0
      })
    ordered.forEach((element, index) => {
      const objectId = element.getAttribute('data-object-id') ?? `a11y-${index + 1}`
      if (!element.id) element.id = `svg-object-${objectId.replace(/[^\w-]/g, '-')}`
      const label = element.getAttribute('aria-label') || element.getAttribute('data-layer-name') || `${element.tagName.toLowerCase()} ${index + 1}`
      element.setAttribute('role', 'img'); element.setAttribute('aria-label', label)
      element.setAttribute('tabindex', `${index + 1}`); element.setAttribute('data-a11y-order', `${index + 1}`)
      const next = ordered[index + 1]
      if (next) element.setAttribute('aria-flowto', next.id || `svg-object-${(next.getAttribute('data-object-id') ?? '').replace(/[^\w-]/g, '-')}`)
      else element.removeAttribute('aria-flowto')
    })
    recordHistory(stage)
    setWorkflowMessage(`Przygotowano eksport dostępności: tytuł, opis i kolejność fokusu dla ${ordered.length} elementów.`)
  }

  function moveAccessibilityFocus(id: string, direction: -1 | 1) {
    const stage = drawing.current
    if (!stage) return
    const ordered = directObjects(stage.node)
      .filter(element => !['line'].includes(element.tagName.toLowerCase()))
      .sort((first, second) => {
        const firstOrder = Number(first.getAttribute('data-a11y-order'))
        const secondOrder = Number(second.getAttribute('data-a11y-order'))
        const firstHasOrder = Number.isFinite(firstOrder) && firstOrder > 0
        const secondHasOrder = Number.isFinite(secondOrder) && secondOrder > 0
        if (firstHasOrder && secondHasOrder) return firstOrder - secondOrder
        if (firstHasOrder) return -1
        if (secondHasOrder) return 1
        return 0
      })
    const currentIndex = ordered.findIndex(element => element.getAttribute('data-object-id') === id)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    ;[ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex], ordered[currentIndex]]
    ordered.forEach((element, index) => element.setAttribute('data-a11y-order', `${index + 1}`))
    recordHistory(stage)
  }

  function optimizeSvgDocument(svg: SVGSVGElement) {
    const references = new Set<string>()
    svg.querySelectorAll('*').forEach(element => Array.from(element.attributes).forEach(attribute => {
      for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g)) references.add(match[1])
      if (['href', 'xlink:href'].includes(attribute.name.toLowerCase()) && attribute.value.startsWith('#')) references.add(attribute.value.slice(1))
    }))
    svg.querySelectorAll('defs [id]').forEach(element => { if (!references.has(element.id)) element.remove() })
    svg.querySelectorAll('path[d]').forEach(element => element.setAttribute('d', element.getAttribute('d')!.replace(/(-?\d*\.\d{3,})/g, value => `${Number(Number(value).toFixed(2))}`)))
    svg.querySelectorAll('g').forEach(group => { if (!group.children.length && !group.textContent?.trim()) group.remove() })
    svg.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
  }

  function optimizeCurrentSvg() {
    const stage = drawing.current
    if (!stage) return
    optimizeSvgDocument(stage.node)
    recordHistory(stage)
    setOptimizationReport(`Usunięto nieużywane definicje i zaokrąglono współrzędne ścieżek. Pozostało ${stage.node.querySelectorAll('defs > *').length} definicji.`)
  }

  function addGuide(axis: 'x' | 'y') {
    const value = axis === 'x' ? documentSize.width / 2 : documentSize.height / 2
    setViewOptions(current => ({ ...current, guides: [...current.guides, { axis, value }] }))
  }

  function createSymbolFromSelection() {
    const stage = drawing.current
    const originals = stage ? elementsForIds(stage.node, selectedIdsRef.current) : []
    const bounds = unionBoxes(originals.map(getBox))
    if (!stage || !bounds || !originals.length) return
    const defs = stage.node.querySelector('defs') ?? document.createElementNS(SVG_NS, 'defs')
    if (!defs.parentNode) stage.node.prepend(defs)
    const reusableSymbolCount = defs.querySelectorAll('symbol').length
    const symbol = document.createElementNS(SVG_NS, 'symbol')
    const id = `symbol-${crypto.randomUUID()}`
    symbol.setAttribute('id', id)
    symbol.setAttribute('data-layer-name', `Komponent ${reusableSymbolCount + 1}`)
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
    use.setAttribute('data-object-id', objectId); use.setAttribute('data-layer-name', symbol.getAttribute('data-layer-name') || 'Wystąpienie symbolu'); use.setAttribute('pointer-events', 'all')
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

  function updateReusableSymbol(symbolId: string) {
    const stage = drawing.current
    const symbol = stage?.node.querySelector<SVGSymbolElement>(`defs symbol#${CSS.escape(symbolId)}`)
    const originals = selectedElements().filter(element => element.tagName.toLowerCase() !== 'use')
    const bounds = unionBoxes(originals.map(getBox))
    if (!stage || !symbol || !originals.length || !bounds) return
    const copies = originals.map(element => {
      const clone = element.cloneNode(true) as SVGElement
      ;[clone, ...Array.from(clone.querySelectorAll('*'))].forEach(node => { node.removeAttribute('data-object-id'); node.removeAttribute('data-group-id'); node.removeAttribute('data-a11y-order') })
      return clone
    })
    symbol.replaceChildren(...copies)
    symbol.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`)
    symbol.setAttribute('data-component-updated-at', new Date().toISOString())
    recordHistory(stage)
    setWorkflowMessage(`Wspólny komponent „${symbol.getAttribute('data-layer-name') || symbolId}” został zaktualizowany; wszystkie jego wystąpienia korzystają teraz z nowej definicji.`)
  }

  function layoutByRelationships() {
    const stage = drawing.current
    if (!stage) return
    const nodes = directObjects(stage.node).filter(element => !['line', 'text'].includes(element.tagName.toLowerCase()))
    const nodeIds = new Set(nodes.map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id)))
    const edges = directObjects(stage.node).filter(element => element.tagName.toLowerCase() === 'line').flatMap(line => {
      const from = line.getAttribute('data-start-target'); const to = line.getAttribute('data-end-target')
      return from && to && nodeIds.has(from) && nodeIds.has(to) ? [{ from, to }] : []
    })
    if (nodes.length < 2 || !edges.length) { setWorkflowMessage('Połącz co najmniej dwie figury strzałkami, aby automatycznie ułożyć diagram.'); return }
    const ranks = new Map([...nodeIds].map(id => [id, 0]))
    let cyclic = false
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false
      edges.forEach(edge => {
        const nextRank = (ranks.get(edge.from) ?? 0) + 1
        if (nextRank > (ranks.get(edge.to) ?? 0)) { ranks.set(edge.to, nextRank); changed = true }
      })
      if (!changed) break
      if (pass === nodes.length - 1) cyclic = true
    }
    if (cyclic) { setWorkflowMessage('Diagram zawiera cykl zależności. Przerwij jedną z pętli, aby ułożyć go hierarchicznie.'); return }
    const levels = new Map<number, SVGElement[]>()
    nodes.forEach(node => { const rank = ranks.get(node.getAttribute('data-object-id') ?? '') ?? 0; levels.set(rank, [...(levels.get(rank) ?? []), node]) })
    levels.forEach(level => level.sort((a, b) => {
      const first = getBox(a); const second = getBox(b)
      return layoutDirection === 'horizontal' ? (first?.y ?? 0) - (second?.y ?? 0) : (first?.x ?? 0) - (second?.x ?? 0)
    }))
    const levelNumbers = [...levels.keys()].sort((a, b) => a - b)
    const boxByNode = new Map(nodes.map(node => [node, getBox(node)]))
    const margin = Math.max(28, Math.min(layoutSpacing, 96))
    let cursor = margin
    let maximumCrossExtent = margin
    levelNumbers.forEach(rank => {
      const level = levels.get(rank) ?? []
      const mainExtent = Math.max(1, ...level.map(node => layoutDirection === 'horizontal' ? boxByNode.get(node)?.width ?? 1 : boxByNode.get(node)?.height ?? 1))
      let crossCursor = margin
      level.forEach(node => {
        const box = boxByNode.get(node)
        if (!box) return
        const x = layoutDirection === 'horizontal' ? cursor : crossCursor
        const y = layoutDirection === 'horizontal' ? crossCursor : cursor
        moveElementBy(node, x - box.x, y - box.y)
        crossCursor += (layoutDirection === 'horizontal' ? box.height : box.width) + margin
      })
      maximumCrossExtent = Math.max(maximumCrossExtent, crossCursor)
      cursor += mainExtent + margin * 1.4
    })
    const nextWidth = Math.max(documentSize.width, layoutDirection === 'horizontal' ? cursor : maximumCrossExtent) + margin
    const nextHeight = Math.max(documentSize.height, layoutDirection === 'vertical' ? cursor : maximumCrossExtent) + margin
    documentSizeRef.current = { width: nextWidth, height: nextHeight }; documentRatio.current = nextWidth / Math.max(nextHeight, 1)
    setDocumentSize({ width: nextWidth, height: nextHeight })
    stage.node.setAttribute('width', `${nextWidth}`); stage.node.setAttribute('height', `${nextHeight}`)
    changeViewBox({ x: 0, y: 0, width: nextWidth, height: nextHeight })
    updateConnectors(stage.node); recordHistory(stage)
    setWorkflowMessage(`Rozmieszczono ${nodes.length} figur według ${edges.length} połączeń.`)
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

  function exportSvgSource(format: 'svg' | 'png' | 'pdf' = exportFormat, size = exportSize): string | undefined {
    const stage = drawing.current
    if (!stage) return undefined
    const copy = stage.node.cloneNode(true) as SVGSVGElement
    const contentBounds = unionBoxes(directObjects(stage.node).map(getBox))
    const cropToContent = fitToContent || infiniteCanvas || extendsDocument(contentBounds, documentSize)
    copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
    copy.removeAttribute('data-editor-infinite-canvas')
    const removeBackground = cropToContent || ((format === 'png' || format === 'pdf') && exportTransparent)
    if (removeBackground) copy.querySelectorAll('[data-background]').forEach(element => element.remove())
    else copy.querySelectorAll('[data-background]').forEach(element => element.removeAttribute('data-background'))
    copy.setAttribute('width', `${size.width}`); copy.setAttribute('height', `${size.height}`)
    if (cropToContent) {
      if (contentBounds) {
        const margin = 20
        const x = Math.floor(contentBounds.x - margin); const y = Math.floor(contentBounds.y - margin)
        const width = Math.max(1, Math.ceil(contentBounds.width + margin * 2)); const height = Math.max(1, Math.ceil(contentBounds.height + margin * 2))
        copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
      }
      else copy.setAttribute('viewBox', `0 0 ${documentSize.width} ${documentSize.height}`)
    } else copy.setAttribute('viewBox', `0 0 ${documentSize.width} ${documentSize.height}`)
    if (optimizationEnabled) optimizeSvgDocument(copy)
    return sanitizeSvg(new XMLSerializer().serializeToString(copy))
  }

  async function rasterizeSvg(source: string, format: 'png' | 'pdf', size: { width: number; height: number }): Promise<Blob> {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.min(8192, Math.round(size.width)))
      canvas.height = Math.max(1, Math.min(8192, Math.round(size.height)))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Przeglądarka nie udostępniła płótna eksportu.')
      if (!exportTransparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      if (format === 'png') {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('Nie udało się przygotować pliku PNG.')
        return blob
      }
      const { jsPDF } = await import('jspdf')
      const pageWidth = canvas.width * .75; const pageHeight = canvas.height * .75
      const pdf = new jsPDF({ unit: 'pt', format: [pageWidth, pageHeight], orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait', compress: true })
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
      return pdf.output('blob')
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }

  async function downloadExport() {
    try {
      const source = exportSvgSource(exportFormat)
      if (!source) return
      const filename = `${asset?.fileName?.replace(/\.svg$/i, '') || 'schemat'}.${exportFormat}`
      const blob = exportFormat === 'svg'
        ? new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
        : await rasterizeSvg(source, exportFormat, exportSize)
      downloadBlob(blob, filename)
      setWorkflowMessage(`Pobrano plik ${exportFormat.toUpperCase()} (${exportSize.width} × ${exportSize.height} px).`)
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

  function applyConnectorStyle(style: 'straight' | 'orthogonal' | 'rounded') {
    const stage = drawing.current
    const lines = selectedElements().filter(element => element.tagName.toLowerCase() === 'line')
    if (!stage || !lines.length) return
    setConnectorStyle(style)
    const routeEnabled = style !== 'straight'
    autoRouteRef.current = routeEnabled; setAutoRoute(routeEnabled)
    lines.forEach(line => {
      line.setAttribute('data-route-style', style)
      if (style === 'straight') line.removeAttribute('data-auto-route')
      else line.setAttribute('data-auto-route', 'true')
      if (style === 'straight' && !line.hasAttribute('data-connector-label') && !line.hasAttribute('data-start-target') && !line.hasAttribute('data-end-target')) {
        const id = line.getAttribute('data-object-id')
        if (id) stage.node.querySelector(`[data-connector-visual-for="${CSS.escape(id)}"]`)?.remove()
        line.removeAttribute('stroke-opacity')
      }
    })
    updateConnectors(stage.node); recordHistory(stage)
  }

  function applyConnectorPortType(type: 'free' | 'input' | 'output' | 'both') {
    setConnectorPortType(type)
    updateSelected(element => {
      if (['line', 'text'].includes(element.tagName.toLowerCase())) return
      if (type === 'free') element.removeAttribute('data-connector-port')
      else element.setAttribute('data-connector-port', type)
    })
  }

  function saveConnectorLabel() {
    const stage = drawing.current
    const lines = selectedElements().filter(element => element.tagName.toLowerCase() === 'line')
    if (!stage || !lines.length) return
    lines.forEach(line => {
      if (connectorLabel.trim()) line.setAttribute('data-connector-label', connectorLabel.trim())
      else line.removeAttribute('data-connector-label')
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

  function applyTypography(change: { family?: string; weight?: string; align?: string; italic?: boolean; letterSpacing?: string; lineHeight?: string; baselineShift?: string }) {
    const stage = drawing.current
    if (!stage) return
    const texts = elementsForIds(stage.node, selectedIdsRef.current).filter(element => element.tagName.toLowerCase() === 'text')
    texts.forEach(element => {
      if (change.family) element.setAttribute('font-family', change.family)
      if (change.weight) element.setAttribute('font-weight', change.weight)
      if (change.align) element.setAttribute('text-anchor', change.align)
      if (change.italic !== undefined) element.setAttribute('font-style', change.italic ? 'italic' : 'normal')
      if (change.letterSpacing !== undefined) element.setAttribute('letter-spacing', `${change.letterSpacing}px`)
      if (change.lineHeight !== undefined) element.setAttribute('line-height', change.lineHeight)
      if (change.baselineShift !== undefined) element.setAttribute('baseline-shift', `${change.baselineShift}px`)
    })
    if (change.italic !== undefined) { setFontItalic(change.italic); fontItalicRef.current = change.italic }
    recordHistory(stage)
  }

  function applyPenNodeMode(mode: 'smooth' | 'corner' | 'symmetric') {
    const stage = drawing.current
    const path = selectedElements().find(element => element.hasAttribute('data-editor-pen')) as SVGPathElement | undefined
    const points = path ? readPenPoints(path) : []
    const indices = selectedPenNodeIndicesRef.current.length ? selectedPenNodeIndicesRef.current : selectedPenNodeIndex === null ? [] : [selectedPenNodeIndex]
    if (!stage || !path || !indices.length) return
    setPenNodeMode(mode)
    indices.forEach(index => {
      const node = points[index]
      if (!node) return
      node.mode = mode
      if (mode === 'corner') { delete node.incoming; delete node.outgoing; return }
      const previous = points[index - 1]
      const next = points[index + 1]
      const tangentX = previous && next ? (next.x - previous.x) / 6 : next ? (next.x - node.x) / 6 : previous ? (node.x - previous.x) / 6 : 10
      const tangentY = previous && next ? (next.y - previous.y) / 6 : next ? (next.y - node.y) / 6 : previous ? (node.y - previous.y) / 6 : 0
      const dx = node.outgoing ? node.outgoing.x - node.x : tangentX
      const dy = node.outgoing ? node.outgoing.y - node.y : tangentY
      const magnitude = mode === 'symmetric'
        ? Math.max(1, Math.hypot(dx, dy))
        : Math.max(1, Math.hypot(node.incoming ? node.incoming.x - node.x : 0, node.incoming ? node.incoming.y - node.y : 0), Math.hypot(dx, dy))
      const lengthOut = mode === 'symmetric' || !node.outgoing ? magnitude : Math.hypot(dx, dy)
      const lengthIn = mode === 'symmetric' || !node.incoming ? magnitude : Math.hypot(node.incoming.x - node.x, node.incoming.y - node.y)
      const angle = Math.atan2(dy, dx)
      node.outgoing = { x: node.x + Math.cos(angle) * lengthOut, y: node.y + Math.sin(angle) * lengthOut }
      node.incoming = { x: node.x - Math.cos(angle) * lengthIn, y: node.y - Math.sin(angle) * lengthIn }
    })
    const closed = /z\s*$/i.test(path.getAttribute('d') ?? '')
    path.setAttribute('data-pen-points', JSON.stringify(points)); path.setAttribute('d', `${penPath(points)}${closed ? ' Z' : ''}`)
    recordHistory(stage); renderOverlay(stage, selectedIdsRef.current)
  }

  function applyGroupConstraint(value: 'free' | 'aspect') {
    const stage = drawing.current
    if (!stage) return
    setGroupConstraint(value)
    selectedElements().forEach(element => {
      if (value === 'aspect') element.setAttribute('data-layout-constraint', 'aspect')
      else element.removeAttribute('data-layout-constraint')
    })
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
    let stageObjects = directObjects(stage.node)
    let expectedObjectIds = stageObjects.map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
    if (!stageObjects.length) {
      const latestSnapshot = history.current.at(-1)
      if (latestSnapshot) {
        const snapshotDocument = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${latestSnapshot}</svg>`, 'image/svg+xml')
        const recoverableObjects = Array.from(snapshotDocument.documentElement.children).filter(element => {
          const tag = element.tagName.toLowerCase()
          return OBJECT_TAGS.has(tag) && !element.hasAttribute('data-background') && !element.hasAttribute('data-editor-ui') && !element.hasAttribute('data-connector-visual-for')
        })
        const recoverableIds = recoverableObjects.map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
        if (recoverableIds.length) {
          stage.clear()
          stage.svg(latestSnapshot)
          ensureObjectIds(stage.node)
          updateConnectors(stage.node)
          renderOverlay(stage, [])
          recordHistory(stage)
          stageObjects = directObjects(stage.node)
          expectedObjectIds = stageObjects.map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id))
          setLayerRevision(value => value + 1)
          setWorkflowMessage('Przywróciłem rysunek z historii, bo bieżący widok płótna był pusty.')
        }
      }
    }
    const copy = stage.node.cloneNode(true) as SVGSVGElement
    const contentBounds = unionBoxes(stageObjects.map(getBox))
    const cropToContent = fitToContent || infiniteCanvas || extendsDocument(contentBounds, documentSize)
    copy.querySelectorAll('[data-editor-ui]').forEach(element => element.remove())
    copy.removeAttribute('data-editor-infinite-canvas')
    if (cropToContent) copy.querySelectorAll('[data-background]').forEach(element => element.remove())
    else copy.querySelectorAll('[data-background]').forEach(element => element.removeAttribute('data-background'))
    if (cropToContent) {
      if (contentBounds) {
        const margin = 20
        const x = Math.floor(contentBounds.x - margin)
        const y = Math.floor(contentBounds.y - margin)
        const width = Math.max(1, Math.ceil(contentBounds.width + margin * 2))
        const height = Math.max(1, Math.ceil(contentBounds.height + margin * 2))
        copy.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
        copy.setAttribute('width', `${width}`)
        copy.setAttribute('height', `${height}`)
      } else {
        copy.setAttribute('width', documentLength(documentSize.width))
        copy.setAttribute('height', documentLength(documentSize.height))
        copy.setAttribute('viewBox', `0 0 ${documentSize.width} ${documentSize.height}`)
      }
    } else {
      copy.setAttribute('width', documentLength(documentSize.width))
      copy.setAttribute('height', documentLength(documentSize.height))
      copy.setAttribute('viewBox', `0 0 ${documentSize.width} ${documentSize.height}`)
    }
    const serialized = sanitizeSvg(new XMLSerializer().serializeToString(copy))
    if (expectedObjectIds.length) {
      const serializedDocument = new DOMParser().parseFromString(serialized, 'image/svg+xml')
      const serializedIds = new Set(Array.from(serializedDocument.documentElement.children).map(element => element.getAttribute('data-object-id')).filter((id): id is string => Boolean(id)))
      const missingIds = expectedObjectIds.filter(id => !serializedIds.has(id))
      if (missingIds.length) {
        setWorkflowMessage('Nie zapisano rysunku, bo kontrola SVG wykryła brakujące elementy. Poprawiona wersja pozostała na płótnie.')
        return
      }
    }
    onSave(serialized)
  }

  const tools: { id: Tool; label: string; icon: typeof RectangleHorizontal }[] = [
    { id: 'select', label: 'Zaznacz i przesuń', icon: MousePointer2 },
    { id: 'pan', label: 'Przesuń tablicę', icon: Hand },
    { id: 'lasso', label: 'Zaznacz lasso', icon: Lasso },
    { id: 'eraser', label: 'Gumka · usuwa fragmenty pociągnięć lub cały obiekt', icon: Eraser },
    { id: 'shapeBuilder', label: 'Buduj kształt przez wybór obszarów', icon: Combine },
    { id: 'arrow', label: 'Łącznik między figurami', icon: ArrowRight },
    { id: 'freehand', label: 'Pędzel odręczny · pozostaje aktywny; nacisk rysika zmienia szerokość', icon: Pencil },
    { id: 'pen', label: 'Pióro Béziera, kliknij punkty i Enter, aby zakończyć', icon: Pencil },
    { id: 'text', label: 'Tekst na planszy', icon: Type },
  ]
  const layerItems = drawing.current ? [...directObjects(drawing.current.node)].reverse() : []
  const reusableSymbols = drawing.current ? Array.from(drawing.current.node.querySelectorAll<SVGSymbolElement>('defs symbol')) : []
  const selectedImage = drawing.current ? elementsForIds(drawing.current.node, selectedIds).find(element => element.tagName.toLowerCase() === 'image') : undefined
  const selectedPaths = selectedElements().filter(element => element.tagName.toLowerCase() === 'path')
  const documentFonts = drawing.current ? [...new Set(Array.from(drawing.current.node.querySelectorAll<SVGTextElement>('text')).map(text => text.getAttribute('font-family')).filter((family): family is string => Boolean(family?.trim())))] : []
  const unavailableFonts = documentFonts.filter(family => !document.fonts.check(`14px ${family}`))
  const linkedImages = drawing.current ? directObjects(drawing.current.node).filter(element => element.tagName.toLowerCase() === 'image' && !/^data:/i.test(element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '')) : []
  const compareCheckpoint = checkpoints.find(checkpoint => checkpoint.id === compareCheckpointId)
  const checkpointSvgPreview = (content: string) => sanitizeSvg(`<svg xmlns="${SVG_NS}" width="800" height="500" viewBox="0 0 ${documentSize.width} ${documentSize.height}">${content}</svg>`)
  const checkpointDiffSource = compareCheckpoint && drawing.current
    ? checkpointDiffPreview(snapshotContent(drawing.current), compareCheckpoint.content, documentSize.width, documentSize.height)
    : ''
  const accessibilityObjects = drawing.current ? directObjects(drawing.current.node)
    .filter(element => element.tagName.toLowerCase() !== 'line')
    .sort((first, second) => {
      const firstOrder = Number(first.getAttribute('data-a11y-order'))
      const secondOrder = Number(second.getAttribute('data-a11y-order'))
      const firstHasOrder = Number.isFinite(firstOrder) && firstOrder > 0
      const secondHasOrder = Number.isFinite(secondOrder) && secondOrder > 0
      if (firstHasOrder && secondHasOrder) return firstOrder - secondOrder
      if (firstHasOrder) return -1
      if (secondHasOrder) return 1
      return 0
    }) : []
  const documentBox = { x: 0, y: 0, width: documentSize.width, height: documentSize.height }
  const minimapBounds = infiniteCanvas ? unionBoxes([documentBox, ...miniObjects.map(item => item.box)]) ?? documentBox : documentBox
  const minimapPadding = infiniteCanvas ? Math.max(20, Math.max(minimapBounds.width, minimapBounds.height) * .05) : 0
  const minimapViewBox = {
    x: minimapBounds.x - minimapPadding,
    y: minimapBounds.y - minimapPadding,
    width: minimapBounds.width + minimapPadding * 2,
    height: minimapBounds.height + minimapPadding * 2,
  }
  const zoomPercent = Math.round(documentSize.width / Math.max(viewBox.width, 1) * 100)
  const palette = customPalettes.find(item => item.id === activePaletteId)?.colors ?? ['#596fd8', '#e76c75', '#2b9a83', '#f0a84b', '#222c42', '#8a5bc2', '#3e8cc9', '#ffffff', '#111827']
  const paletteCommands = [
    ...tools.map(item => ({ id: `tool:${item.id}`, label: `Narzędzie: ${item.label}` })),
    { id: 'undo', label: 'Cofnij' }, { id: 'redo', label: 'Ponów' }, { id: 'fit', label: 'Dopasuj cały rysunek' },
    { id: 'fitSelection', label: 'Dopasuj zaznaczenie' }, { id: 'accessibility', label: 'Sprawdź dostępność' },
    { id: 'optimize', label: 'Optymalizuj SVG' }, { id: 'save', label: 'Zapisz grafikę' },
  ].filter(command => command.label.toLowerCase().includes(commandQuery.trim().toLowerCase()))

  return (
    <div className="modal-backdrop drawing-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="drawing-modal advanced-drawing-modal" role="dialog" aria-modal="true" aria-labelledby="drawing-title">
        <header className="modal-heading">
          <div><p className="eyebrow">EDYTOR SVG</p><h2 id="drawing-title">{asset ? 'Edytuj schemat' : 'Nowy schemat'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={19} /></button>
        </header>
        <div className="vector-editor-controls">
          <div className="drawing-toolbar-row drawing-toolbar-tools">
            <div className="drawing-selection-actions" role="group" aria-label="Operacje na zaznaczeniu">
              <span className="selection-count">{selectedIds.length ? `${selectedIds.length} zazn.` : 'Brak zaznaczenia'}</span>
              <button className="tool-button" onClick={toggleSelectedLock} disabled={!selectedIds.length} title="Zablokuj lub odblokuj zaznaczenie" aria-label="Zablokuj lub odblokuj zaznaczenie">{selectedElements().length && selectedElements().every(element => element.getAttribute('data-layer-locked') === 'true') ? <Unlock size={16} /> : <Lock size={16} />}</button>
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
            {tool === 'lasso' && <span className="feature-help toolbar-tool-hint">Obrysuj pociągnięcia lub obiekty · Shift dodaje do zaznaczenia; potem możesz je przesuwać, obracać i skalować</span>}
            {tool === 'eraser' && <div className="eraser-controls"><label className="drawing-select-control"><span>Tryb gumki</span><select value={eraserMode} onChange={event => setEraserMode(event.target.value as typeof eraserMode)}><option value="partial">Częściowe wymazywanie</option><option value="whole">Cały pociągnięty obiekt</option></select></label><label className="line-width-control eraser-size-control"><span>Rozmiar gumki</span><input type="range" min="4" max="64" step="1" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} /><output>{eraserSize}px</output></label></div>}
            {tool === 'shapeBuilder' && <div className="drawing-shape-builder-actions" role="group" aria-label="Operacje budowania kształtu">
              <span className="feature-help">Klikaj obszary, Shift dodaje je do wyboru.</span>
              <label className="drawing-select-control"><span>Operacja</span><select value={shapeBuilderOperation} onChange={event => setShapeBuilderOperation(event.target.value as typeof shapeBuilderOperation)}><option value="union">Scal</option><option value="subtract">Odejmij</option><option value="intersect">Część wspólna</option><option value="exclude">Wyklucz</option></select></label>
              <button className="button secondary compact-feature-button" onClick={() => applyBoolean(shapeBuilderOperation)} disabled={selectedIds.length < 2 || (shapeBuilderOperation === 'exclude' && selectedIds.length !== 2)}>Zbuduj kształt</button>
            </div>}
            {tool === 'freehand' && <>
              <div className="freehand-brush-presets">
                <label className="drawing-select-control"><span>Pędzel</span><select value={brushPresetId} onChange={event => {
                  const id = event.target.value
                  setBrushPresetId(id)
                  const preset = [...BUILTIN_BRUSH_PRESETS, ...brushPresets].find(item => item.id === id)
                  if (preset) applyBrushPreset(preset)
                }} aria-label="Wybierz ustawienie pędzla"><option value="current">Bieżące ustawienia</option>{BUILTIN_BRUSH_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}{brushPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
                <input className="brush-preset-name" value={brushPresetName} onChange={event => setBrushPresetName(event.target.value)} maxLength={32} placeholder="Nazwa presetu" aria-label="Nazwa własnego pędzla" />
                <button className="button secondary compact-feature-button" onClick={saveBrushPreset} disabled={!brushPresetName.trim()} title="Zapisz bieżące ustawienia pędzla">Zapisz pędzel</button>
                {!BUILTIN_BRUSH_PRESETS.some(preset => preset.id === brushPresetId) && brushPresetId !== 'current' && <button className="tool-button delete-tool" onClick={removeBrushPreset} title="Usuń własny preset pędzla" aria-label="Usuń własny preset pędzla"><Trash2 size={14} /></button>}
              </div>
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
        <nav className="drawing-feature-tabs" role="tablist" aria-label="Panele edytora SVG">
          {([
            ['canvas', 'Płótno', Grid3X3], ['style', 'Styl', Palette], ['layers', 'Warstwy i układ', Layers], ['workflow', 'Import, historia i eksport', History],
          ] as const).map(([id, label, Icon]) => <button key={id} id={`drawing-tab-${id}`} className={activePanel === id ? 'selected' : ''} onClick={() => setActivePanel(current => current === id ? null : id)} aria-controls="drawing-feature-panel" aria-selected={activePanel === id} role="tab" title={activePanel === id ? `Ukryj panel: ${label}` : `Pokaż panel: ${label}`}><Icon size={15} />{label}</button>)}
        </nav>
        <div id="drawing-feature-panel" className={`drawing-feature-panel ${activePanel ? '' : 'collapsed'}`} role="tabpanel" aria-labelledby={activePanel ? `drawing-tab-${activePanel}` : undefined} aria-hidden={!activePanel} data-revision={layerRevision}>
          {activePanel === 'canvas' && <div className="drawing-feature-groups">
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Widok i nawigacja</summary><div className="drawing-feature-group-controls">
              <button className="button secondary compact-feature-button" onClick={() => zoomAtCenter(1.2)} title="Powiększ"><Plus size={13} /></button>
              <output className="feature-help" aria-label="Powiększenie">{zoomPercent}%</output>
              <button className="button secondary compact-feature-button" onClick={() => zoomAtCenter(1 / 1.2)} title="Pomniejsz"><Minus size={13} /></button>
              <button className="button secondary compact-feature-button" onClick={() => fitViewToContent(false)}>Dopasuj wszystko</button>
              <button className="button secondary compact-feature-button" onClick={() => fitViewToContent(true)} disabled={!selectedIds.length}>Dopasuj zaznaczenie</button>
              <span className="feature-help">Przeciągnij z narzędziem „Przesuń tablicę” lub przytrzymując Spację. Ctrl/Cmd + kółko zmienia powiększenie.</span>
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Wymiary dokumentu</summary><div className="drawing-feature-group-controls">
              <label className="fill-toggle infinite-canvas-toggle"><input type="checkbox" checked={infiniteCanvas} onChange={event => setInfiniteCanvas(event.target.checked)} />Nieograniczona tablica</label>
              <span className="feature-help">Ukrywa krawędzie arkusza. W trybie tablicy można przesuwać rysunek dowolnie daleko; eksport obejmuje całą zawartość.</span>
              <label className="geometry-control"><span>Szerokość</span><input type="number" min="1" value={displayedDimension(documentSize.width)} onChange={event => changeDocumentDimension('width', Number(event.target.value) || 1)} /></label>
              <label className="geometry-control"><span>Wysokość</span><input type="number" min="1" value={displayedDimension(documentSize.height)} onChange={event => changeDocumentDimension('height', Number(event.target.value) || 1)} /></label>
              <label className="drawing-select-control"><span>Jednostka</span><select value={documentUnit} onChange={event => setDocumentUnit(event.target.value as DocumentUnit)}><option value="px">px</option><option value="mm">mm</option><option value="in">in</option></select></label>
              <label className="fill-toggle"><input type="checkbox" checked={lockDocumentRatio} onChange={event => { setLockDocumentRatio(event.target.checked); documentRatio.current = documentSize.width / Math.max(documentSize.height, 1) }} />Zachowaj proporcje</label>
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Siatka i pomocnicze widoki</summary><div className="drawing-feature-group-controls">
              <label className="fill-toggle"><input type="checkbox" checked={viewOptions.grid} onChange={event => setViewOptions(current => ({ ...current, grid: event.target.checked }))} />Siatka</label>
              <label className="drawing-select-control"><span>Odstęp</span><select value={viewOptions.gridSize} onChange={event => setViewOptions(current => ({ ...current, gridSize: Number(event.target.value) }))}>{[8, 10, 16, 20, 25, 32, 40, 50].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
              <label className="fill-toggle"><input type="checkbox" checked={viewOptions.snap} onChange={event => setViewOptions(current => ({ ...current, snap: event.target.checked }))} />Przyciągaj</label>
              <label className="fill-toggle"><input type="checkbox" checked={viewOptions.smartGuides} onChange={event => setViewOptions(current => ({ ...current, smartGuides: event.target.checked }))} />Inteligentne prowadnice</label>
              <label className="fill-toggle"><input type="checkbox" checked={viewOptions.snapGeometry} onChange={event => setViewOptions(current => ({ ...current, snapGeometry: event.target.checked }))} />Przyciągaj do punktów i przecięć</label>
              <label className="fill-toggle"><input type="checkbox" checked={viewOptions.rulers} onChange={event => setViewOptions(current => ({ ...current, rulers: event.target.checked }))} /><Ruler size={14} />Linijki</label>
              <label className="fill-toggle"><input type="checkbox" checked={showMinimap} onChange={event => setShowMinimap(event.target.checked)} />Mini mapa</label>
              <span className="feature-help">Siatka i prowadnice są pomocnicze; nie trafiają do zapisanego SVG.</span>
            </div></details>
            <details className="drawing-feature-group drawing-feature-group-wide drawing-feature-dropdown"><summary>Prowadnice · {viewOptions.guides.length}</summary><div className="drawing-feature-group-controls">
              <label className="fill-toggle"><input type="checkbox" checked={guideLockAll} onChange={event => { setGuideLockAll(event.target.checked); setViewOptions(current => ({ ...current, guides: current.guides.map(guide => ({ ...guide, locked: event.target.checked })) })) }} />Zablokuj prowadnice</label>
              <button className="button secondary compact-feature-button" onClick={() => addGuide('x')}><Plus size={13} />Pionowa prowadnica</button>
              <button className="button secondary compact-feature-button" onClick={() => addGuide('y')}><Plus size={13} />Pozioma prowadnica</button>
              <button className="button secondary compact-feature-button" onClick={() => setViewOptions(current => ({ ...current, guides: [] }))} disabled={!viewOptions.guides.length}>Usuń prowadnice ({viewOptions.guides.length})</button>
              {viewOptions.guides.map((guide, index) => <div className="geometry-control guide-position-control" key={`${guide.axis}-${index}`}><span>{guide.axis === 'x' ? 'Pionowa X' : 'Pozioma Y'}</span><input type="number" min={infiniteCanvas ? undefined : 0} max={infiniteCanvas ? undefined : guide.axis === 'x' ? documentSize.width : documentSize.height} value={guide.value} disabled={guide.locked || guideLockAll} onChange={event => setViewOptions(current => ({ ...current, guides: current.guides.map((item, currentIndex) => currentIndex === index ? { ...item, value: Number(event.target.value) } : item) }))} /><label className="fill-toggle" title="Zablokuj prowadnicę"><input type="checkbox" checked={Boolean(guide.locked)} onChange={event => setViewOptions(current => ({ ...current, guides: current.guides.map((item, currentIndex) => currentIndex === index ? { ...item, locked: event.target.checked } : item) }))} /><Lock size={12} /></label><button className="tool-button" onClick={() => setViewOptions(current => ({ ...current, guides: current.guides.filter((_item, currentIndex) => currentIndex !== index) }))} aria-label="Usuń prowadnicę"><X size={12} /></button></div>)}
            </div></details>
            <details className="drawing-feature-group drawing-feature-group-wide drawing-feature-dropdown"><summary>Pióro i rysik · wygładzanie i nacisk</summary><div className="drawing-feature-group-controls drawing-stylus-controls">
              <label className="line-width-control"><span>Wygładzanie</span><input type="range" min="0" max="1.5" step="0.05" value={stylusProfile.smoothing} onChange={event => { setBrushPresetId('current'); setStylusProfile(current => ({ ...current, smoothing: Number(event.target.value) })) }} /><output>{stylusProfile.smoothing.toFixed(2)}</output></label>
              <label className="line-width-control"><span>Czułość nacisku</span><input type="range" min="0" max="2" step="0.1" value={stylusProfile.pressureSensitivity} onChange={event => { setBrushPresetId('current'); setStylusProfile(current => ({ ...current, pressureSensitivity: Number(event.target.value) })) }} /><output>{stylusProfile.pressureSensitivity.toFixed(1)}×</output></label>
              <label className="line-width-control"><span>Wpływ pochylenia</span><input type="range" min="0" max="2" step="0.1" value={stylusProfile.tiltSensitivity} onChange={event => { setBrushPresetId('current'); setStylusProfile(current => ({ ...current, tiltSensitivity: Number(event.target.value) })) }} /><output>{stylusProfile.tiltSensitivity.toFixed(1)}×</output></label>
              <label className="fill-toggle"><input type="checkbox" checked={stylusProfile.palmRejection} onChange={event => setStylusProfile(current => ({ ...current, palmRejection: event.target.checked }))} />Odrzucaj dotyk dłoni przy rysowaniu</label>
              <div className="stylus-stroke-preview" aria-label="Podgląd wygładzania kreski"><span>Podgląd kreski</span><svg viewBox="0 0 150 34" role="img" aria-label="Podgląd aktualnego wygładzania"><path d={smoothStroke([{ x: 4, y: 25 }, { x: 23, y: 6 }, { x: 42, y: 27 }, { x: 64, y: 11 }, { x: 83, y: 22 }, { x: 108, y: 5 }, { x: 145, y: 20 }], stylusProfile.smoothing)} /></svg></div>
              <button className="button secondary compact-feature-button" onClick={() => setStylusProfile(DEFAULT_STYLUS_PROFILE)}>Przywróć profil domyślny</button>
              <span className="feature-help">Profil zapisuje się lokalnie. Nacisk zmienia szerokość, pochylenie nadaje kresce kształt markera, a dotyk jest ignorowany podczas rysowania rysikiem.</span>
            </div></details>
          </div>}

          {activePanel === 'style' && <div className="drawing-feature-groups">
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Kolor i przezroczystość</summary><div className="drawing-feature-group-controls">
              <div className="drawing-feature-row drawing-palette-manager">
                <label className="drawing-select-control"><span>Zestaw kolorów</span><select value={activePaletteId || 'default'} onChange={event => {
                  const id = event.target.value === 'default' ? '' : event.target.value
                  setActivePaletteId(id)
                  const preset = customPalettes.find(item => item.id === id)
                  if (preset) { setPaletteNameDraft(preset.name); setPaletteDraftColors(preset.colors.slice(0, 6)) }
                  else { setPaletteNameDraft(''); setPaletteDraftColors(['#596fd8', '#e76c75', '#2b9a83', '#f0a84b', '#8a5bc2', '#3e8cc9']) }
                }}><option value="default">Domyślna</option>{customPalettes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                {activePaletteId && <button className="button secondary compact-feature-button" onClick={() => removeCustomPalette(activePaletteId)}>Usuń zestaw</button>}
              </div>
              <div className="drawing-palette" aria-label="Paleta kolorów">{palette.map(color => <button key={color} className="palette-swatch" style={{ backgroundColor: color }} onClick={() => { applyStrokeColor(color); applyFillColor(color) }} title={`Ustaw kolor ${color}`} aria-label={`Ustaw kolor ${color}`} />)}</div>
              <details className="drawing-feature-details"><summary>Zarządzaj paletami · {customPalettes.length}</summary><div className="drawing-advanced-controls">
                <div className="drawing-feature-row drawing-palette-draft">{paletteDraftColors.map((color, index) => <label className="color-control" key={index} title={`Kolor ${index + 1}`}><input type="color" value={color} onChange={event => setPaletteDraftColors(current => current.map((item, colorIndex) => colorIndex === index ? event.target.value : item))} aria-label={`Kolor ${index + 1} nowej palety`} /></label>)}</div>
                <div className="drawing-feature-row"><input className="drawing-inline-input" value={paletteNameDraft} onChange={event => setPaletteNameDraft(event.target.value)} placeholder="Nazwa palety" aria-label="Nazwa palety kolorów" /><button className="button secondary compact-feature-button" onClick={saveCustomPalette} disabled={!paletteNameDraft.trim()}>Zapisz paletę</button></div>
                {customPalettes.map(item => <div className="drawing-custom-palette-row" key={item.id}><button className="button secondary compact-feature-button" onClick={() => { setActivePaletteId(item.id); setPaletteNameDraft(item.name); setPaletteDraftColors(item.colors.slice(0, 6)) }}>{item.name}</button><div className="drawing-palette" aria-label={`Kolory palety ${item.name}`}>{item.colors.slice(0, 6).map((color, index) => <span key={`${color}-${index}`} className="palette-swatch" style={{ backgroundColor: color }} />)}</div><button className="tool-button" onClick={() => removeCustomPalette(item.id)} aria-label={`Usuń paletę ${item.name}`}><X size={12} /></button></div>)}
              </div></details>
              <button className={`button secondary compact-feature-button ${eyedropper ? 'feature-active' : ''}`} onClick={() => setEyedropper(value => !value)} title="Kliknij figurę, aby pobrać jej kolor"><Pipette size={14} />Pipeta</button>
              <label className="line-width-control"><span>Przezroczystość</span><input type="range" min="0" max="100" step="1" value={opacity} onChange={event => applyObjectOpacity(Number(event.target.value))} /><output>{opacity}%</output></label>
              <details className="drawing-feature-details"><summary>Kolory nazwane</summary><div className="drawing-advanced-controls">
                <div className="drawing-feature-row"><input className="drawing-inline-input" value={colorNameDraft} onChange={event => setColorNameDraft(event.target.value)} placeholder="Nazwa koloru" aria-label="Nazwa koloru dokumentu" /><button className="button secondary compact-feature-button" onClick={addNamedColor} disabled={!colorNameDraft.trim()}>Zapisz kolor wypełnienia</button></div>
                <label className="color-control"><input type="color" value={replaceColorSource} onChange={event => setReplaceColorSource(event.target.value)} /><span>Kolor do zamiany</span></label>
                {namedColors.map(item => <div className="drawing-named-color" key={item.name}><button className="palette-swatch" style={{ backgroundColor: item.color }} onClick={() => { setFillColor(item.color); fillColorRef.current = item.color; applyFillColor(item.color) }} title={`Użyj ${item.name}`} /><span>{item.name}</span><button className="button secondary compact-feature-button" onClick={() => replaceDocumentColor(replaceColorSource, item.color)}>Zamień globalnie</button><button className="tool-button" onClick={() => setNamedColors(current => current.filter(color => color.name !== item.name))} aria-label={`Usuń kolor ${item.name}`}><X size={12} /></button></div>)}
              </div></details>
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Gradienty i wzory</summary><div className="drawing-feature-group-controls">
              <button className="button secondary compact-feature-button" onClick={applyGradient} disabled={!selectedIds.length} title="Utwórz gradient trójstopniowy">Gradient</button>
              <label className="drawing-select-control"><span>Typ gradientu</span><select value={gradientKind} onChange={event => setGradientKind(event.target.value as 'linear' | 'radial')}><option value="linear">Liniowy</option><option value="radial">Promieniowy</option></select></label>
              {gradientKind === 'linear' && <label className="geometry-control"><span>Kąt °</span><input type="number" min="0" max="360" value={gradientAngle} onChange={event => setGradientAngle(Number(event.target.value))} /></label>}
              <label className="color-control" title="Kolor środkowego punktu gradientu"><input type="color" value={gradientMiddle} onChange={event => setGradientMiddle(event.target.value)} aria-label="Kolor środkowego punktu gradientu" /><span>Środek</span></label>
              <label className="drawing-select-control"><span>Wzorek</span><select value={patternKind} onChange={event => setPatternKind(event.target.value as 'dots' | 'lines' | 'diagonal')}><option value="dots">Kropki</option><option value="lines">Linie</option><option value="diagonal">Ukośny</option></select></label>
              <button className="button secondary compact-feature-button" onClick={applyPattern} disabled={!selectedIds.length}>Wypełnij wzorkiem</button>
              <details className="drawing-feature-details"><summary>Edytor kafelka wzoru</summary><div className="drawing-advanced-controls">
                <label className="geometry-control"><span>Rozmiar kafelka</span><input type="number" min="4" max="120" value={patternTileSize} onChange={event => setPatternTileSize(Math.max(4, Number(event.target.value) || 4))} /></label>
                <label className="geometry-control"><span>Grubość elementu</span><input type="number" min="0.5" max="20" step="0.5" value={patternStrokeWidth} onChange={event => setPatternStrokeWidth(Math.max(.5, Number(event.target.value) || .5))} /></label>
                <label className="color-control"><input type="color" value={patternBackground || '#ffffff'} onChange={event => setPatternBackground(event.target.value)} /><span>Tło kafelka</span></label>
                <button className="button secondary compact-feature-button" onClick={() => setPatternBackground('')}>Bez tła</button>
                <span className="drawing-pattern-preview" aria-label="Podgląd kafelka"><svg viewBox={`0 0 ${patternTileSize} ${patternTileSize}`}><rect width={patternTileSize} height={patternTileSize} fill={patternBackground || '#fff'} />{patternKind === 'dots' ? <circle cx={patternTileSize / 2} cy={patternTileSize / 2} r={patternStrokeWidth} fill={strokeColor} /> : <path d={patternKind === 'lines' ? `M 0 ${patternTileSize / 2} H ${patternTileSize}` : `M 0 ${patternTileSize} L ${patternTileSize} 0`} fill="none" stroke={strokeColor} strokeWidth={patternStrokeWidth} />}</svg></span>
              </div></details>
              <details className="drawing-feature-details"><summary>Gradient na planszy</summary><span className="feature-help">Zaznacz obiekt z gradientem liniowym i przeciągnij uchwyty początku, końca lub środkowego koloru bezpośrednio na płótnie.</span></details>
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Zapisane style · {stylePresets.length}</summary><div className="drawing-feature-group-controls">
              <button className="button secondary compact-feature-button" onClick={copyStyle} disabled={!selectedIds.length}>Kopiuj styl</button>
              <button className="button secondary compact-feature-button" onClick={pasteStyle} disabled={!selectedIds.length || !selectedStyle}>Wklej styl</button>
              <button className="button secondary compact-feature-button" onClick={saveStylePreset} disabled={!selectedIds.length}>Zapisz preset stylu</button>
              {stylePresets.map(preset => <button key={preset.name} className="button secondary compact-feature-button" onClick={() => applyStylePreset(preset)} disabled={!selectedIds.length} title={`Zastosuj zapisany styl ${preset.name}`}>{preset.name}</button>)}
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Typografia</summary><div className="drawing-feature-group-controls">
              <label className="drawing-select-control"><span>Krój pisma</span><select value={fontFamily} onChange={event => { setFontFamily(event.target.value); applyTypography({ family: event.target.value }) }}><option value="Inter, sans-serif">Inter</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="monospace">Monospace</option><option value="serif">Szeryfowy</option></select></label>
              <label className="drawing-select-control"><span>Grubość</span><select value={fontWeight} onChange={event => { setFontWeight(event.target.value); applyTypography({ weight: event.target.value }) }}><option value="400">Zwykła</option><option value="600">Półgruba</option><option value="700">Pogrubiona</option></select></label>
              <label className="drawing-select-control"><span>Wyrównanie</span><select value={textAlign} onChange={event => { setTextAlign(event.target.value); applyTypography({ align: event.target.value }) }}><option value="start">Do lewej</option><option value="middle">Do środka</option><option value="end">Do prawej</option></select></label>
              <label className="fill-toggle"><input type="checkbox" checked={fontItalic} onChange={event => applyTypography({ italic: event.target.checked })} disabled={!selectedIds.length} />Kursywa</label>
              <button className="button secondary compact-feature-button" onClick={applyTextToPath} disabled={!selectedPaths.length || !selectedElements().some(element => element.tagName.toLowerCase() === 'text')}>Umieść tekst na ścieżce</button>
              <span className="feature-help">Ustawienia działają na zaznaczonych elementach tekstowych.</span>
              <details className="drawing-feature-details"><summary>Tekst zaawansowany</summary><div className="drawing-advanced-controls">
                <label className="geometry-control"><span>Odstęp liter</span><input type="number" min="-10" max="50" step="0.1" value={letterSpacing} onChange={event => { setLetterSpacing(event.target.value); applyTypography({ letterSpacing: event.target.value }) }} disabled={!selectedIds.some(id => selectedElements().some(element => element.getAttribute('data-object-id') === id && element.tagName.toLowerCase() === 'text'))} /></label>
                <label className="geometry-control"><span>Interlinia</span><input type="number" min="0.5" max="4" step="0.1" value={lineHeight} onChange={event => { setLineHeight(event.target.value); applyTypography({ lineHeight: event.target.value }) }} /></label>
                <label className="geometry-control"><span>Przesunięcie linii bazowej</span><input type="number" min="-100" max="100" step="1" value={baselineShift} onChange={event => { setBaselineShift(event.target.value); applyTypography({ baselineShift: event.target.value }) }} /></label>
                <button className="button secondary compact-feature-button" onClick={flowTextIntoShape} disabled={!selectedElements().some(element => element.tagName.toLowerCase() === 'text') || !selectedElements().some(element => !['text', 'line'].includes(element.tagName.toLowerCase()))}>Ułóż tekst wewnątrz kształtu</button>
                <label className="line-width-control"><span>Początek na ścieżce</span><input type="range" min="0" max="100" value={textPathOffset} onChange={event => { const value = Number(event.target.value); setTextPathOffset(value); applyTextPathOptions(value) }} /><output>{textPathOffset}%</output></label>
                <label className="drawing-select-control"><span>Zakotwiczenie</span><select value={textPathAnchor} onChange={event => { const value = event.target.value as typeof textPathAnchor; setTextPathAnchor(value); applyTextPathOptions(textPathOffset, value) }}><option value="start">Początek</option><option value="middle">Środek</option><option value="end">Koniec</option></select></label>
                <label className="drawing-select-control"><span>Strona ścieżki</span><select value={textPathSide} onChange={event => { const value = event.target.value as typeof textPathSide; setTextPathSide(value); applyTextPathOptions(textPathOffset, textPathAnchor, value) }}><option value="left">Lewa</option><option value="right">Prawa</option></select></label>
                <label className="geometry-control"><span>Odsunięcie tekstu</span><input type="number" min="-120" max="120" step="1" value={textPathDistance} onChange={event => { const value = Number(event.target.value); setTextPathDistance(value); applyTextPathOptions(textPathOffset, textPathAnchor, textPathSide, value) }} /></label>
              </div></details>
              <details className="drawing-feature-details"><summary>Czcionki dokumentu</summary><div className="drawing-advanced-controls">
                {!documentFonts.length && <span className="feature-help">W dokumencie nie ma tekstu z własnym krojem pisma.</span>}
                {documentFonts.map(family => <div className="drawing-font-row" key={family}><span>{family}</span><small className={unavailableFonts.includes(family) ? 'drawing-font-missing' : ''}>{unavailableFonts.includes(family) ? 'Brak lokalnej czcionki' : 'Dostępna'}</small></div>)}
                <div className="drawing-feature-row"><label className="drawing-select-control"><span>Zamień</span><select value={fontSwapSource} onChange={event => setFontSwapSource(event.target.value)}><option value="">Wybierz krój</option>{documentFonts.map(family => <option key={family} value={family}>{family}</option>)}</select></label><label className="drawing-select-control"><span>Na</span><select value={fontSwapTarget} onChange={event => setFontSwapTarget(event.target.value)}><option value="Inter, sans-serif">Inter</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="monospace">Monospace</option><option value="serif">Szeryfowy</option></select></label><button className="button secondary compact-feature-button" onClick={() => replaceDocumentFont(fontSwapSource, fontSwapTarget)} disabled={!fontSwapSource}>Zamień w dokumencie</button></div>
              </div></details>
              {selectedPenNodeIndex !== null && selectedPaths.some(path => path.hasAttribute('data-editor-pen')) && <details className="drawing-feature-details" open><summary>Węzły Béziera · {selectedPenNodeIndices.length || 1}</summary><div className="drawing-advanced-controls">
                <span className="feature-help">Shift + klikaj kolejne węzły, aby zaznaczyć je razem.</span>
                <label className="drawing-select-control"><span>Typ węzła</span><select value={penNodeMode} onChange={event => applyPenNodeMode(event.target.value as 'smooth' | 'corner' | 'symmetric')}><option value="corner">Narożny</option><option value="smooth">Gładki</option><option value="symmetric">Symetryczny</option></select></label>
                <label className="geometry-control"><span>Promień narożnika</span><input type="number" min="1" max="80" value={cornerRadius} onChange={event => setCornerRadius(Math.max(1, Number(event.target.value) || 1))} /></label>
                <button className="button secondary compact-feature-button" onClick={roundSelectedPenNodes}>Zaokrąglij węzły</button>
              </div></details>}
            </div></details>
            <details className="drawing-feature-group drawing-feature-dropdown"><summary>Transformacje i kontur</summary><div className="drawing-feature-group-controls">
              <label className="geometry-control"><span>Obrót °</span><input type="number" min="-360" max="360" step="1" value={rotationDraft} disabled={!selectedIds.length} onChange={event => setRotationDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyRotation() }} /></label>
              <button className="button secondary compact-feature-button" onClick={applyRotation} disabled={!selectedIds.length}><RotateCw size={13} />Obróć</button>
              <label className="geometry-control"><span>Odsunięcie konturu</span><input type="number" min="0" max="60" value={offsetDistance} onChange={event => setOffsetDistance(Math.max(0, Number(event.target.value) || 0))} /></label>
              <button className="button secondary compact-feature-button" onClick={applyStrokeOffset} disabled={!selectedIds.length}>Dodaj odsunięty kontur</button>
              <details className="drawing-feature-details"><summary>Mieszanie i przezroczystość</summary><div className="drawing-advanced-controls">
                <label className="drawing-select-control"><span>Tryb mieszania</span><select value={blendMode} onChange={event => applyBlendMode(event.target.value)}><option value="normal">Zwykły</option><option value="multiply">Mnożenie</option><option value="screen">Ekran</option><option value="overlay">Nakładka</option><option value="darken">Przyciemnij</option><option value="lighten">Rozjaśnij</option><option value="color-dodge">Rozjaśnianie kolorów</option><option value="color-burn">Wypalanie kolorów</option><option value="difference">Różnica</option></select></label>
              </div></details>
            </div></details>
            {(selectedImage || (selectedPenNodeIndex !== null && selectedPaths.some(path => path.hasAttribute('data-editor-pen')))) && <details className="drawing-feature-group drawing-feature-dropdown"><summary>Obrazy i ścieżki</summary><div className="drawing-feature-group-controls">
              {selectedImage && <>
                <button className="button secondary compact-feature-button" onClick={() => applyImageTransform('x')}>Odbij obraz ↔</button>
                <button className="button secondary compact-feature-button" onClick={() => applyImageTransform('y')}>Odbij obraz ↕</button>
                <input ref={replaceImageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { void replaceSelectedImage(event.target.files?.[0]); event.currentTarget.value = '' }} />
                <button className="button secondary compact-feature-button" onClick={() => replaceImageInput.current?.click()}>Zastąp obraz</button>
              </>}
              {selectedPenNodeIndex !== null && selectedPaths.some(path => path.hasAttribute('data-editor-pen')) && <label className="drawing-select-control"><span>Węzeł Béziera</span><select value={penNodeMode} onChange={event => applyPenNodeMode(event.target.value as 'smooth' | 'corner' | 'symmetric')}><option value="corner">Narożny</option><option value="smooth">Gładki</option><option value="symmetric">Symetryczny</option></select></label>}
            </div></details>}
          </div>}

          {activePanel === 'layers' && <div className="drawing-layer-workspace">
            <div className="drawing-feature-groups">
              <details className="drawing-feature-group drawing-feature-dropdown"><summary>Wyrównywanie i rozkład</summary><div className="drawing-feature-group-controls">
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'start')} disabled={selectedIds.length < 2}><AlignStartHorizontal size={14} />Wyrównaj do lewej</button>
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'center')} disabled={selectedIds.length < 2}><AlignCenterHorizontal size={14} />Wyśrodkuj w poziomie</button>
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('x', 'end')} disabled={selectedIds.length < 2}><AlignEndHorizontal size={14} />Wyrównaj do prawej</button>
                <button className="button secondary compact-feature-button" onClick={() => distributeSelection('x')} disabled={selectedIds.length < 3} title="Rozłóż obiekty z równymi odstępami"><ArrowDownWideNarrow size={14} />Równe odstępy poziomo</button>
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'start')} disabled={selectedIds.length < 2}>Wyrównaj do góry</button>
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'center')} disabled={selectedIds.length < 2}>Wyśrodkuj w pionie</button>
                <button className="button secondary compact-feature-button" onClick={() => alignSelection('y', 'end')} disabled={selectedIds.length < 2}>Wyrównaj do dołu</button>
                <button className="button secondary compact-feature-button" onClick={() => distributeSelection('y')} disabled={selectedIds.length < 3} title="Rozłóż obiekty z równymi odstępami">Równe odstępy pionowo</button>
                <details className="drawing-feature-details"><summary>Wyrównaj względem pierwszego</summary><div className="drawing-feature-group-controls">
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('left')} disabled={selectedIds.length < 2}>Lewa krawędź</button>
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('centerX')} disabled={selectedIds.length < 2}>Środek poziomo</button>
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('right')} disabled={selectedIds.length < 2}>Prawa krawędź</button>
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('top')} disabled={selectedIds.length < 2}>Górna krawędź</button>
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('centerY')} disabled={selectedIds.length < 2}>Środek pionowo</button>
                  <button className="button secondary compact-feature-button" onClick={() => alignSelectionToKey('bottom')} disabled={selectedIds.length < 2}>Dolna krawędź</button>
                </div></details>
              </div></details>
              <details className="drawing-feature-group drawing-feature-dropdown"><summary>Automatyczny układ diagramu</summary><div className="drawing-feature-group-controls">
                <label className="drawing-select-control"><span>Kierunek relacji</span><select value={layoutDirection} onChange={event => setLayoutDirection(event.target.value as 'horizontal' | 'vertical')}><option value="horizontal">Od lewej do prawej</option><option value="vertical">Od góry do dołu</option></select></label>
                <label className="geometry-control"><span>Odstęp</span><input type="number" min="28" max="96" step="4" value={layoutSpacing} onChange={event => setLayoutSpacing(Math.max(28, Math.min(96, Number(event.target.value) || 28)))} /></label>
                <button className="button secondary compact-feature-button" onClick={layoutByRelationships}>Rozmieść według połączeń</button>
                <span className="feature-help">Używa strzałek połączonych z figurami jako relacji. Cykl w połączeniach blokuje układ hierarchiczny.</span>
              </div></details>
              <details className="drawing-feature-group drawing-feature-dropdown"><summary>Grupy i kształty</summary><div className="drawing-feature-group-controls">
                <button className="button secondary compact-feature-button" onClick={groupSelected} disabled={selectedIds.length < 2} title="Grupuje figury i zachowuje je do osobnej edycji">Połącz w grupę</button>
                <button className="button secondary compact-feature-button" onClick={() => applyBoolean('union')} disabled={selectedIds.length < 2} title="Tworzy jedną wypełnioną sylwetkę z sumy figur">Suma kształtów</button>
                <button className="button secondary compact-feature-button" onClick={() => applyBoolean('subtract')} disabled={selectedIds.length < 2}>Odejmij ostatnią</button>
                <button className="button secondary compact-feature-button" onClick={() => applyBoolean('intersect')} disabled={selectedIds.length < 2}>Część wspólna</button>
                <button className="button secondary compact-feature-button" onClick={() => applyBoolean('exclude')} disabled={selectedIds.length !== 2}>Wyklucz wspólną część</button>
              </div></details>
              <details className="drawing-feature-group drawing-feature-dropdown"><summary>Ścieżki i przycinanie</summary><div className="drawing-feature-group-controls">
                <button className="button secondary compact-feature-button" onClick={() => applyPathOperation('close')} disabled={!selectedPaths.length}>Zamknij ścieżkę</button>
                <button className="button secondary compact-feature-button" onClick={() => applyPathOperation('simplify')} disabled={!selectedPaths.length}>Uprość ścieżkę</button>
                <button className="button secondary compact-feature-button" onClick={() => applyPathOperation('split')} disabled={selectedPaths.length !== 1}>Podziel na pół</button>
                <button className="button secondary compact-feature-button" onClick={() => applyPathOperation('join')} disabled={selectedPaths.length < 2}>Połącz ścieżki</button>
                <button className="button secondary compact-feature-button" onClick={clipSelectedImage} disabled={!selectedImage || selectedElements().length < 2}>Przytnij obraz kształtem</button>
                <details className="drawing-feature-details"><summary>Więcej operacji ścieżek</summary><div className="drawing-advanced-controls">
                  <button className="button secondary compact-feature-button" onClick={reverseSelectedPaths} disabled={!selectedPaths.length}>Odwróć kierunek</button>
                  <button className="button secondary compact-feature-button" onClick={convertStrokeToPath} disabled={!selectedElements().some(element => element.tagName.toLowerCase() === 'path' ? element.getAttribute('stroke') !== 'none' && !/z\s*$/i.test(element.getAttribute('d') ?? '') : element.tagName.toLowerCase() === 'line' && element.getAttribute('stroke') !== 'none' && !element.hasAttribute('data-start-target') && !element.hasAttribute('data-end-target') && !element.hasAttribute('data-auto-route'))}>Zamień obrys w kształt</button>
                  <label className="drawing-select-control"><span>Reguła wypełnienia</span><select value={fillRule} onChange={event => applyFillRule(event.target.value as 'nonzero' | 'evenodd')}><option value="nonzero">Nonzero</option><option value="evenodd">Even-odd</option></select></label>
                  <button className="button secondary compact-feature-button" onClick={createSelectionMask} disabled={selectedIds.length < 2}>Utwórz maskę z kształtu</button>
                  <span className="feature-help">Zaznacz ścieżkę z obrysem, aby zamienić ją na wypełniony kontur. Maska użyje ostatniego zaznaczonego obiektu.</span>
                </div></details>
              </div></details>
              <details className="drawing-feature-group drawing-feature-dropdown"><summary>Symbole i skalowanie · {reusableSymbols.length}</summary><div className="drawing-feature-group-controls">
                <label className="drawing-select-control"><span>Skalowanie grupy</span><select value={groupConstraint} onChange={event => applyGroupConstraint(event.target.value as 'free' | 'aspect')} disabled={!selectedIds.length}><option value="free">Dowolne</option><option value="aspect">Zachowaj proporcje</option></select></label>
                <button className="button secondary compact-feature-button" onClick={createSymbolFromSelection} disabled={!selectedIds.length}>Zapisz zaznaczenie jako symbol</button>
                {reusableSymbols.map((symbol, index) => {
                  const id = symbol.id ?? ''
                  const label = symbol.getAttribute('data-layer-name') || `Komponent ${index + 1}`
                  return <div className="drawing-symbol-row" key={id}><span>{label}</span><button className="button secondary compact-feature-button" onClick={() => insertSymbol(id)} title="Wstaw ponownie edytowalny symbol"><Plus size={12} />Wstaw</button><button className="button secondary compact-feature-button" onClick={() => updateReusableSymbol(id)} disabled={!selectedIds.length || selectedElements().every(element => element.tagName.toLowerCase() === 'use')} title="Zastąp definicję; każde wystąpienie komponentu zostanie zaktualizowane">Aktualizuj</button></div>
                })}
              </div></details>
            </div>
            <details className="drawing-layer-list-group drawing-feature-dropdown"><summary>Warstwy dokumentu · {layerItems.length}</summary><div className="drawing-layer-list">
              {!layerItems.length && <span className="feature-help">Dodane figury pojawią się tu jako warstwy.</span>}
              {layerItems.map((element, index) => {
                const id = element.getAttribute('data-object-id') ?? ''
                const hidden = element.getAttribute('visibility') === 'hidden'
                const locked = element.getAttribute('data-layer-locked') === 'true'
                const label = element.getAttribute('data-layer-name') ?? `${element.tagName.toLowerCase()} ${layerItems.length - index}`
                return <div key={id} className={`drawing-layer-row ${selectedIds.includes(id) ? 'selected' : ''}`}>
                  <button className="tool-button" onClick={() => { if (!locked) select([id]) }} disabled={locked} title={locked ? 'Odblokuj warstwę, aby ją zaznaczyć' : 'Zaznacz warstwę'}><span className="drawing-layer-color" style={{ background: element.getAttribute('fill') ?? element.getAttribute('stroke') ?? '#8490af' }} /></button>
                  <input aria-label={`Nazwa warstwy ${label}`} defaultValue={label} onBlur={event => changeLayer(id, item => item.setAttribute('data-layer-name', event.target.value.trim() || label))} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                  <button className="tool-button" onClick={() => changeLayer(id, item => item.setAttribute('visibility', hidden ? 'visible' : 'hidden'))} title={hidden ? 'Pokaż warstwę' : 'Ukryj warstwę'}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  <button className="tool-button" onClick={() => { changeLayer(id, item => item.setAttribute('data-layer-locked', locked ? 'false' : 'true')); if (!locked && selectedIdsRef.current.includes(id)) select(selectedIdsRef.current.filter(selectedId => selectedId !== id)) }} title={locked ? 'Odblokuj warstwę' : 'Zablokuj warstwę'}>{locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                  <button className="tool-button" onClick={() => reorderLayer(id, 'front')} title="Przenieś na wierzch">↑</button>
                  <button className="tool-button" onClick={() => reorderLayer(id, 'back')} title="Przenieś na spód">↓</button>
                </div>
              })}
            </div></details>
          </div>}

          {activePanel === 'workflow' && <div className="drawing-workflow-grid">
            <section className="drawing-workflow-card"><h3><Waypoints size={15} />Połączenia i komentarze</h3>
              <div className="drawing-workflow-subgroup"><h4>Połączenia</h4>
                <label className="fill-toggle"><input type="checkbox" checked={autoRoute} onChange={event => applyRouteSetting(event.target.checked)} />Automatycznie omijaj figury dla strzałek</label>
                <label className="drawing-select-control"><span>Prowadzenie</span><select value={connectorStyle} disabled={!selectedElements().some(element => element.tagName.toLowerCase() === 'line')} onChange={event => applyConnectorStyle(event.target.value as 'straight' | 'orthogonal' | 'rounded')}><option value="straight">Proste</option><option value="orthogonal">Łamane</option><option value="rounded">Zaokrąglone</option></select></label>
                <label className="drawing-select-control"><span>Port zaznaczonej figury</span><select value={connectorPortType} disabled={!selectedIds.length || selectedElements().every(element => ['line', 'text'].includes(element.tagName.toLowerCase()))} onChange={event => applyConnectorPortType(event.target.value as 'free' | 'input' | 'output' | 'both')}><option value="free">Dowolny</option><option value="input">Wejście</option><option value="output">Wyjście</option><option value="both">Dwukierunkowy</option></select></label>
                <div className="drawing-feature-row"><input className="drawing-connector-label-input" value={connectorLabel} onChange={event => setConnectorLabel(event.target.value)} placeholder="Etykieta strzałki" aria-label="Etykieta zaznaczonego połączenia" /><button className="button secondary compact-feature-button" onClick={saveConnectorLabel} disabled={!selectedElements().some(element => element.tagName.toLowerCase() === 'line')}>Ustaw etykietę</button></div>
              </div>
              <div className="drawing-workflow-subgroup"><h4>Komentarze</h4>
              <button className="button secondary compact-feature-button" onClick={addComment}><MessageSquare size={14} />Dodaj komentarz do planszy</button>
              <p className="feature-help">Komentarze są zapisywane lokalnie na planszy i nie trafiają do wyeksportowanego SVG.</p>
              <div className="drawing-comment-list">{comments.map(comment => <div key={comment.id}><span>{comment.text}</span><button onClick={() => setComments(current => current.filter(item => item.id !== comment.id))} aria-label="Usuń komentarz"><X size={12} /></button></div>)}</div>
              </div>
            </section>
            <section className="drawing-workflow-card"><h3><ImagePlus size={15} />Import i wektoryzacja</h3>
              <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { void importRaster(event.target.files?.[0]); event.currentTarget.value = '' }} />
              <input ref={linkImageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { void relinkImage(event.target.files?.[0]); event.currentTarget.value = '' }} />
              <button className="button secondary compact-feature-button" onClick={() => imageInput.current?.click()}><ImagePlus size={14} />Importuj obraz rastrowy</button>
              <label className="drawing-select-control"><span>Dokładność wektoryzacji</span><input type="range" min="8" max="80" step="4" value={vectorizeDetail} onChange={event => setVectorizeDetail(Number(event.target.value))} /><output>{vectorizeDetail}</output></label>
              <button className="button secondary compact-feature-button" onClick={() => { void vectorizeSelection() }} disabled={!selectedImage}>Zamień obraz na edytowalne kształty</button>
              <details className="drawing-feature-details"><summary>Obrazy i filtry</summary><div className="drawing-advanced-controls">
                {selectedImage && <>
                  <label className="line-width-control"><span>Jasność</span><input type="range" min="0" max="200" value={imageBrightness} onChange={event => { const value = Number(event.target.value); setImageBrightness(value); applyImageAdjustments({ brightness: value }) }} /><output>{imageBrightness}%</output></label>
                  <label className="line-width-control"><span>Kontrast</span><input type="range" min="0" max="200" value={imageContrast} onChange={event => { const value = Number(event.target.value); setImageContrast(value); applyImageAdjustments({ contrast: value }) }} /><output>{imageContrast}%</output></label>
                  <label className="line-width-control"><span>Nasycenie</span><input type="range" min="0" max="200" value={imageSaturation} onChange={event => { const value = Number(event.target.value); setImageSaturation(value); applyImageAdjustments({ saturation: value }) }} /><output>{imageSaturation}%</output></label>
                  <button className="button secondary compact-feature-button" onClick={resetImageAdjustments}>Resetuj korektę obrazu</button>
                </>}
                <h4>Linki do obrazów</h4>
                {!linkedImages.length && <span className="feature-help">Wszystkie obrazy są osadzone w dokumencie.</span>}
                {linkedImages.map(image => <div className="drawing-linked-image" key={image.getAttribute('data-object-id')}><span>{image.getAttribute('href') ?? image.getAttribute('xlink:href')}</span><button className="button secondary compact-feature-button" onClick={() => { setLinkedImageId(image.getAttribute('data-object-id') ?? ''); linkImageInput.current?.click() }}>Osadź lub podmień</button></div>)}
              </div></details>
              <details className="drawing-feature-details"><summary>Biblioteka zasobów</summary><div className="drawing-advanced-controls">
                <div className="drawing-feature-row"><input className="drawing-inline-input" value={assetNameDraft} onChange={event => setAssetNameDraft(event.target.value)} placeholder="Nazwa zaznaczenia" aria-label="Nazwa zapisywanego zasobu" /><button className="button secondary compact-feature-button" onClick={saveSelectionAsAsset} disabled={!selectedIds.length}>Zapisz zaznaczenie</button></div>
                {!assetLibrary.length && <span className="feature-help">Zapisane symbole można wstawiać w kolejnych dokumentach.</span>}
                {assetLibrary.map(item => <div className="drawing-library-asset" key={item.id}><span><small>{item.kind === 'template' ? 'Szablon' : 'Komponent'}</small>{item.name}</span><button className="button secondary compact-feature-button" onClick={() => insertLibraryAsset(item.id)}>Wstaw</button><button className="tool-button" onClick={() => setAssetLibrary(current => current.filter(assetItem => assetItem.id !== item.id))} aria-label={`Usuń zasób ${item.name}`}><X size={12} /></button></div>)}
              </div></details>
            </section>
            <section className="drawing-workflow-card"><h3><History size={15} />Historia i punkty kontrolne</h3>
              <button className="button secondary compact-feature-button" onClick={createCheckpoint}><Plus size={14} />Zapisz punkt kontrolny</button>
              <div className="drawing-checkpoint-list">{checkpoints.map(checkpoint => <div key={checkpoint.id}><button onClick={() => restoreCheckpoint(checkpoint)} title={checkpoint.label}>{checkpoint.label}</button><button className={compareCheckpointId === checkpoint.id ? 'selected' : ''} onClick={() => setCompareCheckpointId(current => current === checkpoint.id ? '' : checkpoint.id)} title="Porównaj zapis z bieżącym rysunkiem">Porównaj</button><button onClick={() => { setCheckpoints(current => current.filter(item => item.id !== checkpoint.id)); if (compareCheckpointId === checkpoint.id) setCompareCheckpointId('') }} aria-label="Usuń punkt kontrolny"><X size={12} /></button></div>)}</div>
              {compareCheckpoint && <div className="drawing-checkpoint-compare"><figure className="drawing-checkpoint-diff"><figcaption>Różnice · zielony: dodano · pomarańczowy: zmieniono · czerwony: usunięto</figcaption><div dangerouslySetInnerHTML={{ __html: checkpointDiffSource }} /></figure><figure><figcaption>Wersja z {new Date(compareCheckpoint.createdAt).toLocaleDateString('pl-PL')}</figcaption><div dangerouslySetInnerHTML={{ __html: checkpointSvgPreview(compareCheckpoint.content) }} /></figure></div>}
            </section>
            <section className="drawing-workflow-card"><h3><Check size={15} />Dostępność</h3>
              <button className="button secondary compact-feature-button" onClick={inspectAccessibility}>Sprawdź opisy i kontrast</button>
              <button className="button secondary compact-feature-button" onClick={addSelectedNodeTitle} disabled={!selectedIds.length}>Dodaj etykiety zaznaczeniu</button>
              <details className="drawing-feature-details"><summary>Opis eksportu i kolejność fokusu · {accessibilityObjects.length}</summary><div className="drawing-advanced-controls">
                <label className="drawing-select-control"><span>Tytuł SVG</span><input value={documentA11yTitle} onChange={event => setDocumentA11yTitle(event.target.value)} aria-label="Tytuł dostępnego dokumentu SVG" /></label>
                <label className="drawing-select-control"><span>Opis SVG</span><textarea className="drawing-a11y-description" value={documentA11yDescription} onChange={event => setDocumentA11yDescription(event.target.value)} aria-label="Opis dostępnego dokumentu SVG" rows={2} /></label>
                <span className="feature-help">Kolejność wpisów poniżej będzie kolejnością przejścia fokusu w eksporcie.</span>
                <div className="drawing-a11y-order-list">{accessibilityObjects.map((element, index) => {
                  const id = element.getAttribute('data-object-id') ?? ''
                  const name = element.getAttribute('data-layer-name') || `${element.tagName.toLowerCase()} ${index + 1}`
                  return <div className="drawing-a11y-order-row" key={id}><button className="button secondary compact-feature-button" onClick={() => select([id])} title="Zaznacz element na płótnie">{index + 1}. {name}</button><input aria-label={`Opis dostępności: ${name}`} defaultValue={element.getAttribute('aria-label') || name} onBlur={event => { const value = event.currentTarget.value.trim(); changeLayer(id, item => value ? item.setAttribute('aria-label', value) : item.removeAttribute('aria-label')) }} /><button className="tool-button" disabled={index === 0} onClick={() => moveAccessibilityFocus(id, -1)} aria-label={`Przenieś ${name} wyżej`}>↑</button><button className="tool-button" disabled={index === accessibilityObjects.length - 1} onClick={() => moveAccessibilityFocus(id, 1)} aria-label={`Przenieś ${name} niżej`}>↓</button></div>
                })}</div>
                <button className="button secondary compact-feature-button" onClick={applyAccessibilityExport}>Zastosuj opisy i kolejność fokusu do SVG</button>
              </div></details>
              {accessibilityOpen && <div className="drawing-a11y-report" role="status">{accessibilityReport.length ? accessibilityReport.map((issue, index) => <p key={index}>{issue}</p>) : <p>Nie znaleziono brakujących opisów ani niskiego kontrastu tekstu.</p>}</div>}
            </section>
            <section className="drawing-workflow-card"><h3><History size={15} />Skróty i optymalizacja</h3>
              <div className="drawing-workflow-subgroup"><h4>Skróty</h4>
                <label className="geometry-control"><span>Otwórz paletę: Ctrl/Cmd + Shift +</span><input value={shortcutKey} maxLength={1} aria-label="Klawisz skrótu palety poleceń" onChange={event => { const key = event.target.value.slice(-1).toLowerCase() || 'p'; setShortcutKey(key); try { localStorage.setItem('no-tie-svg-command-shortcut', key) } catch { /* The shortcut still applies until the editor closes. */ } }} /></label>
                <button className="button secondary compact-feature-button" onClick={() => setCommandPaletteOpen(true)}>Otwórz paletę poleceń</button>
              </div>
              <div className="drawing-workflow-subgroup"><h4>Optymalizacja SVG</h4>
                <label className="fill-toggle"><input type="checkbox" checked={optimizationEnabled} onChange={event => setOptimizationEnabled(event.target.checked)} />Optymalizuj podczas eksportu SVG</label>
                <button className="button secondary compact-feature-button" onClick={optimizeCurrentSvg}>Optymalizuj bieżący rysunek</button>
                {optimizationReport && <p className="feature-help">{optimizationReport}</p>}
              </div>
            </section>
            <section className="drawing-workflow-card"><h3><Download size={15} />Eksport</h3>
              <div className="drawing-workflow-subgroup"><h4>Format eksportu</h4><div className="drawing-feature-row"><label className="drawing-select-control"><span>Format</span><select value={exportFormat} onChange={event => setExportFormat(event.target.value as 'svg' | 'png' | 'pdf')}><option value="svg">SVG</option><option value="png">PNG</option><option value="pdf">PDF</option></select></label></div></div>
              <div className="drawing-workflow-subgroup"><h4>Rozdzielczość i pobieranie</h4><div className="drawing-feature-row">
                <label className="geometry-control"><span>Szerokość px</span><input type="number" min="1" max="4096" value={exportSize.width} onChange={event => setExportSize(current => ({ ...current, width: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                <label className="geometry-control"><span>Wysokość px</span><input type="number" min="1" max="4096" value={exportSize.height} onChange={event => setExportSize(current => ({ ...current, height: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                {(exportFormat === 'png' || exportFormat === 'pdf') && <label className="fill-toggle"><input type="checkbox" checked={exportTransparent} onChange={event => setExportTransparent(event.target.checked)} />Przezroczyste tło</label>}
                <button className="button secondary compact-feature-button" onClick={() => { void downloadExport() }}><Download size={14} />Pobierz {exportFormat.toUpperCase()}</button>
              </div></div>
              {workflowMessage && <p className="feature-help" role="status">{workflowMessage}</p>}
            </section>
          </div>}
          {workflowMessage && activePanel !== 'workflow' && <p className="drawing-panel-status feature-help" role="status">{workflowMessage}</p>}
        </div>
        {commandPaletteOpen && <div className="drawing-command-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCommandPaletteOpen(false) }}>
          <section className="drawing-command-palette" role="dialog" aria-modal="true" aria-label="Paleta poleceń SVG">
            <input autoFocus value={commandQuery} onChange={event => setCommandQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setCommandPaletteOpen(false); if (event.key === 'Enter' && paletteCommands[0]) { event.preventDefault(); event.currentTarget.parentElement?.querySelector('button')?.click() } }} placeholder="Szukaj narzędzia lub polecenia…" aria-label="Szukaj polecenia" />
            <div>{paletteCommands.map(command => <button key={command.id} onClick={() => {
              if (command.id.startsWith('tool:')) chooseTool(command.id.slice(5) as Tool)
              else if (command.id === 'undo') undo()
              else if (command.id === 'redo') redo()
              else if (command.id === 'fit') fitViewToContent(false)
              else if (command.id === 'fitSelection') fitViewToContent(true)
              else if (command.id === 'accessibility') inspectAccessibility()
              else if (command.id === 'optimize') optimizeCurrentSvg()
              else if (command.id === 'save') save()
              setCommandPaletteOpen(false)
            }}>{command.label}</button>)}</div>
            {!paletteCommands.length && <p>Brak pasujących poleceń.</p>}
          </section>
        </div>}
        <div className="drawing-stage-wrap">
          <div className="drawing-canvas-workspace" style={{ '--drawing-ratio': documentSize.width / documentSize.height } as CSSProperties}>
            <aside className="drawing-tool-sidebar" aria-label="Narzędzia rysunku">
              <div className="drawing-tool-rail" role="group" aria-label="Narzędzia rysowania">
                {tools.map(item => {
                  const Icon = item.icon
                  return <button key={item.id} className={`tool-button ${tool === item.id ? 'selected' : ''}`} onClick={() => chooseTool(item.id)} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}><Icon size={17} /></button>
                })}
                <span className="drawing-rail-divider" />
                <button className={`drawing-shapes-toggle ${shapeLibraryOpen ? 'selected' : ''}`} onClick={() => setShapeLibraryOpen(open => !open)} title="Pokaż lub ukryj kształty" aria-label="Kształty" aria-expanded={shapeLibraryOpen} aria-controls={shapeLibraryOpen ? 'drawing-shape-browser' : undefined}><Shapes size={17} /><span>Kształty</span></button>
              </div>
              {shapeLibraryOpen && <div id="drawing-shape-browser" className="drawing-shape-browser" aria-label="Biblioteka kształtów">
                <div className="drawing-shape-browser-heading"><strong>Kształty</strong><span>{shapeLibrary.length}</span></div>
                {shapeCategories.map(category => {
                  const categoryShapes = shapeLibrary.filter(shape => shape.category === category)
                  return <details key={category} className="drawing-shape-category" open>
                    <summary>{category}<span>{categoryShapes.length}</span></summary>
                    <div className="drawing-shape-list">{categoryShapes.map(shape => <button key={shape.id} className="drawing-shape-item" onClick={() => insertLibraryShape(shape.id)} title={`Dodaj ${shape.label} na środek planszy`} aria-label={`Dodaj kształt: ${shape.label}`}>
                      <svg viewBox="0 0 100 100" aria-hidden="true">{shape.paths.map((path, index) => <path key={`${shape.id}-${index}`} d={path.d} fill={path.fill === 'none' ? 'none' : '#e8edff'} stroke="#596fd8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}</svg>
                      <span>{shape.label}</span>
                    </button>)}</div>
                  </details>
                })}
              </div>}
            </aside>
              <div className="drawing-canvas-area">
              <div ref={mount} className="drawing-stage" data-infinite-canvas={infiniteCanvas ? 'true' : 'false'} />
              {comments.map(comment => <div key={comment.id} className="drawing-comment-pin" style={{ left: `${(comment.x - viewBox.x) / viewBox.width * 100}%`, top: `${(comment.y - viewBox.y) / viewBox.height * 100}%` }}>
                <button onClick={() => setActiveCommentId(activeCommentId === comment.id ? null : comment.id)} title={comment.text} aria-label="Pokaż komentarz"><MessageSquare size={13} /></button>
                {activeCommentId === comment.id && <div className="drawing-comment-popover">{comment.text}<button onClick={() => setComments(current => current.filter(item => item.id !== comment.id))}><X size={12} /></button></div>}
              </div>)}
              {commentDraft && <CommentComposer onSave={saveComment} onCancel={() => setCommentDraft(null)} />}
              {showMinimap && <div className="drawing-minimap" aria-label="Mini mapa planszy"><svg style={{ aspectRatio: `${minimapViewBox.width} / ${minimapViewBox.height}` }} viewBox={`${minimapViewBox.x} ${minimapViewBox.y} ${minimapViewBox.width} ${minimapViewBox.height}`} role="img" aria-label="Podgląd całej planszy"><rect x="0" y="0" width={documentSize.width} height={documentSize.height} fill="#fff" stroke="#ccd2df" />{miniObjects.map(item => <rect key={item.id} x={item.box.x} y={item.box.y} width={Math.max(2, item.box.width)} height={Math.max(2, item.box.height)} fill={item.color} opacity=".8" />)}</svg><span>{miniObjects.length} elementów</span></div>}
            </div>
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
