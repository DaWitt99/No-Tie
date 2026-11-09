import { useEffect, useRef, useState } from 'react'
import { Bot, LoaderCircle, MessageSquare, Send, Settings2, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import type { Note } from './types'
import { sendOllamaMessage, type OllamaMessage } from './ollama'

type ChatPanelProps = {
  open: boolean
  baseUrl: string
  model: string
  note?: Note
  onClose: () => void
  onOpenSettings: () => void
}

type ChatLine = Pick<OllamaMessage, 'role' | 'content'>

function loadConversation(key: string): ChatLine[] {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed)
      ? parsed.filter((line): line is ChatLine => line && typeof line === 'object'
        && ['user', 'assistant'].includes((line as ChatLine).role)
        && typeof (line as ChatLine).content === 'string')
      : []
  } catch {
    return []
  }
}

export function ChatPanel({ open, baseUrl, model, note, onClose, onOpenSettings }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Record<string, ChatLine[]>>({})
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [useNoteContext, setUseNoteContext] = useState(true)
  const [sending, setSending] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const storageKey = `no-tie-ollama-chat:${note?.id ?? 'general'}`
  const messages = conversations[storageKey] ?? loadConversation(storageKey)
  const error = conversationErrors[storageKey] ?? ''

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  async function sendMessage() {
    const content = draft.trim()
    if (!content || sending) return
    if (!model) {
      setConversationErrors(current => ({ ...current, [storageKey]: 'Najpierw wybierz model w ustawieniach Ollama.' }))
      return
    }

    const requestKey = storageKey
    const nextMessages = [...messages, { role: 'user' as const, content }]
    setConversations(current => ({ ...current, [requestKey]: nextMessages }))
    localStorage.setItem(requestKey, JSON.stringify(nextMessages))
    setDraft('')
    setConversationErrors(current => ({ ...current, [requestKey]: '' }))
    setSending(true)

    const prompt: OllamaMessage[] = []
    if (useNoteContext && note) {
      const text = note.content.slice(0, 40_000)
      prompt.push({
        role: 'system',
        content: `Jesteś lokalnym asystentem w aplikacji do notatek. Odpowiadaj po polsku, chyba że użytkownik poprosi inaczej. Pomagaj w pracy nad bieżącą notatką, ale nie twierdź, że ją zmieniłeś.\n\nTytuł notatki: ${note.title}\n\nTreść notatki${note.content.length > text.length ? ' (początek, reszta została pominięta)' : ''}:\n${text}`,
      })
    }

    try {
      const answer = await sendOllamaMessage(baseUrl, model, [...prompt, ...nextMessages])
      const complete = [...nextMessages, { role: 'assistant' as const, content: answer }]
      localStorage.setItem(requestKey, JSON.stringify(complete))
      setConversations(current => ({ ...current, [requestKey]: complete }))
    } catch (sendError) {
      const message = typeof sendError === 'string' ? sendError : sendError instanceof Error ? sendError.message : 'Nie udało się uzyskać odpowiedzi modelu.'
      setConversationErrors(current => ({ ...current, [requestKey]: message }))
    } finally {
      setSending(false)
    }
  }

  function clearConversation() {
    setConversations(current => ({ ...current, [storageKey]: [] }))
    setConversationErrors(current => ({ ...current, [storageKey]: '' }))
    localStorage.removeItem(storageKey)
  }

  return (
    <aside className={`ollama-chat-panel ${open ? 'mobile-visible' : ''}`} aria-label="Czat z lokalnym modelem">
      <header className="ollama-chat-header">
        <div className="ollama-chat-identity">
          <div className="ollama-chat-mark"><Bot size={18} /></div>
          <div><strong>Lokalny asystent</strong><span><i className={model ? 'model-status ready' : 'model-status'} />{model || 'Model niepodłączony'}</span></div>
        </div>
        <div className="ollama-chat-actions">
          {messages.length > 0 && <button className="chat-icon-button" onClick={clearConversation} title="Wyczyść rozmowę" aria-label="Wyczyść rozmowę"><Trash2 size={15} /></button>}
          <button className="chat-icon-button" onClick={onOpenSettings} title="Ustawienia Ollama" aria-label="Ustawienia Ollama"><Settings2 size={16} /></button>
          <button className="chat-icon-button chat-close" onClick={onClose} title="Zamknij czat" aria-label="Zamknij czat"><X size={17} /></button>
        </div>
      </header>

      {!model ? (
        <div className="chat-unconfigured">
          <div className="chat-empty-mark"><Bot size={24} /></div>
          <strong>Podłącz lokalny model</strong>
          <p>Wskaż serwer Ollama i wybierz model pobrany na tym urządzeniu.</p>
          <button className="button primary" onClick={onOpenSettings}><Settings2 size={14} />Otwórz ustawienia</button>
        </div>
      ) : (
        <>
          <div className="ollama-chat-messages" aria-live="polite">
            {messages.length === 0 && <div className="chat-welcome"><div className="chat-empty-mark"><Sparkles size={21} /></div><strong>{note ? 'Porozmawiaj o tej notatce' : 'Zacznij rozmowę'}</strong><p>{note ? `Kontekst: ${note.title}` : 'Wiadomości są wysyłane do lokalnego serwera Ollama.'}</p></div>}
            {messages.map((message, index) => <article key={`${index}-${message.role}`} className={`chat-message ${message.role}`}>
              <div className="chat-message-avatar">{message.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}</div>
              <div className="chat-message-body"><span>{message.role === 'user' ? 'Ty' : 'Asystent'}</span><p>{message.content}</p></div>
            </article>)}
            {sending && <div className="chat-thinking"><LoaderCircle size={15} className="spin" />Model przygotowuje odpowiedź…</div>}
            <div ref={messagesEnd} />
          </div>
          <form className="ollama-chat-composer" onSubmit={event => { event.preventDefault(); void sendMessage() }}>
            {note && <label className="chat-context-toggle"><input type="checkbox" checked={useNoteContext} onChange={event => setUseNoteContext(event.target.checked)} />Kontekst bieżącej notatki</label>}
            {error && <p className="chat-error" role="alert">{error}</p>}
            <div className="chat-compose-box"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} placeholder="Napisz wiadomość…" aria-label="Wiadomość do lokalnego modelu" rows={3} disabled={sending} /><button type="submit" disabled={!draft.trim() || sending} title="Wyślij" aria-label="Wyślij wiadomość"><Send size={16} /></button></div>
            <span className="chat-local-note"><MessageSquare size={12} />Rozmowa pozostaje na tym urządzeniu</span>
          </form>
        </>
      )}
    </aside>
  )
}
