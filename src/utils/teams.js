/** Fixed teams — matches your Excel sheet groups. */
export const TEAMS = ['Admin', 'Management', 'Engineers', 'Sales', 'Application']

export const TEAM_CONFIG = {
  Admin: {
    defaultLocation: 'Cass Office',
    quickFills: ['Cass Office', 'Remote Support', 'Work from Home', 'Leave', 'Non Working Days'],
    hint: 'Usually at Cass Office — change any day that differs.',
    color: '#fef9c3',
  },
  Management: {
    defaultLocation: 'Cass Office',
    quickFills: ['Cass Office', 'Auckland', 'Whanganui', 'Tauranga', 'Hawkes Bay', 'Leave', 'Non Working Days'],
    hint: 'Often travelling — set each day’s location.',
    color: '#dcfce7',
  },
  Engineers: {
    defaultLocation: 'Cass Office',
    quickFills: ['Cass Office', 'Remote Support', 'Leave', 'Non Working Days', 'Work from Home'],
    hint: 'Mix of office, remote and sites — update daily.',
    color: '#ffedd5',
  },
  Sales: {
    defaultLocation: '',
    quickFills: ['Auckland', 'Whanganui', 'Tauranga', 'Hawkes Bay', 'Cass Office', 'Remote Support', 'Leave'],
    hint: 'Locations change often — pick where you’ll be each day.',
    color: '#e0e7ff',
  },
  Application: {
    defaultLocation: '',
    quickFills: ['Auckland', 'Whanganui', 'Tauranga', 'Cass Office', 'Remote Support', 'Leave', 'Non Working Days'],
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

export function quickFillsForTeam(team, locationNames = []) {
  const cfg = getTeamConfig(team)
  const preset = cfg?.quickFills || ['Cass Office', 'Remote Support', 'Leave']
  return [...new Set([...preset, ...locationNames])]
}
