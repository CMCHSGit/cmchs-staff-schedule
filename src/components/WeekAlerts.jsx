import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Alert } from './ui'

/** "N things to check this week" — details open by default on desktop, tap to open on a phone. */
export default function WeekAlerts({ conflicts }) {
  const [open, setOpen] = useState(false)
  if (!conflicts.length) return null
  const title = conflicts.length === 1 ? '1 thing to check this week' : `${conflicts.length} things to check this week`
  return (
    <Alert tone="critical" icon={<CircleAlert size={20} />} title={title}>
      <ul className={`conflict-list${open ? ' open' : ''}`}>
        {conflicts.map(c => <li key={c.type + c.text}>{c.text}</li>)}
      </ul>
      <button type="button" className="link-btn conflict-toggle" onClick={() => setOpen(o => !o)}>
        {open ? 'Hide details' : 'Show details'}
      </button>
    </Alert>
  )
}
