import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton, Switch, Tag, Badge } from './ui'
import LocationCombobox from './LocationCombobox'
import { describeDay, PLAIN, INK } from '../utils/status'
import { STANDARD_QUICK_FILLS } from '../utils/teams'
import { normalizeSchedule, weekDates, WEEK_DAYS, dayMonthYear } from '../utils/week'
import { holidayOn } from '../utils/holidays'

/**
 * "Whereabouts" panel for one person's day, opened by tapping a cell in
 * Team week. Slides in from the right on desktop, full screen on a phone.
 * onSave gets the person's whole updated week (days + comment).
 */
export default function EditDrawer({ person, name, isSelf, weekStart, dayIdx, schedule, locations, showCalls, onSave, onClose }) {
  const days = normalizeSchedule(schedule?.days)
  const dates = weekDates(weekStart)
  const holiday = holidayOn(dates[dayIdx])

  const [location, setLocation] = useState(days[dayIdx].location)
  const [calls, setCalls] = useState(days[dayIdx].onCall)
  const [wholeWeek, setWholeWeek] = useState(false)
  const [comment, setComment] = useState(schedule?.comments || '')
  const [saving, setSaving] = useState(false)

  // Lock the page behind the panel, and let Escape close it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  async function save(entry) {
    // "Every day" leaves public holidays alone — they already show as the holiday.
    const targets = wholeWeek ? [0, 1, 2, 3, 4].filter(i => i === dayIdx || !holidayOn(dates[i])) : [dayIdx]
    const next = days.map((d, i) => (targets.includes(i) ? { ...entry } : d))
    setSaving(true)
    try {
      await onSave(next, comment, entry.location)
    } finally {
      setSaving(false)
    }
  }

  const { bg: tint, filled } = describeDay({ location, onCall: calls })
  const options = [...new Set([...locations, ...days.map(d => d.location).filter(Boolean)])]

  return (
    <div className="drawer" data-no-ptr>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-label={`Whereabouts for ${name}`}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <span className="overline">Whereabouts</span>
            <span className="drawer-name">{name}</span>
            <span className="text-sm">
              {WEEK_DAYS[dayIdx]} {dayMonthYear(dates[dayIdx])}
              {holiday && <Badge tone="purple" className="ml-8">{holiday}</Badge>}
            </span>
          </div>
          <IconButton label="Close" onClick={onClose}><X size={20} /></IconButton>
        </div>

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

        {showCalls && (
          <Switch checked={calls} onChange={setCalls} label="Customer calls" />
        )}
        <Switch checked={wholeWeek} onChange={setWholeWeek} label="Apply to every day this week" />

        <div className="field">
          <label className="field-label" htmlFor="drawer-comment">Comment for this week</label>
          <input
            id="drawer-comment"
            className="input"
            value={comment}
            placeholder="e.g. Back 5th"
            onChange={e => setComment(e.target.value)}
          />
        </div>

        {!isSelf && person.pending && (
          <p className="text-sm text-muted">{name} hasn’t signed in yet — this fills in for them until they do.</p>
        )}

        <div className="drawer-actions">
          <Button onClick={() => save({ location: location.trim(), onCall: calls })} disabled={saving}>Save</Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="ghost" className="ml-auto" onClick={() => save({ location: '', onCall: false })} disabled={saving}>Clear entry</Button>
        </div>
      </div>
    </div>
  )
}
