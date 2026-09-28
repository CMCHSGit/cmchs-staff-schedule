/**
 * First name as people actually use it — "Wei-Ming (Sam) Chen" is "Sam".
 */
export function firstName(displayName) {
  const s = (displayName || '').trim()
  const nickname = s.match(/\(([^)]+)\)/)
  if (nickname) return nickname[1].trim()
  return s.split(/\s+/)[0] || ''
}

/**
 * The short names the schedule shows, like the Excel's Name column: the
 * admin-set Excel name when there is one, otherwise first name — falling
 * back to the full name only where two people share a first name.
 * Returns a Map of uid → name.
 */
export function shortNames(users) {
  const base = new Map(users.map(u => [u.uid, (u.excelName || '').trim() || firstName(u.displayName) || u.email || 'Unknown']))
  const counts = new Map()
  for (const name of base.values()) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) || 0) + 1)
  return new Map(users.map(u => {
    const name = base.get(u.uid)
    const clash = counts.get(name.toLowerCase()) > 1 && !(u.excelName || '').trim()
    return [u.uid, clash ? (u.displayName || name).replace(/\s*\([^)]*\)\s*/, ' ').trim() : name]
  }))
}
