import { Puzzle, X } from 'lucide-react'
import { featureModules, type FeatureFlags, type FeatureId } from './features'

export function FeatureManagerDialog({ features, onToggle, onConfigureLock, onClose }: {
  features: FeatureFlags
  onToggle: (id: FeatureId, enabled: boolean) => void
  onConfigureLock: () => void
  onClose: () => void
}) {
  return <div className="modal-backdrop feature-manager-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="feature-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="feature-manager-title">
      <header><span className="folder-dialog-mark"><Puzzle size={19} /></span><div><h2 id="feature-manager-title">Moduły aplikacji</h2><p>Wyłączone moduły ukrywają swoje narzędzia. Zapisane notatki i pliki pozostają na miejscu.</p></div><button type="button" className="icon-button" aria-label="Zamknij moduły" onClick={onClose}><X size={17} /></button></header>
      <div className="feature-manager-list">{featureModules.map(feature => <label className="feature-manager-row" key={feature.id}>
        <span><strong>{feature.title}</strong><small>{feature.description}</small></span>
        <input type="checkbox" checked={features[feature.id]} onChange={event => onToggle(feature.id, event.target.checked)} aria-label={`${features[feature.id] ? 'Wyłącz' : 'Włącz'}: ${feature.title}`} />
      </label>)}</div>
      {features.appLock && <button type="button" className="button secondary feature-lock-configure" onClick={onConfigureLock}>Ustaw PIN blokady</button>}
      <footer>Ustawienia modułów dotyczą tego urządzenia.</footer>
    </section>
  </div>
}
