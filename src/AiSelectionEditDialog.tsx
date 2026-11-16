import { useState } from 'react'
import { Check, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import type { AiDiagnostic, AiPreferences } from './types'
import { DEFAULT_AI_PREFERENCES } from './types'
import { streamOllamaMessageWithFallback } from './ollama'

export function AiSelectionEditDialog({ selectedText, model, baseUrl, preferences = DEFAULT_AI_PREFERENCES, onApply, onRunTask, onDiagnostic, onRateOutput, onClose }: { selectedText: string; model: string; baseUrl: string; preferences?: AiPreferences; onApply: (replacement: string) => void; onRunTask?: (label: string, run: (signal: AbortSignal) => Promise<void>) => Promise<void>; onDiagnostic?: (diagnostic: AiDiagnostic) => void; onRateOutput?: (rating: 1 | -1, comment: string) => void; onClose: () => void }) {
  const [instruction, setInstruction] = useState('Popraw tekst, zachowując jego sens i format Markdown.')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ratingComment, setRatingComment] = useState('')
  const [rated, setRated] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [usedModel, setUsedModel] = useState(model)
  const taskProfiles = preferences.promptProfiles.filter(profile => profile.task === 'selection-edit')
  const selectedProfile = taskProfiles.find(profile => profile.id === selectedProfileId)

  const beforeLines = selectedText.split('\n')
  const afterLines = draft.split('\n')
  const lineEdits = (() => {
    if (!draft.trim() || beforeLines.length > 250 || afterLines.length > 250) return [] as { kind: 'same' | 'added' | 'removed'; text: string }[]
    const matrix = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[])
    for (let left = beforeLines.length - 1; left >= 0; left--) for (let right = afterLines.length - 1; right >= 0; right--) matrix[left]![right] = beforeLines[left] === afterLines[right] ? matrix[left + 1]![right + 1]! + 1 : Math.max(matrix[left + 1]![right]!, matrix[left]![right + 1]!)
    const edits: { kind: 'same' | 'added' | 'removed'; text: string }[] = []
    let left = 0; let right = 0
    while (left < beforeLines.length || right < afterLines.length) {
      if (left < beforeLines.length && right < afterLines.length && beforeLines[left] === afterLines[right]) { edits.push({ kind: 'same', text: beforeLines[left++]! }); right++ }
      else if (right < afterLines.length && (left >= beforeLines.length || matrix[left]![right + 1]! >= matrix[left + 1]![right]!)) edits.push({ kind: 'added', text: afterLines[right++]! })
      else edits.push({ kind: 'removed', text: beforeLines[left++]! })
    }
    return edits
  })()
  async function generate() {
    if (!selectedText.trim()) return
    setBusy(true); setDraft(''); setError('')
    setRated(false); setRatingComment('')
    const startedAt = Date.now()
    let selectedModel = model
    try {
      const preferencesPrompt = preferences.ratings.filter(item => item.task === 'selection-edit').slice(-3).map(item => `${item.rating > 0 ? 'Zachowaj dobre cechy' : 'Popraw poprzedni wynik'}${item.comment ? `: ${item.comment}` : ''}`).join('\n')
      let output = ''
      const trackedPerform = async (signal: AbortSignal) => {
        await streamOllamaMessageWithFallback(baseUrl, model, preferences.fallbackModel, [
          { role: 'system', content: `Edytujesz zaznaczony fragment notatki. Zwróć wyłącznie gotowy fragment bez objaśnień i bez ogrodzenia kodu. Zachowaj składnię Markdown.${selectedProfile?.prompt ? `\nProfil: ${selectedProfile.prompt}` : ''}${preferencesPrompt ? `\nPreferencje z ocen: ${preferencesPrompt}` : ''}` },
          { role: 'user', content: `Instrukcja: ${instruction}\n\nFragment do edycji:\n${selectedText}` },
        ], chunk => { output += chunk; setDraft(current => current + chunk) }, signal, undefined, fallback => { output = ''; setUsedModel(fallback); setDraft('') }, selected => { selectedModel = selected; setUsedModel(selected) })
        if (!signal.aborted && !output.trim()) throw new Error('Model nie zwrócił edytowanego fragmentu.')
      }
      await (onRunTask ? onRunTask('Edycja zaznaczenia z AI', trackedPerform) : trackedPerform(new AbortController().signal))
      onDiagnostic?.({ task: 'selection-edit', model: selectedModel, contextCharacters: selectedText.length + instruction.length, contextImages: 0, durationMs: Date.now() - startedAt, createdAt: Date.now() })
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : 'Nie udało się wygenerować zmian.'
      setError(detail)
      onDiagnostic?.({ task: 'selection-edit', model: selectedModel, contextCharacters: selectedText.length + instruction.length, contextImages: 0, durationMs: Date.now() - startedAt, error: detail, createdAt: Date.now() })
    } finally { setBusy(false) }
  }
  return <div className="modal-backdrop ai-edit-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><section className="ai-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title"><header><span className="folder-dialog-mark"><Sparkles size={18} /></span><div><h2 id="ai-edit-title">Edytuj zaznaczenie z AI</h2><p>Porównaj różnice i zatwierdź dopiero wtedy, gdy wynik będzie gotowy.</p></div><button className="icon-button" type="button" aria-label="Zamknij" disabled={busy} onClick={onClose}><X size={17} /></button></header><label>Instrukcja<textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} /></label><label>Profil promptu<select value={selectedProfileId} onChange={event => setSelectedProfileId(event.target.value)}><option value="">Domyślny</option>{taskProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><div className="ai-edit-preview-label">Różnice przed zastosowaniem</div><div className="ai-edit-diff" aria-label="Podgląd różnic"><pre>{lineEdits.length ? lineEdits.map((edit, index) => <span className={`diff-${edit.kind}`} key={index}>{edit.kind === 'added' ? '+ ' : edit.kind === 'removed' ? '− ' : '  '}{edit.text || ' '}{'\n'}</span>) : draft ? 'Fragment jest długi; porównaj źródło i wynik obok siebie.' : 'Wygenerowana zmiana pojawi się tutaj.'}</pre><div><section><strong>Oryginał</strong><pre>{selectedText}</pre></section><section><strong>Propozycja{usedModel !== model ? ` · ${usedModel}` : ''}</strong><pre>{draft || (busy ? 'Model pisze…' : 'Oczekiwanie na wynik')}</pre></section></div></div>{onRateOutput && draft && !rated && <div className="ai-output-rating"><input value={ratingComment} onChange={event => setRatingComment(event.target.value)} placeholder="Opcjonalna wskazówka dla kolejnych edycji" aria-label="Komentarz do oceny AI" /><button type="button" className="icon-button" aria-label="Dobra odpowiedź" onClick={() => { onRateOutput(1, ratingComment); setRated(true) }}><ThumbsUp size={15} /></button><button type="button" className="icon-button" aria-label="Słaba odpowiedź" onClick={() => { onRateOutput(-1, ratingComment); setRated(true) }}><ThumbsDown size={15} /></button></div>}{error && <p className="ai-edit-error" role="alert">{error}</p>}<footer><button type="button" className="button secondary" onClick={() => { void generate() }} disabled={busy || !selectedText.trim()}><Sparkles size={14} />{busy ? 'Generowanie…' : 'Wygeneruj ponownie'}</button><div><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Anuluj</button><button type="button" className="button primary" onClick={() => { onApply(draft); onClose() }} disabled={!draft.trim() || busy}><Check size={15} />Zastosuj</button></div></footer></section></div>
}
