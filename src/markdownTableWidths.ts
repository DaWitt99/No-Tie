import type { EditorView } from '@milkdown/kit/prose/view'

const metadataPattern = /(?:\r?\n)*<!-- no-tie-table-widths:([\d,;.-]+) -->\s*$/

export type TableColumnWidths = (number[] | null)[]

export function stripTableWidthMetadata(markdown: string): string {
  return markdown.replace(metadataPattern, '')
}

export function parseTableColumnWidths(markdown: string): TableColumnWidths {
  const encoded = markdown.match(metadataPattern)?.[1]
  if (!encoded) return []
  return encoded.split(';').map(table => table === '-'
    ? null
    : table.split(',').map(value => Number(value)).map(value => Number.isFinite(value) && value > 0 ? value : 0))
}

export function markdownWithTableColumnWidths(markdown: string, view: EditorView): string {
  const previousMetadata = metadataPattern.test(markdown)
  const content = markdown.replace(metadataPattern, '')
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
  if (!tables.some(Boolean)) return previousMetadata ? content : markdown
  const encoded = tables.map(widths => widths ? widths.map(width => width || 0).join(',') : '-').join(';')
  return `${content.trimEnd()}\n\n<!-- no-tie-table-widths:${encoded} -->\n`
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
