import { weekDates, fromISO, toISO, DAY_SHORT } from '../utils/week'

/** Mon–Fri picker for views that show one day at a time. */
export default function DayPills({ weekStart, value, onChange }) {
  const today = toISO(new Date())
  return (
    <div className="day-pills" role="tablist" aria-label="Day">
      {weekDates(weekStart).map((iso, i) => (
        <button
          key={iso}
          type="button"
          role="tab"
          aria-selected={i === value}
          className={`day-pill${i === value ? ' selected' : ''}${iso === today ? ' today' : ''}`}
          onClick={() => onChange(i)}
        >
          <span className="day-pill-dow">{DAY_SHORT[i]}</span>
          <span className="day-pill-num">{fromISO(iso).getDate()}</span>
        </button>
      ))}
    </div>
  )
}
