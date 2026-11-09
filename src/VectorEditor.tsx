import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Circle, MousePointer2, RectangleHorizontal, Type, Undo2, X } from 'lucide-react'
import { SVG, type Svg } from '@svgdotjs/svg.js'
import type { NoteAsset } from './types'
import { sanitizeSvg } from './content'

type Tool = 'select' | 'rect' | 'ellipse' | 'arrow' | 'text'
type Drawing = Svg

const WIDTH = 800
const HEIGHT = 500

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
  const active = useRef<{ tool: Tool; element: any; x: number; y: number; lastX?: number; lastY?: number } | null>(null)
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState('#596fd8')
  const [text, setText] = useState('Etykieta')
  const [canUndo, setCanUndo] = useState(false)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { colorRef.current = color }, [color])

  useEffect(() => {
    if (!mount.current) return
    const stage = SVG().addTo(mount.current).size('100%', '100%').viewbox(0, 0, WIDTH, HEIGHT)
    stage.rect(WIDTH, HEIGHT).fill('#fffdf9').attr({ 'data-background': 'true' })
    if (asset?.svg) {
      try {
        const parsed = new DOMParser().parseFromString(sanitizeSvg(asset.svg), 'image/svg+xml')
        stage.svg(parsed.documentElement.innerHTML)
      } catch {
        // Start with an empty canvas when an imported drawing cannot be read.
      }
    }
    drawing.current = stage
    history.current = [stage.svg()]

    const point = (event: PointerEvent) => {
      const bounds = stage.node.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(WIDTH, (event.clientX - bounds.left) * WIDTH / bounds.width)),
        y: Math.max(0, Math.min(HEIGHT, (event.clientY - bounds.top) * HEIGHT / bounds.height)),
      }
    }
    const start = (event: PointerEvent) => {
      const currentTool = toolRef.current
      event.preventDefault()
      stage.node.setPointerCapture(event.pointerId)
      const location = point(event)
      if (currentTool === 'text') return
      if (currentTool === 'select') {
        const target = event.target
        if (target instanceof SVGElement && target !== stage.node && !target.hasAttribute('data-background')) {
          const selected = SVG(target)
          selected.attr('stroke-dasharray', '5 4')
          active.current = { tool: currentTool, element: selected, x: location.x, y: location.y, lastX: location.x, lastY: location.y }
        }
        return
      }
      const currentColor = colorRef.current
      let element: any
      if (currentTool === 'rect') element = stage.rect(1, 1).move(location.x, location.y).fill(`${currentColor}28`).stroke({ color: currentColor, width: 3 }).radius(10)
      if (currentTool === 'ellipse') element = stage.ellipse(1, 1).center(location.x, location.y).fill(`${currentColor}28`).stroke({ color: currentColor, width: 3 })
      if (currentTool === 'arrow') {
        element = stage.line(location.x, location.y, location.x, location.y).stroke({ color: currentColor, width: 4, linecap: 'round' })
        element.marker('end', 14, 14, (marker: any) => marker.path('M 0 0 L 14 7 L 0 14 z').fill(currentColor))
      }
      active.current = { tool: currentTool, element, x: location.x, y: location.y, lastX: location.x, lastY: location.y }
    }
    const move = (event: PointerEvent) => {
      const current = active.current
      if (!current) return
      const location = point(event)
      if (current.tool === 'rect') {
        current.element.move(Math.min(current.x, location.x), Math.min(current.y, location.y))
        current.element.size(Math.max(12, Math.abs(location.x - current.x)), Math.max(12, Math.abs(location.y - current.y)))
      } else if (current.tool === 'ellipse') {
        current.element.size(Math.max(12, Math.abs(location.x - current.x) * 2), Math.max(12, Math.abs(location.y - current.y) * 2))
        current.element.center(current.x, current.y)
      } else if (current.tool === 'arrow') {
        current.element.plot(current.x, current.y, location.x, location.y)
      } else if (current.tool === 'select') {
        current.element.dmove(location.x - (current.lastX ?? current.x), location.y - (current.lastY ?? current.y))
        current.lastX = location.x
        current.lastY = location.y
      }
    }
    const finish = () => {
      if (!active.current) return
      if (active.current.tool === 'select') {
        const node = active.current.element.node as SVGElement
        node.removeAttribute('stroke-dasharray')
      }
      active.current = null
      history.current.push(stage.svg())
      setCanUndo(true)
    }
    stage.node.addEventListener('pointerdown', start)
    stage.node.addEventListener('pointermove', move)
    stage.node.addEventListener('pointerup', finish)
    stage.node.addEventListener('pointercancel', finish)
    return () => {
      stage.node.removeEventListener('pointerdown', start)
      stage.node.removeEventListener('pointermove', move)
      stage.node.removeEventListener('pointerup', finish)
      stage.node.removeEventListener('pointercancel', finish)
      stage.remove()
      drawing.current = null
    }
  }, [asset?.id, asset?.svg])

  const addText = () => {
    const stage = drawing.current
    if (!stage) return
    stage.text(text || 'Tekst').move(80, 80).font({ family: 'Inter, sans-serif', size: 24, weight: 600 }).fill(color)
    history.current.push(stage.svg())
    setCanUndo(true)
  }

  const undo = () => {
    const stage = drawing.current
    if (!stage || history.current.length < 2) return
    history.current.pop()
    stage.clear()
    stage.svg(history.current.at(-1) ?? '')
    setCanUndo(history.current.length > 1)
  }

  const save = () => {
    const stage = drawing.current
    if (!stage) return
    const markup = new XMLSerializer().serializeToString(stage.node)
    onSave(sanitizeSvg(markup))
  }

  const tools: { id: Tool; label: string; icon: typeof RectangleHorizontal }[] = [
    { id: 'select', label: 'Wybierz', icon: MousePointer2 },
    { id: 'rect', label: 'Prostokąt', icon: RectangleHorizontal },
    { id: 'ellipse', label: 'Elipsa', icon: Circle },
    { id: 'arrow', label: 'Strzałka', icon: ArrowRight },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="drawing-modal" role="dialog" aria-modal="true" aria-labelledby="drawing-title">
        <header className="modal-heading">
          <div><p className="eyebrow">EDYTOR SVG</p><h2 id="drawing-title">{asset ? 'Edytuj schemat' : 'Nowy schemat'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={19} /></button>
        </header>
        <div className="drawing-toolbar">
          {tools.map(item => {
            const Icon = item.icon
            return <button key={item.id} className={`tool-button ${tool === item.id ? 'selected' : ''}`} onClick={() => setTool(item.id)} title={item.label} aria-label={item.label}><Icon size={17} /></button>
          })}
          <span className="toolbar-divider" />
          <label className="color-control" title="Kolor">
            <input type="color" value={color} onChange={event => setColor(event.target.value)} />
            <span>Kolor</span>
          </label>
          <span className="toolbar-divider" />
          <input className="diagram-text" value={text} onChange={event => setText(event.target.value)} aria-label="Tekst etykiety" />
          <button className="tool-button" onClick={addText} title="Dodaj tekst" aria-label="Dodaj tekst"><Type size={17} /></button>
          <button className="tool-button" onClick={undo} disabled={!canUndo} title="Cofnij" aria-label="Cofnij"><Undo2 size={17} /></button>
        </div>
        <div className="drawing-stage-wrap"><div ref={mount} className="drawing-stage" /></div>
        <footer className="modal-footer"><p>Wybierz narzędzie i przeciągnij po planszy, aby narysować kształt.</p><div><button className="button secondary" onClick={onClose}>Anuluj</button><button className="button primary" onClick={save}>Zapisz grafikę</button></div></footer>
      </section>
    </div>
  )
}
