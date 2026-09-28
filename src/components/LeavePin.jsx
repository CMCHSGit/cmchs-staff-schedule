import { Pin } from 'lucide-react'
import { weekDates, dayMonth, toISO, DAY_SHORT } from '../utils/week'

/** Sticky "who's on leave" strip for the selected day. */
export default function LeavePin({ weekStart, dayIdx, people, names }) {
  const iso = weekDates(weekStart)[dayIdx]
  const isToday = iso === toISO(new Date())
  return (
    <div className="leave-pin">
      <div className="leave-pin-inner">
        <Pin size={16} aria-hidden="true" />
        <span className="leave-pin-title">On leave {DAY_SHORT[dayIdx]} {dayMonth(iso)}{isToday ? ' (today)' : ''}</span>
        {people.length
          ? people.map(u => <span key={u.uid} className="leave-chip">{names.get(u.uid)}</span>)
          : <span className="text-muted text-sm">No one is on leave.</span>}
      </div>
    </div>
  )
}
