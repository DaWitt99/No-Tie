import { Channel, invoke, isTauri } from '@tauri-apps/api/core'

export type OllamaModel = {
  name: string
  size?: number
  modified_at?: string
}

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function apiUrl(baseUrl: string, route: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error('Podaj prawidłowy adres Ollama, np. http://localhost:11434.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Adres Ollama musi zaczynać się od http:// lub https://.')
  }
  const root = base.endsWith('/api') ? base.slice(0, -4) : base
  return `${root}/api/${route}`
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Ollama zwróciła błąd HTTP ${response.status}.`)
  }
  return response.json() as Promise<T>
}

function connectionError(error: unknown, baseUrl: string): Error {
  if (error instanceof Error && !(error instanceof TypeError)) return error
  const browserHint = isTauri() ? '' : ' W wersji przeglądarkowej Ollama musi zezwalać na adres strony w OLLAMA_ORIGINS.'
  return new Error(`Nie można połączyć się z Ollama pod adresem ${baseUrl}. Upewnij się, że aplikacja Ollama jest uruchomiona.${browserHint}`)
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  if (isTauri()) return invoke<OllamaModel[]>('ollama_list_models', { baseUrl })
  try {
    const response = await fetch(apiUrl(baseUrl, 'tags'), { signal: AbortSignal.timeout(12_000) })
    const result = await readJson<{ models?: OllamaModel[] }>(response)
    return result.models ?? []
  } catch (error) {
    throw connectionError(error, baseUrl)
  }
}

function readOllamaStreamLine(line: string, onChunk: (content: string) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return
  let item: { message?: { content?: unknown }; error?: unknown }
  try {
    item = JSON.parse(trimmed) as typeof item
  } catch {
    throw new Error('Ollama zwróciła nieprawidłowy fragment odpowiedzi.')
  }
  if (typeof item.error === 'string' && item.error) throw new Error(item.error)
  if (typeof item.message?.content === 'string' && item.message.content) onChunk(item.message.content)
}

async function consumeOllamaStream(response: Response, onChunk: (content: string) => void): Promise<void> {
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Ollama zwróciła błąd HTTP ${response.status}.`)
  }
  if (!response.body) throw new Error('Ollama nie udostępniła strumienia odpowiedzi.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) readOllamaStreamLine(line, onChunk)
  }
  pending += decoder.decode()
  if (pending.trim()) readOllamaStreamLine(pending, onChunk)
}

export async function streamOllamaMessage(baseUrl: string, model: string, messages: OllamaMessage[], onChunk: (content: string) => void): Promise<void> {
  if (!model.trim()) throw new Error('Wybierz model w ustawieniach Ollama.')
  if (isTauri()) {
    const onChunkChannel = new Channel<string>()
    onChunkChannel.onmessage = onChunk
    try {
      await invoke<void>('ollama_chat_stream', { baseUrl, model, messages, onChunk: onChunkChannel })
    } catch (error) {
      if (typeof error === 'string') throw new Error(error)
      throw connectionError(error, baseUrl)
    }
    return
  }
  try {
    const response = await fetch(apiUrl(baseUrl, 'chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: AbortSignal.timeout(5 * 60_000),
    })
    await consumeOllamaStream(response, onChunk)
  } catch (error) {
    throw connectionError(error, baseUrl)
  }
}
