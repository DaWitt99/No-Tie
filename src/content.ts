import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Note, NoteAsset, NoteAttachment } from './types'

export const starterNotes: Note[] = [
  {
    id: 'welcome-note',
    title: 'Witaj w No-Tie',
    folder: 'Osobiste',
    tags: ['start', 'pomysły'],
    favorite: true,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    content: '# Twoje myśli, w jednym miejscu\n\nNo-Tie zapisuje notatki jako pliki Markdown i SVG na tym urządzeniu. Możesz pisać w **Markdownie**, porządkować wpisy tagami i tworzyć własne schematy SVG.\n\n## Zacznij od pomysłu\n\n- Utwórz notatkę przyciskiem **Nowa notatka**.\n- Dodaj tagi, żeby łatwiej ją odnaleźć.\n- Narysuj prosty diagram i umieść go w treści.\n\n## Diagram przykładowy\n\n![Przepływ pomysłu](./assets/idea-map.svg)\n\n> Dane pozostają na tym urządzeniu. Użyj eksportu, aby przenieść je na inne.',
  },
  {
    id: 'meeting-note',
    title: 'Przygotowanie spotkania',
    folder: 'Praca',
    tags: ['spotkanie', 'projekt'],
    favorite: false,
    createdAt: Date.now() - 172_800_000,
    updatedAt: Date.now() - 3_600_000,
    content: '# Przygotowanie spotkania\n\n## Cel\n\nUzgodnić kolejne kroki i podział zadań.\n\n## Agenda\n\n- [ ] Krótkie podsumowanie\n- [ ] Omówienie otwartych kwestii\n- [ ] Ustalenie terminów\n\n## Notatki\n\nDopisuj tutaj najważniejsze ustalenia.',
  },
  {
    id: 'reading-note',
    title: 'Rzeczy do sprawdzenia',
    folder: 'Pomysły',
    tags: ['do przeczytania'],
    favorite: false,
    createdAt: Date.now() - 259_200_000,
    updatedAt: Date.now() - 86_400_000,
    content: '# Rzeczy do sprawdzenia\n\n- Przetestować eksport paczki notatek.\n- Przygotować skróty klawiszowe edytora.\n- Sprawdzić, jak działa instalacja PWA na telefonie.\n',
  },
]

export const starterAssets: NoteAsset[] = [
  {
    id: 'idea-map',
    noteId: 'welcome-note',
    fileName: 'idea-map.svg',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360"><rect width="800" height="360" rx="28" fill="#f8f7f2"/><path d="M400 176 C300 176 250 112 158 112 M400 184 C500 184 550 248 642 248" fill="none" stroke="#9ea8bf" stroke-width="4" stroke-linecap="round"/><rect x="302" y="134" width="196" height="92" rx="20" fill="#fff" stroke="#7a8aa9" stroke-width="3"/><text x="400" y="187" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#19243a">Pomysł</text><rect x="56" y="70" width="204" height="84" rx="18" fill="#e7eeff" stroke="#9aadd2" stroke-width="3"/><text x="158" y="120" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#263858">Zapisz</text><rect x="540" y="206" width="204" height="84" rx="18" fill="#fce9e1" stroke="#e6ad98" stroke-width="3"/><text x="642" y="256" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#5f392e">Rozwiń</text></svg>',
  },
]

export function noteToMarkdown(note: Note): string {
  const metadata: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    favorite: note.favorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
  if (typeof note.color === 'string' && /^#[\da-f]{6}$/i.test(note.color)) metadata.color = note.color
  if (typeof note.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(note.dailyDate)) metadata.dailyDate = note.dailyDate
  return `---\n${stringifyYaml(metadata).trimEnd()}\n---\n\n${note.content.trimStart()}\n`
}

export function markdownToNote(markdown: string, fallbackId: string, now = Date.now()): Note {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  const parsed = match ? parseYaml(match[1]) : {}
  const metadata = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  const body = match ? markdown.slice(match[0].length) : markdown
  const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : []
  return {
    id: typeof metadata.id === 'string' ? metadata.id : fallbackId,
    title: typeof metadata.title === 'string' ? metadata.title : 'Importowana notatka',
    folder: typeof metadata.folder === 'string' ? metadata.folder : 'Importowane',
    color: typeof metadata.color === 'string' && /^#[\da-f]{6}$/i.test(metadata.color) ? metadata.color : undefined,
    tags,
    favorite: metadata.favorite === true,
    createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
    updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
    dailyDate: typeof metadata.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.dailyDate) ? metadata.dailyDate : undefined,
    content: body.trimStart(),
  }
}

export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

export function markdownForEditor(content: string, assets: NoteAsset[], attachments: NoteAttachment[] = []): string {
  const withSvg = assets.reduce((markdown, asset) => {
    const path = `./assets/${asset.fileName}`
    return markdown.replaceAll(`](${path})`, `](${svgDataUrl(asset.svg)})`)
  }, content)
  return attachments.reduce((markdown, attachment) => markdown.replaceAll(`]('./assets/${attachment.fileName}')`, `](${attachment.dataUrl})`).replaceAll(`](./assets/${attachment.fileName})`, `](${attachment.dataUrl})`), withSvg)
}

export function markdownFromEditor(content: string, assets: NoteAsset[], attachments: NoteAttachment[] = []): string {
  const withAttachments = attachments.reduce((markdown, attachment) => markdown.replaceAll(`](${attachment.dataUrl})`, `](./assets/${attachment.fileName})`), content)
  return assets.reduce((markdown, asset) => {
    return markdown.replaceAll(`](${svgDataUrl(asset.svg)})`, `](./assets/${asset.fileName})`)
  }, withAttachments)
}

export function sanitizeSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  if (root.tagName.toLowerCase() !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('Nie udało się odczytać grafiki SVG.')
  }

  const allowedTags = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker'])
  const allowedAttributes = new Set(['xmlns', 'width', 'height', 'viewBox', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'text-anchor', 'font-family', 'font-size', 'marker-end', 'marker-start', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'id', 'transform', 'data-object-id', 'data-group-id', 'data-shape-key', 'data-start-target', 'data-start-anchor', 'data-end-target', 'data-end-anchor'])
  document.querySelectorAll('*').forEach(element => {
    if (!allowedTags.has(element.tagName.toLowerCase())) {
      element.remove()
      return
    }
    Array.from(element.attributes).forEach(attribute => {
      if (!allowedAttributes.has(attribute.name) || /^on/i.test(attribute.name) || /javascript:/i.test(attribute.value) || /url\s*\(\s*(['"]?)(?:https?:|data:|javascript:|\/\/)/i.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    })
  })
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(root)
}
