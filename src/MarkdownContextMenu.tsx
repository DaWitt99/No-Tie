import { useEffect, useRef, useState } from 'react'

export type MarkdownMenuAction =
  | 'bold' | 'italic' | 'strike' | 'underline' | 'highlight' | 'code' | 'inline-math' | 'comment' | 'clear-format'
  | 'bullet-list' | 'ordered-list' | 'task-list' | 'heading-1' | 'heading-2' | 'heading-3' | 'paragraph' | 'blockquote'
  | 'footnote' | 'table' | 'callout' | 'horizontal-rule' | 'code-block' | 'math-block'

type MenuSection = 'format' | 'paragraph' | 'insert'

const menuSections: { id: MenuSection; label: string; items: { action: MarkdownMenuAction; label: string }[] }[] = [
  {
    id: 'format', label: 'Format', items: [
      { action: 'bold', label: 'Pogrubienie' },
      { action: 'italic', label: 'Kursywa' },
      { action: 'strike', label: 'Przekreślenie' },
      { action: 'underline', label: 'Podkreślenie' },
      { action: 'highlight', label: 'Zaznaczenie kolorowe' },
      { action: 'code', label: 'Kod' },
      { action: 'inline-math', label: 'Matematyka' },
      { action: 'comment', label: 'Komentarz' },
      { action: 'clear-format', label: 'Czyść formatowanie' },
    ],
  },
  {
    id: 'paragraph', label: 'Akapit', items: [
      { action: 'bullet-list', label: 'Lista wypunktowana' },
      { action: 'ordered-list', label: 'Lista numerowana' },
      { action: 'task-list', label: 'Lista zadań' },
      { action: 'heading-1', label: 'Nagłówek rozmiaru 1' },
      { action: 'heading-2', label: 'Nagłówek rozmiaru 2' },
      { action: 'heading-3', label: 'Nagłówek rozmiaru 3' },
      { action: 'paragraph', label: 'Treść' },
      { action: 'blockquote', label: 'Cytat' },
    ],
  },
  {
    id: 'insert', label: 'Wstaw', items: [
      { action: 'footnote', label: 'Przypis' },
      { action: 'table', label: 'Tabela' },
      { action: 'callout', label: 'Blok wyróżnienia' },
      { action: 'horizontal-rule', label: 'Linia pozioma' },
      { action: 'code-block', label: 'Blok kodu' },
      { action: 'math-block', label: 'Blok matematyczny' },
    ],
  },
]

export function MarkdownContextMenu({
  left,
  top,
  opensLeft,
  onAction,
  onDismiss,
}: {
  left: number
  top: number
  opensLeft: boolean
  onAction: (action: MarkdownMenuAction) => void
  onDismiss: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onDismissRef = useRef(onDismiss)
  const [activeSection, setActiveSection] = useState<MenuSection>()

  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])
  useEffect(() => {
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
  }, [])

  return <div
    className="markdown-context-menu"
    style={{ left, top }}
    role="menu"
    aria-label="Menu kontekstowe edytora Markdown"
    ref={menuRef}
    onMouseDown={event => event.preventDefault()}
    onContextMenu={event => event.preventDefault()}
  >
    {menuSections.map(section => <div className="markdown-context-section" key={section.id}>
      <button
        type="button"
        role="menuitem"
        className={`markdown-context-category ${activeSection === section.id ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={activeSection === section.id}
        onPointerEnter={() => setActiveSection(section.id)}
        onClick={() => setActiveSection(section.id)}
      >
        <span>{section.label}</span><span className="markdown-context-chevron">›</span>
      </button>
      {activeSection === section.id && <div className={`markdown-context-submenu ${opensLeft ? 'opens-left' : ''}`} role="menu" aria-label={section.label}>
        {section.items.map(item => <button type="button" role="menuitem" key={item.action} onClick={() => onAction(item.action)}>{item.label}</button>)}
      </div>}
    </div>)}
  </div>
}
