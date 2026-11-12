import { useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole, Unlock, X } from 'lucide-react'

export function AppLockDialog({ mode, onSetPin, onUnlock, onClose }: {
  mode: 'setup' | 'unlock'
  onSetPin: (pin: string) => Promise<void>
  onUnlock: (pin: string) => Promise<boolean>
  onClose?: () => void
}) {
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pin.length < 4) { setError('PIN musi mieć co najmniej 4 znaki.'); return }
    if (mode === 'setup' && pin !== confirmation) { setError('Wpisane kody PIN różnią się.'); return }
    setBusy(true)
    try {
      if (mode === 'setup') { await onSetPin(pin); onClose?.() }
      else if (!await onUnlock(pin)) setError('Nieprawidłowy PIN.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawienia blokady.')
    } finally { setBusy(false); setPin(''); setConfirmation('') }
  }
  return <div className="modal-backdrop app-lock-backdrop" role="presentation"><section className="folder-dialog app-lock-dialog" role="dialog" aria-modal="true" aria-labelledby="app-lock-title"><div className="folder-dialog-mark"><LockKeyhole size={19} /></div>{mode === 'unlock' && onClose && <button type="button" className="icon-button app-lock-close" onClick={onClose} aria-label="Zamknij" title="Zamknij"><X size={16} /></button>}<h2 id="app-lock-title">{mode === 'setup' ? 'Ustaw PIN aplikacji' : 'No-Tie jest zablokowane'}</h2><p>{mode === 'setup' ? 'PIN blokuje dostęp do interfejsu na tym urządzeniu. Nie szyfruje plików notatek.' : 'Wpisz PIN, aby wrócić do notatek.'}</p><form onSubmit={event => void submit(event)}><label htmlFor="app-lock-pin">PIN</label><input id="app-lock-pin" autoFocus inputMode="numeric" autoComplete="one-time-code" type="password" value={pin} onChange={event => { setPin(event.target.value); setError('') }} minLength={4} maxLength={32} /><small className="app-lock-error" role="alert">{error}</small>{mode === 'setup' && <><label htmlFor="app-lock-pin-confirm">Powtórz PIN</label><input id="app-lock-pin-confirm" inputMode="numeric" autoComplete="new-password" type="password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setError('') }} minLength={4} maxLength={32} /></>}<div className="folder-dialog-actions">{onClose && mode === 'setup' && <button type="button" className="button secondary" onClick={onClose}>Anuluj</button>}<button type="submit" className="button primary" disabled={busy || pin.length < 4 || (mode === 'setup' && confirmation.length < 4)}>{mode === 'setup' ? <><KeyRound size={14} />Zapisz PIN</> : <><Unlock size={14} />Odblokuj</>}</button></div></form></section></div>
}
