/** Fixed teams — matches your Excel sheet groups. */
export const TEAMS = ['Admin', 'Management', 'Engineers', 'Sales', 'Application']

/**
 * Fixed "Fill all" shortcuts, the same for every team — deliberately not
 * derived from Admin's locations list, so this stays exactly these 5
 * regardless of how many locations get added there over time.
 */
export const STANDARD_QUICK_FILLS = ['Cass Office', 'Remote Support', 'Annual Leave', 'Non-Working Days', 'Work from Home']

// `color` is each team's band colour from the Excel schedule.
export const TEAM_CONFIG = {
  Admin: {
    label: 'Admin',
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Usually at Cass Office — change any day that differs.',
    color: '#FFF2CC',
  },
  Management: {
    label: 'Management',
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Often travelling — set each day’s location.',
    color: '#E2EFDA',
  },
  Engineers: {
    label: 'Engineers',
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Mix of office, remote and sites — update daily.',
    color: '#FCE4D6',
  },
  Sales: {
    label: 'Sales',
    defaultLocation: '',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Locations change often — pick where you’ll be each day.',
    color: '#DDEBF7',
  },
  Application: {
    label: 'Applications',
    defaultLocation: '',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Locations change often — pick where you’ll be each day.',
    color: '#D9D9D9',
  },
}

export function getTeamConfig(team) {
  return TEAM_CONFIG[team] || null
}

/** Display name for a team — stored values stay as-is ("Application"), labels match Excel. */
export function teamLabel(team) {
  return TEAM_CONFIG[team]?.label || team || 'No team'
}

export function defaultLocationForTeam(team) {
  const cfg = getTeamConfig(team)
  if (cfg) return cfg.defaultLocation
  return 'Cass Office'
}

export function quickFillsForTeam(team) {
  return getTeamConfig(team)?.quickFills || STANDARD_QUICK_FILLS
}

/** Teams in Excel order, then any others alphabetically, then people with no team. */
export function groupByTeam(users) {
  const present = new Set(users.map(u => u.team || ''))
  const extra = [...present].filter(t => t && !TEAMS.includes(t)).sort()
  const order = [...TEAMS.filter(t => present.has(t)), ...extra, ...(present.has('') ? [''] : [])]
  return order.map(team => ({
    team,
    label: teamLabel(team || null),
    band: getTeamConfig(team)?.color || '#f4f4f5',
    members: users.filter(u => (u.team || '') === team),
  }))
}
