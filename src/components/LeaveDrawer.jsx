import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import Drawer, { DrawerHead } from './Drawer'
import { Button } from './ui'
import { LEAVE_TYPES } from '../utils/status'
import { fromISO, dayMonth, dayMonthYear, weekdaysInRange, WEEK_DAYS } from '../utils/week'
import { holidayOn } from '../utils/holidays'

/**
 * Books leave (or training) straight from the Leave calendar: who it's for,
 * what kind, and the first and last day of it. Everyone can book their own;
 * admins can book for anyone. Weekends and public holidays inside the range
 * are skipped, and every other day of those weeks is left as it is.
 */
export default function LeaveDrawer({ date, people, names, defaultUid, canPickOthers, booked = [], onSave, onOpenDay, onClose }) {
  const [uid, setUid] = useState(defaultUid && people.some(p => p.uid === defaultUid) ? defaultUid : people[0]?.uid || '')
  const [type, setType] = useState(LEAVE_TYPES[0])
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const [saving, setSaving] = useState(false)

  const start = from
  const end = to < from ? from : to
  const days = weekdaysInRange(start, end).filter(d => !holidayOn(d.iso))
  const person = people.find(p => p.uid === uid)

  async function save() {
    if (!person || !days.length) return
    setSaving(true)
    try {
      await onSave({ person, from: start, to: end, type })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer label={`Book leave from ${dayMonthYear(date)}`} onClose={onClose}>
      <DrawerHead overline="Book leave" title={`${WEEK_DAYS[(fromISO(date).getDay() + 6) % 7]} ${dayMonthYear(date)}`} onClose={onClose}>
        {holidayOn(date) || 'Pick who it’s for and how long it runs.'}
      </DrawerHead>

      <div className="field">
        <label className="field-label" htmlFor="leave-person">Who</label>
        {canPickOthers && people.length > 1 ? (
          <select id="leave-person" value={uid} onChange={e => setUid(e.target.value)}>
            {people.map(p => <option key={p.uid} value={p.uid}>{names.get(p.uid) || p.displayName}</option>)}
          </select>
        ) : (
          <span className="field-static">{person ? names.get(person.uid) || person.displayName : 'Nobody to book for'}</span>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="leave-type">What</label>
        <select id="leave-type" value={type} onChange={e => setType(e.target.value)}>
          {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="drawer-grid">
        <div className="field">
          <label className="field-label" htmlFor="leave-from">First day</label>
          <input id="leave-from" className="input" type="date" value={from} onChange={e => setFrom(e.target.value || date)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="leave-to">Last day</label>
          <input id="leave-to" className="input" type="date" value={to} min={from} onChange={e => setTo(e.target.value || from)} />
        </div>
      </div>

      <p className="text-sm text-muted">
        {days.length
          ? `${days.length} working ${days.length === 1 ? 'day' : 'days'} — ${dayMonth(days[0].iso)} to ${dayMonth(days[days.length - 1].iso)}. Weekends and public holidays are skipped.`
          : 'No working days in that range — pick dates that cover a weekday.'}
      </p>

      {!!booked.length && (
        <div className="field">
          <span className="field-label">Already booked on {dayMonth(date)}</span>
          <div className="drawer-chips">
            {booked.map(b => <span key={b.uid} className="month-item" style={{ background: b.bg }}>{b.name}</span>)}
          </div>
        </div>
      )}

      <div className="drawer-actions">
        <Button onClick={save} disabled={saving || !person || !days.length}>Book leave</Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="ghost" className="ml-auto" iconLeft={<CalendarRange size={16} />} onClick={onOpenDay} disabled={saving}>Who’s where</Button>
      </div>
    </Drawer>
  )
}
