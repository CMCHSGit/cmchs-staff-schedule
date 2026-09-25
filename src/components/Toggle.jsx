export default function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-knob" /></span>
      <span className="toggle-text">{label}</span>
    </label>
  )
}
