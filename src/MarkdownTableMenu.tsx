import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Copy, Filter, Palette, Plus, Trash2, X } from 'lucide-react'
import { markdownTableColors } from './markdownTableColors'

export type MarkdownTableAction =
  | 'add-row-before' | 'add-row-after' | 'add-column-before' | 'add-column-after'
  | 'delete-row' | 'delete-column' | 'copy-table' | 'sort-ascending' | 'sort-descending' | 'clear-filter'

export function MarkdownTableMenu({
  mode,
  left,
  top,
  row,
  filterValue,
  copied,
  onAction,
  onCellColor,
  onFilterChange,
  onDismiss,
}: {
  mode: 'toolbar' | 'context'
  left: number
  top: number
  row: number
  filterValue: string
  copied: boolean
  onAction: (action: MarkdownTableAction) => void
  onCellColor: (color: string) => void
  onFilterChange: (value: string) => void
  onDismiss: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onDismissRef = useRef(onDismiss)
  const [currentFilter, setCurrentFilter] = useState(filterValue)

  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])
  useEffect(() => {
    if (mode !== 'context') return
    const dismissOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onDismissRef.current()
    }
    const dismissKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissRef.current()
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissKeyboard)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissKeyboard)
    }
  }, [mode])

  const buttonDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault()
  }
  const clearFilter = () => {
    setCurrentFilter('')
    onAction('clear-filter')
  }

  return <div
    className={`markdown-table-tools ${mode === 'context' ? 'context-menu' : 'hover-toolbar'}`}
    style={{ left, top }}
    ref={menuRef}
    role={mode === 'context' ? 'menu' : 'toolbar'}
    aria-label={mode === 'context' ? 'Menu tabeli' : 'Narzędzia tabeli'}
    onMouseDown={buttonDown}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
  >
    {mode === 'context' && <div className="markdown-table-menu-title">Tabela</div>}
    <div className="markdown-table-action-row">
      {mode === 'context' && <button type="button" role="menuitem" onClick={() => onAction('add-row-before')}><Plus size={13} />Dodaj wiersz powyżej</button>}
      <button type="button" aria-label="Dodaj wiersz poniżej" title="Dodaj wiersz poniżej" onClick={() => onAction('add-row-after')}><Plus size={13} /><span>Wiersz</span></button>
      {mode === 'context' && <button type="button" role="menuitem" onClick={() => onAction('delete-row')} disabled={row === 0}><Trash2 size={13} />Usuń wiersz</button>}
    </div>
    <div className="markdown-table-action-row">
      {mode === 'context' && <button type="button" role="menuitem" onClick={() => onAction('add-column-before')}><Plus size={13} />Dodaj kolumnę przed</button>}
      <button type="button" aria-label="Dodaj kolumnę za bieżącą" title="Dodaj kolumnę za bieżącą" onClick={() => onAction('add-column-after')}><Plus size={13} /><span>Kolumna</span></button>
      {mode === 'context' && <button type="button" role="menuitem" onClick={() => onAction('delete-column')}><Trash2 size={13} />Usuń kolumnę</button>}
    </div>
    <div className="markdown-table-action-row">
      <button type="button" aria-label="Sortuj rosnąco" title="Sortuj rosnąco" onClick={() => onAction('sort-ascending')}><ArrowUpAZ size={14} /><span>A–Z</span></button>
      <button type="button" aria-label="Sortuj malejąco" title="Sortuj malejąco" onClick={() => onAction('sort-descending')}><ArrowDownAZ size={14} /><span>Z–A</span></button>
      <button type="button" aria-label={copied ? 'Skopiowano tabelę' : 'Kopiuj całą tabelę'} title={copied ? 'Skopiowano' : 'Kopiuj całą tabelę'} onClick={() => onAction('copy-table')}><Copy size={14} /><span>{copied ? 'Skopiowano' : 'Kopiuj'}</span></button>
    </div>
    <div className="markdown-table-color-row" aria-label="Kolor komórki">
      <span><Palette size={13} />Kolor</span>
      {markdownTableColors.map(color => <button key={color.value} type="button" aria-label={`Kolor komórki: ${color.label}`} title={color.label} style={{ backgroundColor: color.value }} onClick={() => onCellColor(color.value)} />)}
      <button type="button" className="markdown-table-color-clear" aria-label="Usuń kolor komórki" title="Usuń kolor" onClick={() => onCellColor('')}><X size={12} /></button>
    </div>
    <label className="markdown-table-filter"><Filter size={13} /><input aria-label="Filtruj bieżącą kolumnę" value={currentFilter} onChange={event => { setCurrentFilter(event.currentTarget.value); onFilterChange(event.currentTarget.value) }} placeholder="Filtruj kolumnę…" />{currentFilter && <button type="button" aria-label="Wyczyść filtr" onClick={clearFilter}><X size={12} /></button>}</label>
  </div>
}
