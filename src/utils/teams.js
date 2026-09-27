/** Fixed teams — matches your Excel sheet groups. */
export const TEAMS = ['Admin', 'Management', 'Engineers', 'Sales', 'Application']

/**
 * Fixed "Fill all" shortcuts, the same for every team — deliberately not
 * derived from Admin's locations list, so this stays exactly these 5
 * regardless of how many locations get added there over time.
 */
export const STANDARD_QUICK_FILLS = ['Cass Office', 'Remote Support', 'Annual Leave', 'Non-Working Days', 'Work from Home']

export const TEAM_CONFIG = {
  Admin: {
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Usually at Cass Office — change any day that differs.',
    color: '#fef9c3',
  },
  Management: {
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Often travelling — set each day’s location.',
    color: '#dcfce7',
  },
  Engineers: {
    defaultLocation: 'Cass Office',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Mix of office, remote and sites — update daily.',
    color: '#ffedd5',
  },
  Sales: {
    defaultLocation: '',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Locations change often — pick where you’ll be each day.',
    color: '#e0e7ff',
  },
  Application: {
    defaultLocation: '',
    quickFills: STANDARD_QUICK_FILLS,
    hint: 'Locations change often — pick where you’ll be each day.',
    color: '#f3e8ff',
  },
}

export function getTeamConfig(team) {
  return TEAM_CONFIG[team] || null
}

export function defaultLocationForTeam(team) {
  const cfg = getTeamConfig(team)
  if (cfg) return cfg.defaultLocation
  return 'Cass Office'
}

export function quickFillsForTeam(team) {
  return getTeamConfig(team)?.quickFills || STANDARD_QUICK_FILLS
}
