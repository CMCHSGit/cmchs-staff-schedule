// WeekNav.jsx
export function WeekNav({ label, onPrev, onNext, canPrev, canNext }) {
  return (
    <div className="week-nav">
      <button className="week-arrow" onClick={onPrev} disabled={!canPrev} aria-label="Previous week">‹</button>
      <span className="week-nav-label">{label}</span>
      <button className="week-arrow" onClick={onNext} disabled={!canNext} aria-label="Next week">›</button>
    </div>
  )
}
export default WeekNav
