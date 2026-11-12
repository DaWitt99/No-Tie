export const WIKI_LINK_INSERT_EVENT = 'no-tie:insert-wiki-link'
export const WIKI_EMBED_INSERT_EVENT = 'no-tie:insert-wiki-embed'
export const AI_REPLACE_SELECTION_EVENT = 'no-tie:replace-selection'
const NOTE_LINK_PREFIX = '#no-tie-note/'

export type WikiLinkInsertDetail = { noteId: string; target: string }
export type WikiEmbedInsertDetail = { noteId: string; target: string }
export type AiReplaceSelectionDetail = { noteId: string; replacement: string }

export function wikiNoteHref(target: string): string {
  const encoded = encodeURIComponent(target).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${NOTE_LINK_PREFIX}${encoded}`
}

export function wikiNoteTargetFromHref(href: string): string | null {
  const encodedTarget = href.startsWith(NOTE_LINK_PREFIX)
    ? href.slice(NOTE_LINK_PREFIX.length)
    : href.startsWith('notie-note:') ? href.slice('notie-note:'.length) : null
  if (encodedTarget === null) return null
  try { return decodeURIComponent(encodedTarget) } catch { return encodedTarget }
}

export function wikiLinksToMarkdown(markdown: string): string {
  return markdown.replace(/(?<!!)\[\[([^\]\n]+)\]\]/g, (_whole, raw: string) => {
    const [rawTarget, rawLabel] = raw.split('|', 2)
    const target = rawTarget.trim()
    const label = (rawLabel ?? rawTarget).trim()
    if (!target || !label) return _whole
    return `[${label.replace(/\]/g, '\\]')}](${wikiNoteHref(target)})`
  })
}

export function markdownToWikiLinks(markdown: string): string {
  return markdown.replace(/(?<!!)\[([^\]\n]+)\]\((?:#no-tie-note\/|notie-note:)([^\s)]+)\)/g, (_whole, rawLabel: string, encodedTarget: string) => {
    let target = encodedTarget
    try { target = decodeURIComponent(encodedTarget) } catch { /* Preserve malformed legacy links verbatim. */ }
    const label = rawLabel.replace(/\\\]/g, ']')
    return `[[${target}${label === target ? '' : `|${label}`}]]`
  })
}

export function replaceWikiLinkTarget(markdown: string, oldTitle: string, newTitle: string): string {
  const old = oldTitle.trim().toLocaleLowerCase('pl')
  if (!old || old === newTitle.trim().toLocaleLowerCase('pl')) return markdown
  return markdown.replace(/\[\[([^\]\n]+)\]\]/g, (whole, raw: string) => {
    const [target, alias] = raw.split('|', 2)
    if (target.trim().toLocaleLowerCase('pl') !== old) return whole
    const shown = alias?.trim().toLocaleLowerCase('pl') === old ? newTitle : alias
    return `[[${newTitle}${shown ? `|${shown}` : ''}]]`
  })
}

export function dispatchWikiLinkInsert(detail: WikiLinkInsertDetail) {
  window.dispatchEvent(new CustomEvent<WikiLinkInsertDetail>(WIKI_LINK_INSERT_EVENT, { detail }))
}

export function dispatchWikiEmbedInsert(detail: WikiEmbedInsertDetail) {
  window.dispatchEvent(new CustomEvent<WikiEmbedInsertDetail>(WIKI_EMBED_INSERT_EVENT, { detail }))
}

export function dispatchAiReplaceSelection(detail: AiReplaceSelectionDetail) {
  window.dispatchEvent(new CustomEvent<AiReplaceSelectionDetail>(AI_REPLACE_SELECTION_EVENT, { detail }))
}
