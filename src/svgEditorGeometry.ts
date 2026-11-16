export type SvgPoint = { x: number; y: number }
export type SvgBox = { x: number; y: number; width: number; height: number }

const SVG_NS = 'http://www.w3.org/2000/svg'

export function pointInPolygon(point: SvgPoint, polygon: SvgPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

export function lassoIntersectsBox(polygon: SvgPoint[], box: SvgBox): boolean {
  if (polygon.length < 3) return false
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
  ]
  return corners.some(point => pointInPolygon(point, polygon))
    || pointInPolygon({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, polygon)
    || polygon.some(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height)
}

type Segment = { a: SvgPoint; b: SvgPoint }

function segmentIntersection(first: Segment, second: Segment): SvgPoint | undefined {
  const { a, b } = first
  const { a: c, b: d } = second
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
  if (Math.abs(denominator) < 1e-8) return undefined
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } : undefined
}

function geometryFor(element: SVGElement): { points: SvgPoint[]; segments: Segment[] } {
  const points: SvgPoint[] = []
  const segments: Segment[] = []
  const addPath = (values: SvgPoint[], closed = false) => {
    points.push(...values)
    for (let index = 0; index < values.length - 1; index++) {
      const a = values[index]; const b = values[index + 1]
      segments.push({ a, b }); points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
    if (closed && values.length > 2) {
      const a = values.at(-1)!; const b = values[0]
      segments.push({ a, b }); points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
  }
  const tag = element.tagName.toLowerCase()
  if (tag === 'line') {
    addPath([{ x: Number(element.getAttribute('x1')), y: Number(element.getAttribute('y1')) }, { x: Number(element.getAttribute('x2')), y: Number(element.getAttribute('y2')) }])
  } else if (tag === 'polyline' || tag === 'polygon') {
    const values = (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
    const parsed: SvgPoint[] = []
    for (let index = 0; index + 1 < values.length; index += 2) parsed.push({ x: values[index], y: values[index + 1] })
    addPath(parsed, tag === 'polygon')
  } else if (tag === 'path' && element.hasAttribute('data-editor-pen')) {
    try {
      const parsed = JSON.parse(element.getAttribute('data-pen-points') ?? '[]') as SvgPoint[]
      addPath(parsed.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)), /z\s*$/i.test(element.getAttribute('d') ?? ''))
    } catch { /* fall through to path sampling */ }
  } else if (tag === 'path') {
    const path = element as SVGPathElement
    try {
      const length = path.getTotalLength()
      const count = Math.max(2, Math.min(64, Math.ceil(length / 16)))
      const parsed = Array.from({ length: count + 1 }, (_, index) => {
        const point = path.getPointAtLength(length * index / count)
        return { x: point.x, y: point.y }
      })
      addPath(parsed, /z\s*$/i.test(path.getAttribute('d') ?? ''))
    } catch { /* malformed paths cannot be snapped */ }
  } else {
    try {
      const box = (element as SVGGraphicsElement).getBBox()
      const x = box.x; const y = box.y; const right = x + box.width; const bottom = y + box.height
      const corners = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
      addPath(corners, true)
      points.push({ x: x + box.width / 2, y }, { x: right, y: y + box.height / 2 }, { x: x + box.width / 2, y: bottom }, { x, y: y + box.height / 2 })
      if (tag === 'circle' || tag === 'ellipse') points.push({ x: x + box.width / 2, y: y + box.height / 2 })
    } catch { /* element has no measurable geometry */ }
  }
  return { points, segments }
}

export function findGeometrySnap(stage: SVGSVGElement, location: SvgPoint, excludedIds: string[], threshold: number): SvgPoint | undefined {
  const excluded = new Set(excludedIds)
  const all = Array.from(stage.children).filter((element): element is SVGElement => element instanceof SVGElement
    && element.hasAttribute('data-object-id') && !excluded.has(element.getAttribute('data-object-id') ?? '')
    && element.getAttribute('visibility') !== 'hidden')
  const ownerMatrix = stage.getScreenCTM()
  const geometries = all.map(element => {
    const geometry = geometryFor(element)
    const graphics = element as SVGGraphicsElement
    const elementMatrix = graphics.getScreenCTM?.()
    const matrix = ownerMatrix && elementMatrix ? ownerMatrix.inverse().multiply(elementMatrix) : undefined
    if (!matrix) return geometry
    const transform = (point: SvgPoint): SvgPoint => {
      const mapped = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: mapped.x, y: mapped.y }
    }
    return {
      points: geometry.points.map(transform),
      segments: geometry.segments.map(segment => ({ a: transform(segment.a), b: transform(segment.b) })),
    }
  })
  const candidates = geometries.flatMap(geometry => geometry.points)
  const nearbySegments = geometries.map(geometry => geometry.segments.filter(({ a, b }) => {
    const left = Math.min(a.x, b.x) - threshold; const right = Math.max(a.x, b.x) + threshold
    const top = Math.min(a.y, b.y) - threshold; const bottom = Math.max(a.y, b.y) + threshold
    return location.x >= left && location.x <= right && location.y >= top && location.y <= bottom
  }))
  for (let first = 0; first < geometries.length; first++) {
    for (let second = first + 1; second < geometries.length; second++) {
      for (const a of nearbySegments[first]) {
        for (const b of nearbySegments[second]) {
          const intersection = segmentIntersection(a, b)
          if (intersection) candidates.push(intersection)
        }
      }
    }
  }
  let closest: SvgPoint | undefined
  let best = threshold
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - location.x, candidate.y - location.y)
    if (distance < best) { best = distance; closest = candidate }
  }
  return closest
}

