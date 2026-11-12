import { useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { streamOllamaMessage } from './ollama'

export function AiSelectionEditDialog({ selectedText, model, baseUrl, onApply, onClose }: { selectedText: string; model: string; baseUrl: string; onApply: (replacement: string) => void; onClose: () => void }) {
  const [instruction, setInstruction] = useState('Popraw tekst, zachowując jego sens i format Markdown.')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function generate() {
    if (!selectedText.trim()) return
    setBusy(true); setDraft(''); setError('')
    try {
      await streamOllamaMessage(baseUrl, model, [
        { role: 'system', content: 'Edytujesz zaznaczony fragment notatki. Zwróć wyłącznie gotowy fragment bez objaśnień i bez ogrodzenia kodu. Zachowaj składnię Markdown.' },
        { role: 'user', content: `Instrukcja: ${instruction}\n\nFragment do edycji:\n${selectedText}` },
      ], chunk => setDraft(current => current + chunk))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się wygenerować zmian.') }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop ai-edit-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><section className="ai-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title"><header><span className="folder-dialog-mark"><Sparkles size={18} /></span><div><h2 id="ai-edit-title">Edytuj zaznaczenie z AI</h2><p>Odpowiedź jest podglądem — zastosujesz ją dopiero po sprawdzeniu.</p></div><button className="icon-button" type="button" aria-label="Zamknij" onClick={onClose}><X size={17} /></button></header><label>Instrukcja<textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} /></label><div className="ai-edit-preview-label">Podgląd Markdown</div><pre className="ai-edit-preview">{draft || (busy ? 'Model pisze…' : 'Wygenerowana wersja pojawi się tutaj.')}</pre>{error && <p className="ai-edit-error" role="alert">{error}</p>}<footer><button type="button" className="button secondary" onClick={() => void generate()} disabled={busy || !selectedText.trim()}><Sparkles size={14} />{busy ? 'Generowanie…' : 'Wygeneruj'}</button><div><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Anuluj</button><button type="button" className="button primary" onClick={() => { onApply(draft); onClose() }} disabled={!draft.trim() || busy}><Check size={15} />Zastosuj</button></div></footer></section></div>
}
