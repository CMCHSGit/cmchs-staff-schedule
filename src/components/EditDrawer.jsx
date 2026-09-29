import { useEffect, useRef, useState } from 'react'
import { Phone } from 'lucide-react'
import Drawer, { DrawerHead } from './Drawer'
import { Button, Tag, Badge } from './ui'
import LocationCombobox from './LocationCombobox'
import { describeDay } from '../utils/status'
import { STANDARD_QUICK_FILLS } from '../utils/teams'
import { normalizeSchedule, weekDates, weekLabel, WEEK_DAYS, dayMonth } from '../utils/week'
import { holidayOn } from '../utils/holidays'

const splitPlaces = value => (value || '').split('/').map(p => p.trim()).filter(Boolean)

/**
 * "Whereabouts" panel for one person's whole week, opened by tapping any cell
 * in Team week. The day tapped is highlighted and scrolled to, but all five
 * days are editable at once, so filling in a week is one panel and one save
 * rather than five. The week's comment has its own button in the Comments
 * column, and customer calls are rostered on the On-call page — neither is
 * set from here.
 */
export default function EditDrawer({ person, name, isSelf, weekStart, dayIdx, schedule, locations, calls = [], onSave, onClose }) {
  const dates = weekDates(weekStart)
  const holidays = dates.map(holidayOn)

  const [days, setDays] = useState(() => normalizeSchedule(schedule?.days))
  const [added, setAdded] = useState([]) // typed here, not a known location yet
  const [saving, setSaving] = useState(false)
  const tapped = useRef(null)

  // Open on the day that was tapped — scrolled into view, but not focused,
  // which on a phone would throw the keyboard up over the rest of the week.
  useEffect(() => { tapped.current?.scrollIntoView({ block: 'nearest' }) }, [])

  const setDay = (i, location) => setDays(prev => prev.map((d, j) => (j === i ? { ...d, location } : d)))
  /** Public holidays keep what they have — they already show as the holiday. */
  const fillAll = location => setDays(prev => prev.map((d, i) => (holidays[i] ? d : { ...d, location })))
  const clearWeek = () => setDays(prev => prev.map(d => ({ ...d, location: '', onCall: false })))
  const registerNew = place =>
    setAdded(prev => (prev.some(p => p.toLowerCase() === place.toLowerCase()) ? prev : [...prev, place]))

  const options = [...new Set([...locations, ...added, ...days.flatMap(d => splitPlaces(d.location))])]

  async function save() {
    setSaving(true)
    try {
      await onSave(days.map(d => ({ ...d, location: d.location.trim() })), added)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer label={`Whereabouts for ${name}`} onClose={onClose}>
      <DrawerHead overline="Whereabouts" title={name} onClose={onClose}>{weekLabel(weekStart)}</DrawerHead>

      <div className="quick-picks">
        <span className="text-sm text-muted">Fill every day:</span>
        {STANDARD_QUICK_FILLS.map(q => <Tag key={q} onClick={() => fillAll(q)}>{q}</Tag>)}
      </div>

      <div className="drawer-days">
        {WEEK_DAYS.map((day, i) => {
          const onCall = !!calls[i] || days[i].onCall
          const { bg, fg } = describeDay({ location: days[i].location, onCall })
          return (
            <div key={day} ref={i === dayIdx ? tapped : undefined} className={`drawer-day${i === dayIdx ? ' tapped' : ''}`}>
              <div className="drawer-day-head">
                <span className="drawer-day-name">{day}</span>
                <span className="drawer-day-date">{dayMonth(dates[i])}</span>
                {holidays[i] && <Badge tone="purple">{holidays[i]}</Badge>}
              </div>
              <LocationCombobox
                id={`drawer-day-${i}`}
                value={days[i].location}
                options={options}
                onChange={val => setDay(i, val)}
                onNewValue={registerNew}
                tint={bg}
                tintFg={fg}
                placeholder={holidays[i] ? `${holidays[i]} — or type where` : 'Type or pick a location…'}
              />
              {onCall && (
                <span className="day-card-note"><Phone size={14} aria-hidden="true" />Customer calls — rostered on the On-call page</span>
              )}
            </div>
          )
        })}
      </div>

      {!isSelf && person.pending && (
        <p className="text-sm text-muted">{name} hasn’t signed in yet — this fills in for them until they do.</p>
      )}

      <div className="drawer-actions">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save week'}</Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="ghost" className="ml-auto" onClick={clearWeek} disabled={saving}>Clear week</Button>
      </div>
    </Drawer>
  )
}
