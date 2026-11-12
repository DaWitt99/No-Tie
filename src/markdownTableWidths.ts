import type { EditorView } from '@milkdown/kit/prose/view'

const metadataPattern = /<!-- no-tie-table-widths:([\d,;.-]+) -->/
const rowMetadataPattern = /<!-- no-tie-table-heights:([\d,;.-]+) -->/

export type TableColumnWidths = (number[] | null)[]
export type TableRowHeights = (number[] | null)[]

export function stripTableWidthMetadata(markdown: string): string {
  const stripped = markdown.replace(/\s*<!-- no-tie-table-widths:[\d,;.-]+ -->/g, '').replace(/\s*<!-- no-tie-table-heights:[\d,;.-]+ -->/g, '')
  return stripped === markdown ? markdown : stripped.trimEnd()
}

export function parseTableColumnWidths(markdown: string): TableColumnWidths {
  const encoded = markdown.match(metadataPattern)?.[1]
  if (!encoded) return []
  return encoded.split(';').map(table => table === '-'
    ? null
    : table.split(',').map(value => Number(value)).map(value => Number.isFinite(value) && value > 0 ? value : 0))
}

export function parseTableRowHeights(markdown: string): TableRowHeights {
  const encoded = markdown.match(rowMetadataPattern)?.[1]
  if (!encoded) return []
  return encoded.split(';').map(table => table === '-'
    ? null
    : table.split(',').map(value => Number(value)).map(value => Number.isFinite(value) && value > 0 ? value : 0))
}

export function markdownWithTableColumnWidths(markdown: string, view: EditorView): string {
  const content = stripTableWidthMetadata(markdown)
  const tables: (number[] | null)[] = []
  view.state.doc.descendants(node => {
    if (node.type.name !== 'table') return
    const header = node.firstChild
    if (!header) {
      tables.push(null)
      return
    }
    const widths: number[] = []
    header.forEach(cell => {
      const colwidth = cell.attrs.colwidth
      const width = Array.isArray(colwidth) ? Number(colwidth[0]) : 0
      widths.push(Number.isFinite(width) && width > 0 ? Math.round(width) : 0)
    })
    tables.push(widths.some(Boolean) ? widths : null)
  })
  const encodedWidths = tables.some(Boolean) ? tables.map(widths => widths ? widths.map(width => width || 0).join(',') : '-').join(';') : ''
  const rowHeights: TableRowHeights = Array.from(view.dom.querySelectorAll('table')).map(table => {
    const values = Array.from(table.rows).map(row => {
      const height = Number(row.dataset.noTieRowHeight)
      return Number.isFinite(height) && height > 0 ? Math.round(height) : 0
    })
    return values.some(Boolean) ? values : null
  })
  const encodedHeights = rowHeights.some(Boolean) ? rowHeights.map(heights => heights ? heights.map(height => height || 0).join(',') : '-').join(';') : ''
  if (!encodedWidths && !encodedHeights) return content
  const metadata = [
    encodedWidths ? `<!-- no-tie-table-widths:${encodedWidths} -->` : '',
    encodedHeights ? `<!-- no-tie-table-heights:${encodedHeights} -->` : '',
  ].filter(Boolean).join('\n')
  return `${content.trimEnd()}\n\n${metadata}\n`
}

export function applyTableColumnWidths(view: EditorView, widthSets: TableColumnWidths) {
  if (!widthSets.length) return
  const transaction = view.state.tr
  let tableIndex = 0
  view.state.doc.descendants((table, tablePos) => {
    if (table.type.name !== 'table') return
    const widths = widthSets[tableIndex++]
    if (!widths) return
    table.forEach((row, rowOffset) => {
      row.forEach((cell, offset, column) => {
        const width = widths[column]
        if (width && Object.hasOwn(cell.attrs, 'colwidth')) {
          const cellPos = tablePos + 1 + rowOffset + 1 + offset
          transaction.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth: [Math.round(width)] })
        }
      })
    })
  })
  if (transaction.docChanged) view.dispatch(transaction)
}

export function applyTableRowHeights(view: EditorView, heightSets: TableRowHeights) {
  if (!heightSets.length) return
  const tables = Array.from(view.dom.querySelectorAll('table'))
  heightSets.forEach((heights, tableIndex) => {
    const table = tables[tableIndex]
    if (!table || !heights) return
    Array.from(table.rows).forEach((row, rowIndex) => {
      const height = heights[rowIndex]
      if (!height) return
      row.style.height = `${Math.round(height)}px`
      row.dataset.noTieRowHeight = String(Math.round(height))
    })
  })
}
