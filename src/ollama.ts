import { invoke, isTauri } from '@tauri-apps/api/core'

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

export async function sendOllamaMessage(baseUrl: string, model: string, messages: OllamaMessage[]): Promise<string> {
  if (isTauri()) return invoke<string>('ollama_chat', { baseUrl, model, messages })
  try {
    const response = await fetch(apiUrl(baseUrl, 'chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(5 * 60_000),
    })
    const result = await readJson<{ message?: { content?: string } }>(response)
    if (typeof result.message?.content !== 'string') throw new Error('Ollama nie zwróciła treści odpowiedzi.')
    return result.message.content
  } catch (error) {
    throw connectionError(error, baseUrl)
  }
}
