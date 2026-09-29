import { useState } from 'react'
import Drawer, { DrawerHead } from './Drawer'
import { Button, Switch, Tag, Badge } from './ui'
import LocationCombobox from './LocationCombobox'
import { describeDay, PLAIN, INK } from '../utils/status'
import { STANDARD_QUICK_FILLS } from '../utils/teams'
import { normalizeSchedule, weekDates, WEEK_DAYS, dayMonthYear } from '../utils/week'
import { holidayOn } from '../utils/holidays'

/**
 * "Whereabouts" panel for one person's day, opened by tapping a cell in
 * Team week. onSave gets the person's whole updated week. The week's comment
 * has its own button in the Comments column, and customer calls are rostered
 * on the On-call page — neither is set from here.
 */
export default function EditDrawer({ person, name, isSelf, weekStart, dayIdx, schedule, locations, calls, onSave, onClose }) {
  const days = normalizeSchedule(schedule?.days)
  const dates = weekDates(weekStart)
  const holiday = holidayOn(dates[dayIdx])

  const [location, setLocation] = useState(days[dayIdx].location)
  const [wholeWeek, setWholeWeek] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save(entry) {
    // "Every day" leaves public holidays alone — they already show as the holiday.
    const targets = wholeWeek ? [0, 1, 2, 3, 4].filter(i => i === dayIdx || !holidayOn(dates[i])) : [dayIdx]
    const next = days.map((d, i) => (targets.includes(i) ? { ...d, ...entry } : d))
    setSaving(true)
    try {
      await onSave(next, entry.location)
    } finally {
      setSaving(false)
    }
  }

  const onCall = calls || days[dayIdx].onCall
  const { bg: tint, filled } = describeDay({ location, onCall })
  const options = [...new Set([...locations, ...days.map(d => d.location).filter(Boolean)])]

  return (
    <Drawer label={`Whereabouts for ${name}`} onClose={onClose}>
      <DrawerHead overline="Whereabouts" title={name} onClose={onClose}>
        {WEEK_DAYS[dayIdx]} {dayMonthYear(dates[dayIdx])}
        {holiday && <Badge tone="purple" className="ml-8">{holiday}</Badge>}
      </DrawerHead>

      <div className="drawer-section" style={{ background: filled ? tint : 'var(--surface-subtle)', ...(filled && { color: INK }) }}>
        <label className="field-label" htmlFor="drawer-location">{isSelf ? 'Where you’ll be' : `Where ${name} will be`}</label>
        <LocationCombobox
          id="drawer-location"
          value={location}
          options={options}
          onChange={setLocation}
          tint={PLAIN}
          placeholder={holiday ? `${holiday} — or type where` : 'Type or pick a location…'}
        />
        <div className="quick-picks">
          {STANDARD_QUICK_FILLS.map(q => (
            <Tag key={q} selected={location === q} onClick={() => setLocation(q)}>{q}</Tag>
          ))}
        </div>
      </div>

      {onCall && (
        <p className="text-sm text-muted">On customer calls this day — that’s set on the On-call roster, not here.</p>
      )}

      <Switch checked={wholeWeek} onChange={setWholeWeek} label="Apply to every day this week" />

      {!isSelf && person.pending && (
        <p className="text-sm text-muted">{name} hasn’t signed in yet — this fills in for them until they do.</p>
      )}

      <div className="drawer-actions">
        <Button onClick={() => save({ location: location.trim() })} disabled={saving}>Save</Button>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="ghost" className="ml-auto" onClick={() => save({ location: '', onCall: false })} disabled={saving}>Clear entry</Button>
      </div>
    </Drawer>
  )
}