export function reversePathData(path: SVGPathElement): string | undefined {
  try {
    const length = path.getTotalLength()
    if (!Number.isFinite(length) || length < 1) return undefined
    const count = Math.max(12, Math.min(1000, Math.ceil(length / 2)))
    const points = Array.from({ length: count + 1 }, (_, index) => path.getPointAtLength(length * index / count)).reverse()
    const rounded = (value: number) => Number(value.toFixed(2))
    let commands = `M ${rounded(points[0].x)} ${rounded(points[0].y)}`
    for (let index = 0; index < points.length - 1; index++) {
      const previous = points[Math.max(0, index - 1)]
      const start = points[index]
      const end = points[index + 1]
      const next = points[Math.min(points.length - 1, index + 2)]
      commands += ` C ${rounded(start.x + (end.x - previous.x) / 6)} ${rounded(start.y + (end.y - previous.y) / 6)} ${rounded(end.x - (next.x - start.x) / 6)} ${rounded(end.y - (next.y - start.y) / 6)} ${rounded(end.x)} ${rounded(end.y)}`
    }
    return /z\s*$/i.test(path.getAttribute('d') ?? '') ? `${commands} Z` : commands
  } catch { return undefined }
}

export function outlineOpenStroke(path: SVGPathElement): SVGPathElement | undefined {
  if (/z\s*$/i.test(path.getAttribute('d') ?? '')) return undefined
  try {
    const length = path.getTotalLength()
    const width = Math.max(.1, Number(path.getAttribute('stroke-width')) || 1)
    if (!Number.isFinite(length) || length < .1) return undefined
    const count = Math.max(8, Math.min(1000, Math.ceil(length / Math.max(1, width / 2))))
    const samples = Array.from({ length: count + 1 }, (_, index) => path.getPointAtLength(length * index / count))
    const left: SvgPoint[] = []
    const right: SvgPoint[] = []
    samples.forEach((point, index) => {
      const before = samples[Math.max(0, index - 1)]
      const after = samples[Math.min(samples.length - 1, index + 1)]
      const dx = after.x - before.x; const dy = after.y - before.y
      const magnitude = Math.hypot(dx, dy) || 1
      const nx = -dy / magnitude * width / 2; const ny = dx / magnitude * width / 2
      left.push({ x: point.x + nx, y: point.y + ny })
      right.push({ x: point.x - nx, y: point.y - ny })
    })
    const vertices = [...left, ...right.reverse()]
    const d = `${vertices.map((point, index) => `${index ? 'L' : 'M'} ${Number(point.x.toFixed(2))} ${Number(point.y.toFixed(2))}`).join(' ')} Z`
    const output = document.createElementNS(SVG_NS, 'path')
    output.setAttribute('d', d)
    return output
  } catch { return undefined }
}
