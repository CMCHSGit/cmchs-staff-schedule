import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, IconButton } from './ui'
import { dayMonthYear } from '../utils/week'

/** Previous/next week, with a way back to this week once you've wandered off. */
export default function WeekNav({ weekStart, isThisWeek, onPrev, onNext, onThisWeek, children }) {
  return (
    <div className="week-nav">
      <div className="week-nav-main">
        <IconButton label="Previous week" onClick={onPrev}><ChevronLeft size={20} /></IconButton>
        <div className="week-nav-label">
          <span className="overline">Week starting</span>
          <span className="week-nav-date">{dayMonthYear(weekStart)}</span>
        </div>
        <IconButton label="Next week" onClick={onNext}><ChevronRight size={20} /></IconButton>
      </div>
      {!isThisWeek && <Button variant="ghost" size="sm" onClick={onThisWeek}>This week</Button>}
      {children && <div className="week-nav-actions">{children}</div>}
    </div>
  )
}
