import { useState } from 'react'
import Drawer, { DrawerHead } from './Drawer'
import { Button } from './ui'
import { weekLabel } from '../utils/week'

/**
 * The week's comment for one person — opened by the Comments button in Team
 * week. Read-only for anyone who can't edit that person's week, so a comment
 * the grid cuts off can still be read in full.
 */
export default function CommentDrawer({ name, isSelf, weekStart, comments, readOnly, onSave, onClose }) {
  const [text, setText] = useState(comments || '')
  const [saving, setSaving] = useState(false)

  async function save(value) {
    setSaving(true)
    try {
      await onSave(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer label={`Comment for ${name}`} onClose={onClose}>
      <DrawerHead overline="Comment" title={name} onClose={onClose}>{weekLabel(weekStart)}</DrawerHead>

      <div className="field">
        <label className="field-label" htmlFor="drawer-comment">{isSelf ? 'Your note for this week' : `Note on ${name}’s week`}</label>
        <span className="text-sm text-muted">e.g. back from leave on the 5th, client visits, anything the team should know.</span>
        <textarea
          id="drawer-comment"
          className="input"
          rows={4}
          value={text}
          readOnly={readOnly}
          placeholder={readOnly ? 'No comment for this week.' : 'Optional notes for the week…'}
          onChange={e => setText(e.target.value)}
        />
      </div>

      <div className="drawer-actions">
        {readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={() => save(text)} disabled={saving}>Save</Button>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            {!!comments && <Button variant="ghost" className="ml-auto" onClick={() => save('')} disabled={saving}>Clear</Button>}
          </>
        )}
      </div>
    </Drawer>
  )
}
