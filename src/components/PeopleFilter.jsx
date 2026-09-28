import { Search } from 'lucide-react'
import { Tag } from './ui'

/**
 * Search by name plus team tags. No team selected means everyone; tapping
 * teams narrows to just those (several at once is fine).
 */
export default function PeopleFilter({ query, onQuery, teams, selected, onChange }) {
  function toggle(team) {
    onChange(selected.includes(team) ? selected.filter(t => t !== team) : [...selected, team])
  }
  return (
    <div className="people-filter">
      <label className="search-input">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search person"
          aria-label="Search person"
          onChange={e => onQuery(e.target.value)}
        />
      </label>
      <div className="tag-row" data-no-ptr>
        <Tag selected={!selected.length} onClick={() => onChange([])}>All</Tag>
        {teams.map(t => (
          <Tag key={t.team} selected={selected.includes(t.team)} onClick={() => toggle(t.team)}>{t.label}</Tag>
        ))}
      </div>
    </div>
  )
}

/** Applies a PeopleFilter's search + team selection to a user list. */
export function filterPeople(users, names, query, teams) {
  const q = query.trim().toLowerCase()
  return users.filter(u =>
    (!teams.length || teams.includes(u.team || '')) &&
    (!q || (names.get(u.uid) || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q))
  )
}
