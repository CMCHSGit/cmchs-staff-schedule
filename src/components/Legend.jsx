import { LEGEND } from '../utils/status'

export default function Legend() {
  return (
    <div className="legend">
      {LEGEND.map(l => (
        <span key={l.label} className="legend-item">
          <span className="legend-swatch" style={{ background: l.bg }} />{l.label}
        </span>
      ))}
    </div>
  )
}
