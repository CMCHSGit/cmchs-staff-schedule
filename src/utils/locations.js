/** "Starship / Cass Office" ⇄ ['Starship', 'Cass Office'] — how a day with several places is stored. */
export const SEPARATOR = ' / '

export const splitPlaces = value => (value || '').split('/').map(p => p.trim()).filter(Boolean)

/**
 * Suggestions in the order they're worth offering: wherever this person was
 * most last week first (most days first), then everything else
 * alphabetically. Last week is the best guess at this one — most people
 * repeat it — while alphabetical keeps the long tail of sites findable
 * rather than leaving it in whatever order Admin happened to add them.
 */
export function rankLocations(options, lastWeekDays = []) {
  const days = new Map()
  for (const day of lastWeekDays) {
    for (const place of splitPlaces(day?.location)) {
      const key = place.toLowerCase()
      days.set(key, (days.get(key) || 0) + 1)
    }
  }
  const used = o => days.get(o.toLowerCase()) || 0
  return [...options].sort((a, b) => used(b) - used(a) || a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
