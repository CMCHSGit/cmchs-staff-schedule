import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, weekLabel } from '../utils/week'
import { TEAMS, getTeamConfig } from '../utils/teams'
import { locClass } from '../utils/locationColor'
import WeekNav from '../components/WeekNav'

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MAX_WEEKS_AHEAD = 2
const MAX_WEEKS_BACK  = 4

export default function TeamView() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const myTeam = profile?.team

  const [weekOffset, setWeekOffset] = useState(0)
  const [schedules,  setSchedules]  = useState([])
  const [users,      setUsers]      = useState([])
  const [teamFilter, setTeamFilter] = useState(isAdmin ? 'All' : (myTeam || 'All'))
  const [loading,    setLoading]    = useState(true)

  const weekStart = getCurrentWeekStart(weekOffset)

  useEffect(() => {
    if (!isAdmin && myTeam) setTeamFilter(myTeam)
  }, [isAdmin, myTeam])

  useEffect(() => {
    async function loadUsers() {
      const snap = await getDocs(collection(db, 'users'))
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
    }
    loadUsers()
  }, [])

  const loadSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const q = query(
        collection(db, 'schedules'),
        where('weekStart', '==', weekStart)
      )
      const snap = await getDocs(q)
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { loadSchedules() }, [loadSchedules])

  const schedMap = Object.fromEntries(schedules.map(s => [s.uid, s]))

  const teamsInUse = Array.from(new Set(users.map(u => u.team).filter(Boolean)))
  const orderedTeams = TEAMS.filter(t => teamsInUse.includes(t))
  const extraTeams = teamsInUse.filter(t => !TEAMS.includes(t)).sort()
  const filterTeams = ['All', ...orderedTeams, ...extraTeams]

  const filteredUsers = teamFilter === 'All'
    ? users
    : users.filter(u => u.team === teamFilter)

  const pendingCount = filteredUsers.filter(u => !schedMap[u.uid]).length

  const groupsToShow = teamFilter === 'All'
    ? [...orderedTeams, ...extraTeams]
    : [teamFilter]

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Team view</div>
          <div className="topbar-sub">
            {myTeam && !isAdmin ? `${myTeam} team` : 'All teams'}
            {' · '}
            {pendingCount > 0
              ? `${pendingCount} not yet submitted`
              : 'Everyone submitted ✓'}
          </div>
        </div>
      </div>

      <WeekNav
        label={weekLabel(weekStart)}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        canPrev={weekOffset > -MAX_WEEKS_BACK}
        canNext={weekOffset < MAX_WEEKS_AHEAD}
      />

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', flexWrap: 'wrap' }}>
        {filterTeams.map(t => (
          <button
            key={t}
            className="btn btn-sm"
            style={teamFilter === t ? { background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' } : {}}
            onClick={() => setTeamFilter(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div style={{ overflowX: 'auto', padding: '0 16px 16px' }}>
          <table className="team-table">
            <thead>
              <tr>
                <th className="team-th-name">Name</th>
                {DAY_SHORT.map(d => (
                  <th key={d} className="team-th-day">{d}</th>
                ))}
                <th className="team-th-notes">Notes</th>
              </tr>
            </thead>
            <tbody>
              {groupsToShow.map(team => {
                const members = filteredUsers.filter(u => u.team === team)
                if (!members.length) return null
                const cfg = getTeamConfig(team)
                return [
                  <tr key={`header-${team}`}>
                    <td
                      colSpan={7}
                      className="team-group-header"
                      style={{ background: cfg?.color || 'var(--bg-2)' }}
                    >
                      {team}
                    </td>
                  </tr>,
                  ...members.map(u => (
                    <UserRow key={u.uid} user={u} schedule={schedMap[u.uid]} />
                  )),
                ]
              })}
              {teamFilter === 'All' && filteredUsers.filter(u => !u.team).map(u => (
                <UserRow key={u.uid} user={u} schedule={schedMap[u.uid]} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function dayLocation(d) {
  if (!d) return ''
  if (d.location) return d.location
  const am = d.am || ''
  const pm = d.pm || ''
  if (am && pm && am !== pm) return am
  return am || pm || ''
}

/** Combines location + on-call into one display label, e.g. "Cass Office / On Call". */
function dayLabel(d) {
  const loc = dayLocation(d)
  if (!d?.onCall) return loc
  return loc ? `${loc} / On Call` : 'On Call'
}

function UserRow({ user, schedule }) {
  const notes = schedule?.comments?.trim()
  return (
    <tr className="team-row">
      <td className="team-td-name">
        {user.displayName?.split(' ')[0] || user.email}
      </td>
      {schedule
        ? schedule.days.map((d, i) => (
            <td key={i} className="team-td-day">
              <LocCell day={d} />
            </td>
          ))
        : Array(5).fill(null).map((_, i) => (
            <td key={i} className="team-td-day">
              <span className="loc loc-blank">—</span>
            </td>
          ))
      }
      <td className="team-td-notes">
        {notes ? (
          <span className="team-notes" title={notes}>{notes}</span>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>—</span>
        )}
      </td>
    </tr>
  )
}

function LocCell({ day }) {
  const label = dayLabel(day)
  const cls = locClass(day?.onCall ? `${dayLocation(day)} on call` : dayLocation(day))
  return <span className={`loc ${cls}`} title={label}>{abbrev(label)}</span>
}

function abbrev(val) {
  if (!val) return '—'
  if (val.length <= 8) return val
  return val.split(/[\s\/]/).map(w => w[0]).join('').toUpperCase().slice(0, 4)
}
