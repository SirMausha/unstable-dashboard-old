import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from './api'
import { assessMember } from './assess'
import { StaffTournaments } from './StaffTournaments'
import { MemberProfileModal } from './MemberProfile'
import { TourneyPage } from './TourneyPage'
import type { Applicant, Assignment, Band, BlacklistEntry, Club, DashboardState, Member, MemberDirectoryRow, PublicData, Status } from './types'
import './App.css'

const number = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const statusOptions: Status[] = ['pending', 'approved', 'waitlisted', 'rejected']
const rankGradeOptions = [
  { value: 'ss', label: 'SS' },
  { value: 'splus', label: 'S+' },
  { value: 's', label: 'S' },
  { value: 'aplus', label: 'A+' },
  { value: 'a', label: 'A' },
  { value: 'bplus', label: 'B+' },
  { value: 'b', label: 'B' },
] as const

function rankGradeLabel(grade?: string | null) {
  return rankGradeOptions.find((option) => option.value === grade)?.label || grade || 'Unset'
}

function Freshness({ date }: { date?: string | null }) {
  if (!date) return <span className="freshness stale">Not synced</span>
  const hours = Math.max(0, (Date.now() - new Date(date).getTime()) / 3_600_000)
  return <span className={`freshness ${hours > 24 ? 'stale' : ''}`}>{hours < 1 ? 'Updated recently' : `Updated ${Math.floor(hours)}h ago`}</span>
}

function ClubRankBadge({ grade }: { grade?: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!grade) return null
  const src = `${import.meta.env.BASE_URL}club-ranks/${grade}.webp`
  if (!failed) {
    return <img
      className="club-rank-image"
      src={src}
      alt={`Club rank ${grade}`}
      width={56}
      height={56}
      onError={() => setFailed(true)}
    />
  }
  return <span className={`club-rank-fallback grade-${grade.toLowerCase()}`} aria-label={`Club rank ${grade}`}>{grade}</span>
}

function RankDelta({ delta }: { delta?: number | null }) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) {
    return <span className="rank-delta flat">—</span>
  }
  if (delta > 0) return <span className="rank-delta up" title="Positions gained today">▲ {delta}</span>
  return <span className="rank-delta down" title="Positions lost today">▼ {Math.abs(delta)}</span>
}

function ClubOverviewCard({ club }: { club: Club & { members?: Member[] } }) {
  const memberCount = club.members?.length ?? 0
  return <article className="club-card">
    <div className="club-card-top">
      <div className="club-card-heading">
        <p className="eyebrow club-live-rank">
          Rank {club.rank != null ? `#${club.rank}` : 'unavailable'}
          <RankDelta delta={club.rankDelta} />
        </p>
        <h2>{club.name}</h2>
        <p className="club-id">ID: {club.circleId}</p>
      </div>
      <ClubRankBadge key={club.rankGrade || 'none'} grade={club.rankGrade} />
    </div>
    <div className="club-card-stats">
      <div>
        <span>Fans this month</span>
        <strong>{club.monthlyFans != null ? number.format(club.monthlyFans) : '—'}</strong>
      </div>
      <div>
        <span>Since yesterday</span>
        <strong className={club.fansSinceYesterday != null && club.fansSinceYesterday > 0 ? 'gain' : ''}>
          {club.fansSinceYesterday != null
            ? `${club.fansSinceYesterday >= 0 ? '+' : ''}${number.format(club.fansSinceYesterday)}`
            : '—'}
        </strong>
      </div>
      <div>
        <span>Requirement</span>
        <strong className="requirement">{compact.format(club.dailyTarget)}<small>/mem/day</small></strong>
      </div>
    </div>
    <div className="club-band">
      <span>{memberCount}/30 members</span>
      <Freshness date={club.sourceUpdatedAt} />
    </div>
  </article>
}

const bandOptions: Array<{ value: Band | 'all'; label: string }> = [
  { value: 'all', label: 'All assessments' },
  { value: 'promotion', label: 'Promotion candidate' },
  { value: 'meeting', label: 'Meeting target' },
  { value: 'under', label: 'Under target' },
  { value: 'severe', label: 'Severely under' },
  { value: 'inactive', label: 'Inactive' },
]

function BandBadge({ band, reason, compact = false }: { band?: Band | null; reason?: string | null; compact?: boolean }) {
  const labels: Record<Band, string> = {
    promotion: 'Promotion candidate', meeting: 'Meeting target', under: 'Under target',
    severe: 'Severely under', inactive: 'Inactive',
  }
  const short: Record<Band, string> = {
    promotion: 'Promo', meeting: 'Meeting', under: 'Under', severe: 'Severe', inactive: 'Inactive',
  }
  if (!band || !(band in labels)) {
    return <span className={`badge band-inactive ${compact ? 'badge-compact' : ''}`} title={reason || 'No assessment yet'}>
      {compact ? '—' : <>Unassessed<small>{reason || 'Refresh data to classify'}</small></>}
    </span>
  }
  return <span className={`badge band-${band} ${compact ? 'badge-compact' : ''}`} title={reason || ''}>
    {compact ? short[band] : <>{labels[band]}<small>{reason}</small></>}
  </span>
}

function Header({ children, publicMode = false }: { children?: ReactNode; publicMode?: boolean }) {
  return <header className="site-header">
    <div>
      <p className="eyebrow">{publicMode ? 'Dust · Dirt · Damp' : 'Local management workspace'}</p>
      <h1>{publicMode ? 'Bunny clubs' : 'Club operations'}</h1>
      {publicMode ? (
        <p className="lede">A cozy look at how our clubs are doing — ranks, fans, and who’s applying next.</p>
      ) : null}
    </div>
    {children}
  </header>
}

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to: string) => {
    if (to === path) return
    window.history.pushState({}, '', to)
    setPath(to)
  }
  return { path, navigate }
}

function SiteNav({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  return <nav className="tabs public-nav" aria-label="Site sections">
    <button type="button" className={path === '/' ? 'active' : ''} onClick={() => navigate('/')}>Overview</button>
    <button type="button" className={path.startsWith('/apply') ? 'active' : ''} onClick={() => navigate('/apply')}>Apply</button>
  </nav>
}

function ClubSummary({ clubs }: { clubs: Array<Club & { members?: Member[] }> }) {
  const chart = clubs.map((club) => {
    const members = club.members || []
    return {
      name: club.name,
      average: members.length ? Math.round(members.reduce((sum, member) => sum + member.dailyAverage, 0) / members.length) : 0,
      target: club.dailyTarget,
    }
  })
  return <section className="panel chart-panel">
    <div className="section-heading"><div><p className="eyebrow">Cross-club comparison</p><h2>Average daily fans</h2></div><p>Club average against each configured member requirement.</p></div>
    <div className="chart" role="img" aria-label="Average daily fans by club">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chart}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" /><YAxis tickFormatter={(value) => compact.format(value)} />
          <Tooltip formatter={(value) => number.format(Number(value))} /><Legend />
          <Bar dataKey="average" name="Member average (fans/day)" fill="var(--accent)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="target" name="Requirement (fans/day)" fill="var(--muted-chart)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </section>
}

function TrendChart({
  label,
  dailyGains,
  height = 54,
  className = 'mini-chart',
}: {
  label: string
  dailyGains?: number[] | null
  height?: number
  className?: string
}) {
  const gains = Array.isArray(dailyGains) ? dailyGains : []
  const data = gains.map((fans, index) => ({ day: index + 1, fans }))
  if (!data.length) return <span className="muted">No 30-day history available</span>
  return <div className={className} aria-label={`${label} 30-day fan history`}>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
        <XAxis dataKey="day" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          formatter={(value) => number.format(Number(value))}
          labelFormatter={(day) => `Day ${day}`}
        />
        <Line type="monotone" dataKey="fans" name="Fans gained" stroke="var(--accent)" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  </div>
}

function planStatusLabel(
  member: Member,
  assignments: Assignment[],
  clubById: Map<string, Club>,
) {
  const assignment = assignments.find((item) => item.entityType === 'member' && item.entityId === member.umaId)
  if (!assignment) return null
  const home = member.circleId || ''
  const destination = assignment.destination === 'unassigned' ? 'applicants' : assignment.destination
  if (!destination || destination === home) return null
  if (destination === 'kick') return { kind: 'kick' as const, label: 'Kick / remove' }
  if (destination === 'waitlist') return { kind: 'waitlist' as const, label: 'Waitlist' }
  if (destination === 'applicants') return { kind: 'applicant' as const, label: 'To applicants' }
  const clubName = clubById.get(destination)?.name || destination
  return { kind: 'move' as const, label: `Moving to ${clubName}` }
}

function DiscordIdField({
  umaId,
  value,
  onSave,
}: {
  umaId: string
  value: string
  onSave: (umaId: string, discordId: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(value) }, [value, umaId])
  const save = async () => {
    const next = draft.trim()
    if (next === (value || '').trim()) return
    setBusy(true)
    try {
      await onSave(umaId, next || null)
    } catch (reason) {
      setDraft(value)
      alert((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return <input
    className="discord-id-input"
    inputMode="numeric"
    placeholder="Discord ID"
    aria-label={`Discord ID for ${umaId}`}
    value={draft}
    disabled={busy}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { void save() }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void save()
      }
    }}
  />
}

function MemberTable({
  clubs,
  members: supplied,
  assignments = [],
  onSaveDiscord,
  directory = [],
  onOpenProfile,
}: {
  clubs: Club[]
  members?: Member[]
  assignments?: Assignment[]
  onSaveDiscord?: (umaId: string, discordId: string | null) => Promise<void>
  directory?: MemberDirectoryRow[]
  onOpenProfile?: (umaId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [clubFilter, setClubFilter] = useState('all')
  const [bandFilter, setBandFilter] = useState<Band | 'all'>('all')
  const [rosterFilter, setRosterFilter] = useState<'current' | 'former' | 'all'>('current')
  const [sort, setSort] = useState<'dailyAverage' | 'monthlyGain' | 'todayGain'>('dailyAverage')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const clubById = new Map(clubs.map((club) => [club.circleId, club]))
  const live = (supplied || clubs.flatMap((club) => (club.members || []).map((member) => ({ ...member, circleId: club.circleId }))))
    .map((member) => {
      const club = clubById.get(member.circleId || '')
      if (!club) return member
      const assessed = assessMember({
        dailyAverage: member.dailyAverage,
        dailyTarget: club.dailyTarget,
        lastUpdatedAt: member.lastUpdatedAt,
        promotionRatio: club.promotionRatio,
        severeRatio: club.severeRatio,
        inactiveDays: club.inactiveDays,
        promotionEnabled: club.promotionEnabled !== false,
      })
      return { ...member, band: assessed.band, reason: assessed.reason, former: false }
    })
  const liveIds = new Set(live.map((member) => member.umaId))
  const alumni: Member[] = directory
    .filter((row) => row.status === 'former' && !liveIds.has(row.umaId))
    .map((row) => ({
      umaId: row.umaId,
      ign: row.ign,
      circleId: row.lastCircleId || row.currentCircleId || undefined,
      lastUpdatedAt: row.lastSeenOn,
      totalFans: 0,
      monthlyGain: 0,
      dailyAverage: 0,
      todayGain: 0,
      dailyGains: [],
      band: 'inactive' as Band,
      reason: 'Former Bunny club member',
      discordId: row.discordId,
      former: true,
      observedDays: row.observedDays,
      firstSeenOn: row.firstSeenOn,
      lastSeenOn: row.lastSeenOn,
    }))
  const members = rosterFilter === 'former' ? alumni : rosterFilter === 'all' ? [...live, ...alumni] : live
  const promotionAvailable = clubFilter === 'all'
    ? clubs.some((club) => club.promotionEnabled !== false)
    : clubById.get(clubFilter)?.promotionEnabled !== false
  const visibleBandOptions = bandOptions.filter((option) => option.value !== 'promotion' || promotionAvailable)
  const filtered = [...members]
    .filter((member) => clubFilter === 'all' || member.circleId === clubFilter)
    .filter((member) => bandFilter === 'all' || member.band === bandFilter)
    .filter((member) => member.ign.toLowerCase().includes(query.toLowerCase()) || member.umaId.includes(query) || (member.discordId || '').includes(query))
    .sort((a, b) => b[sort] - a[sort])
  const bandCounts = members.reduce<Record<string, number>>((counts, member) => {
    if (clubFilter !== 'all' && member.circleId !== clubFilter) return counts
    counts[member.band] = (counts[member.band] || 0) + 1
    return counts
  }, {})
  return <section className="panel">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Decision support</p>
        <h2>Member comparison</h2>
        <p>{filtered.length} of {members.length} members shown{!promotionAvailable && clubFilter !== 'all' ? ' · promotion assessments disabled for this club' : ''}</p>
      </div>
      <div className="filters">
        <div className="view-toggle" role="group" aria-label="Member layout">
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Grid</button>
        </div>
        {onOpenProfile ? (
          <select aria-label="Current or former members" value={rosterFilter} onChange={(event) => setRosterFilter(event.target.value as typeof rosterFilter)}>
            <option value="current">Current members</option>
            <option value="former">Former members ({alumni.length})</option>
            <option value="all">Current + former</option>
          </select>
        ) : null}
        <input aria-label="Search members" placeholder="Search IGN or Uma ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Filter by club" value={clubFilter} onChange={(event) => {
          const nextClub = event.target.value
          setClubFilter(nextClub)
          const nextAllowsPromotion = nextClub === 'all'
            ? clubs.some((club) => club.promotionEnabled !== false)
            : clubById.get(nextClub)?.promotionEnabled !== false
          if (!nextAllowsPromotion && bandFilter === 'promotion') setBandFilter('all')
        }}>
          <option value="all">All clubs</option>
          {clubs.map((club) => <option key={club.circleId} value={club.circleId}>{club.name}</option>)}
        </select>
        <select aria-label="Filter by assessment" value={bandFilter} onChange={(event) => setBandFilter(event.target.value as Band | 'all')}>
          {visibleBandOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === 'all' ? option.label : `${option.label} (${bandCounts[option.value] || 0})`}
            </option>
          ))}
        </select>
        <select aria-label="Sort members" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="dailyAverage">Daily average</option><option value="monthlyGain">Monthly gain</option><option value="todayGain">Today</option>
        </select>
      </div>
    </div>
    <div className="band-filter-row" role="group" aria-label="Quick assessment filters">
      {visibleBandOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`band-chip ${bandFilter === option.value ? 'active' : ''} ${option.value !== 'all' ? `chip-${option.value}` : ''}`}
          onClick={() => setBandFilter(option.value)}
        >
          {option.label}
          <span>{option.value === 'all' ? (clubFilter === 'all' ? members.length : members.filter((member) => member.circleId === clubFilter).length) : (bandCounts[option.value] || 0)}</span>
        </button>
      ))}
    </div>
    {view === 'grid' ? (
      filtered.length === 0 ? (
        <p className="empty-row">No members match these filters.</p>
      ) : (
        <div className="member-grid">
          {filtered.map((member) => {
            const plan = planStatusLabel(member, assignments, clubById)
            return <article key={`${member.circleId}:${member.umaId}`} className="member-card">
              <div className="member-card-top">
                <strong>
                  {onOpenProfile ? (
                    <button type="button" className="name-link" onClick={() => onOpenProfile(member.umaId)}>{member.ign}</button>
                  ) : member.ign}
                </strong>
                {member.former ? <small className="id">Former</small> : null}
                <BandBadge band={member.band} reason={member.reason} compact />
              </div>
              <span className="member-card-club">{clubById.get(member.circleId || '')?.name || '—'}</span>
              {onSaveDiscord ? (
                <DiscordIdField
                  umaId={member.umaId}
                  value={member.discordId || ''}
                  onSave={onSaveDiscord}
                />
              ) : member.discordId ? (
                <span className="id">{member.discordId}</span>
              ) : null}
              <div className="member-card-stats">
                <span><small>Daily</small>{compact.format(member.dailyAverage)}</span>
                <span><small>Month</small>{compact.format(member.monthlyGain)}</span>
                <span><small>Today</small>+{compact.format(member.todayGain)}</span>
              </div>
              <TrendChart label={member.ign} dailyGains={member.dailyGains} height={42} className="member-card-chart" />
              {plan ? <span className={`plan-status plan-${plan.kind}`}>{plan.label}</span> : null}
            </article>
          })}
        </div>
      )
    ) : (
      <div className="table-scroll"><table>
        <thead><tr><th>Trainer</th><th>Club</th>{onSaveDiscord ? <th>Discord ID</th> : null}{onOpenProfile ? <th>Tenure</th> : null}<th>Monthly</th><th>Daily avg</th><th>Today</th><th>Trend</th><th>Assessment</th><th>Plan</th></tr></thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={8 + (onSaveDiscord ? 1 : 0) + (onOpenProfile ? 1 : 0)} className="empty-row">No members match these filters.</td></tr>
          ) : filtered.map((member) => {
            const plan = planStatusLabel(member, assignments, clubById)
            const tracked = directory.find((row) => row.umaId === member.umaId)
            return <tr key={`${member.circleId}:${member.umaId}`}>
              <td>
                <strong>
                  {onOpenProfile ? (
                    <button type="button" className="name-link" onClick={() => onOpenProfile(member.umaId)}>{member.ign}</button>
                  ) : member.ign}
                </strong>
                <small className="id">{member.umaId}{member.former ? ' · former' : ''}</small>
              </td>
              <td>{clubById.get(member.circleId || '')?.name || '—'}</td>
              {onSaveDiscord ? (
                <td>
                  <DiscordIdField
                    umaId={member.umaId}
                    value={member.discordId || ''}
                    onSave={onSaveDiscord}
                  />
                </td>
              ) : null}
              {onOpenProfile ? (
                <td>
                  {tracked
                    ? `${tracked.observedDays}d tracked`
                    : member.former ? `${member.observedDays || 0}d` : '—'}
                </td>
              ) : null}
              <td>{number.format(member.monthlyGain)}</td><td>{number.format(member.dailyAverage)}</td><td>+{number.format(member.todayGain)}</td>
              <td><TrendChart label={member.ign} dailyGains={member.dailyGains} /></td>
              <td><BandBadge band={member.band} reason={member.reason} /></td>
              <td>{plan ? <span className={`plan-status plan-${plan.kind}`}>{plan.label}</span> : <span className="muted">—</span>}</td>
            </tr>
          })}
        </tbody>
      </table></div>
    )}
  </section>
}

function PublicApplicants({ applicants, clubs }: { applicants: Applicant[]; clubs: Club[] }) {
  const names = new Map(clubs.map((club) => [club.circleId, club.name]))
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">Recruitment</p><h2>Applicants</h2></div><p>Application status and public uma.moe performance.</p></div>
    <div className="table-scroll"><table>
      <thead><tr><th>Trainer</th><th>Applying to</th><th>Status</th><th>Current club</th><th>Monthly</th><th>Daily avg</th></tr></thead>
      <tbody>{applicants.map((applicant) => <tr key={applicant.umaId}>
        <td><a href={`https://uma.moe/profile/${applicant.umaId}`} target="_blank" rel="noreferrer"><strong>{applicant.ign}</strong></a><small className="id">{applicant.umaId}</small></td>
        <td>{names.get(applicant.targetClubId) || applicant.targetClubId}</td><td><span className={`status status-${applicant.status}`}>{applicant.status}</span></td>
        <td>{applicant.currentClubName || 'Unattached'}</td><td>{number.format(applicant.monthlyGain)}</td><td>{number.format(applicant.dailyAverage)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

function loadPublicDashboard(): Promise<PublicData> {
  if (import.meta.env.VITE_PUBLIC_ONLY === 'true') {
    return fetch(`${import.meta.env.BASE_URL}data/dashboard.json`).then(async (response) => {
      if (response.ok) return response.json() as Promise<PublicData>
      throw new Error(
        `Could not load ${import.meta.env.BASE_URL}data/dashboard.json (${response.status}). ` +
          'Run the GitHub Actions deploy workflow so it generates public dashboard data.',
      )
    })
  }
  return api.publicDashboard()
}

function OverviewBody({ data }: { data: PublicData }) {
  return <>
    <section className="club-grid">{data.clubs.map((club) => <ClubOverviewCard key={club.circleId} club={club} />)}</section>
    <ClubSummary clubs={data.clubs} />
    <MemberTable clubs={data.clubs} />
    <PublicApplicants applicants={data.applicants} clubs={data.clubs} />
  </>
}

function ApplyBody({ clubs }: { clubs: Array<Club & { members?: Member[] }> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selectedClubId, setSelectedClubId] = useState(clubs[0]?.circleId || '')
  const selectedClub = clubs.find((club) => club.circleId === selectedClubId)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api.submitApplication({
        umaId: String(form.get('umaId') || '').trim(),
        discordUsername: String(form.get('discordUsername') || '').trim(),
        targetClubId: selectedClubId,
        notes: String(form.get('notes') || ''),
      })
      setMessage('Application received. Managers will review it privately.')
      formEl.reset()
      setSelectedClubId(clubs[0]?.circleId || '')
    } catch (reason) {
      const text = (reason as Error).message || 'Could not submit the application.'
      if (/reading ['"]reset['"]/i.test(text)) {
        setMessage('Application received. Managers will review it privately.')
      } else {
        setError(text)
      }
    } finally {
      setBusy(false)
    }
  }

  return <section className="apply-page">
    <header className="apply-intro">
      <p className="eyebrow">Recruitment</p>
      <h2>Apply to a Bunny club</h2>
      <p className="muted">Pick a club on the left, then send your Uma ID and Discord username. Managers review applications privately.</p>
    </header>

    <div className="apply-layout">
      <aside className="apply-clubs" aria-label="Choose a club">
        {clubs.map((club) => {
          const memberCount = club.members?.length ?? 0
          const selected = selectedClubId === club.circleId
          return <button
            key={club.circleId}
            type="button"
            className={`apply-club-pick ${selected ? 'selected' : ''}`}
            onClick={() => setSelectedClubId(club.circleId)}
            aria-pressed={selected}
          >
            <div className="apply-club-copy">
              <div className="apply-club-title-row">
                <strong>{club.name}</strong>
                <span className="apply-club-rank">
                  {club.rank != null ? `#${club.rank}` : '—'}
                  <RankDelta delta={club.rankDelta} />
                </span>
              </div>
              <dl className="apply-club-meta">
                <div>
                  <dt>Requirement</dt>
                  <dd>{compact.format(club.dailyTarget)}/day</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{memberCount}/30</dd>
                </div>
                <div>
                  <dt>This month</dt>
                  <dd>{club.monthlyFans != null ? compact.format(club.monthlyFans) : '—'}</dd>
                </div>
              </dl>
            </div>
            <ClubRankBadge key={club.rankGrade || 'none'} grade={club.rankGrade} />
          </button>
        })}
      </aside>

      <section className="panel form-stack apply-form">
        <div>
          <p className="eyebrow">Your application</p>
          <h2>Apply to {selectedClub?.name || 'a club'}</h2>
          <p className="muted">Discord details stay off the public overview.</p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <div className="field-row">
            <label>Uma ID<input name="umaId" inputMode="numeric" pattern="\d+" required placeholder="123456789" /></label>
            <label>Discord username<input name="discordUsername" required minLength={2} maxLength={64} placeholder="name or name#0000" /></label>
          </div>
          <label>Notes for managers<textarea name="notes" rows={5} maxLength={2000} placeholder="Optional — availability, current club, anything managers should know" /></label>
          <div className="button-row">
            <button className="primary" disabled={busy || !selectedClubId}>
              {busy ? 'Submitting…' : `Submit to ${selectedClub?.name || 'club'}`}
            </button>
          </div>
        </form>
        {message && <p className="notice">{message}</p>}
        {error && <p className="notice error">{error}</p>}
      </section>
    </div>
  </section>
}

function PublicSite({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  const [data, setData] = useState<PublicData | null>(null)
  const [error, setError] = useState('')
  const pagesOnly = import.meta.env.VITE_PUBLIC_ONLY === 'true'
  const isApply = !pagesOnly && path.startsWith('/apply')

  useEffect(() => {
    let cancelled = false
    loadPublicDashboard()
      .then((payload) => { if (!cancelled) setData(payload) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [])

  if (error) return <main className="center-message"><h1>Bunny clubs</h1><p>{error}</p></main>
  if (!data) return <main className="center-message"><h1>Bunny clubs</h1><p>Gathering the latest club vibes…</p></main>

  return <main className="shell">
    <Header publicMode>
      <div className="button-row">
        <Freshness date={data.generatedAt} />
        {!pagesOnly && !isApply && (
          <button type="button" className="primary" onClick={() => navigate('/apply')}>Apply to a club</button>
        )}
      </div>
    </Header>
    {!pagesOnly && <SiteNav path={isApply ? '/apply' : '/'} navigate={navigate} />}
    {isApply ? <ApplyBody clubs={data.clubs} /> : <OverviewBody data={data} />}
    <footer>Source: uma.moe · Updated {new Date(data.generatedAt).toLocaleString()}</footer>
  </main>
}

function PublicDashboard({ navigate }: { navigate: (to: string) => void }) {
  return <PublicSite path="/" navigate={navigate} />
}

function StaffApplicants({
  applicants,
  clubs,
  reload,
}: {
  applicants: Applicant[]
  clubs: Array<{ circleId: string; name: string }>
  reload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Applicant | null>(null)
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('pending')
  const clubNames = new Map(clubs.map((club) => [club.circleId, club.name]))
  const statusCounts = applicants.reduce<Record<string, number>>((counts, applicant) => {
    counts[applicant.status] = (counts[applicant.status] || 0) + 1
    return counts
  }, {})
  const filtered = applicants.filter((applicant) => statusFilter === 'all' || applicant.status === statusFilter)
  const setStatus = async (applicant: Applicant, status: Status) => {
    await api.staffUpdateApplicant(applicant.umaId, { status })
    await reload()
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)
    const body = {
      umaId: String(form.get('umaId')),
      discordUsername: String(form.get('discordUsername') || ''),
      targetClubId: String(form.get('targetClubId')),
      status: String(form.get('status')),
      privateNotes: String(form.get('privateNotes') || ''),
      publishPublicly: form.get('publishPublicly') === 'on',
    }
    if (editing) {
      await api.staffUpdateApplicant(editing.umaId, {
        ...body,
        refresh: true,
      })
    } else {
      await api.staffAddApplicant(body)
    }
    setEditing(null)
    formEl.reset()
    await reload()
  }
  return <section className="split-layout applicants-layout">
    <form className="panel form-stack" onSubmit={submit} key={editing?.umaId || 'new-applicant'}>
      <div><p className="eyebrow">Intake</p><h2>{editing ? 'Edit applicant' : 'Add applicant'}</h2></div>
      <label>Uma ID<input name="umaId" inputMode="numeric" pattern="\d+" required readOnly={Boolean(editing)} defaultValue={editing?.umaId} /></label>
      <label>Discord username<input name="discordUsername" defaultValue={editing?.discordUsername || ''} /></label>
      <label>Applying to<select name="targetClubId" required defaultValue={editing?.targetClubId}><option value="">Select a club</option>{clubs.map((club) => <option key={club.circleId} value={club.circleId}>{club.name}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={editing?.status || 'pending'}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>Private notes<textarea name="privateNotes" rows={4} defaultValue={editing?.privateNotes} /></label>
      <label className="check"><input name="publishPublicly" type="checkbox" defaultChecked={editing?.publishPublicly ?? true} /> Show on public overview</label>
      <div className="button-row"><button className="primary">{editing ? 'Save applicant' : 'Resolve and add'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
    </form>
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recruitment</p>
          <h2>{filtered.length} applicants</h2>
          <p>{statusFilter === 'all' ? `${applicants.length} total` : `${statusCounts[statusFilter] || 0} ${statusFilter}`}</p>
        </div>
      </div>
      <div className="band-filter-row" role="group" aria-label="Filter applicants by status">
        <button type="button" className={`band-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          All<span>{applicants.length}</span>
        </button>
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            className={`band-chip status-chip status-${status} ${statusFilter === status ? 'active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {status}<span>{statusCounts[status] || 0}</span>
          </button>
        ))}
      </div>
      <div className="applicant-cards">{filtered.length === 0 ? (
        <p className="muted empty-applicants">No applicants in this status.</p>
      ) : filtered.map((applicant) => <article key={applicant.umaId}>
        <div><strong>{applicant.ign}</strong><small className="id">{applicant.umaId}</small></div>
        <span className={`status status-${applicant.status}`}>{applicant.status}</span>
        <dl>
          <div><dt>Discord</dt><dd>{applicant.discordUsername || '—'}</dd></div>
          <div><dt>Daily average</dt><dd>{number.format(applicant.dailyAverage)}</dd></div>
          <div><dt>Applying to</dt><dd>{clubNames.get(applicant.targetClubId) || applicant.targetClubId}</dd></div>
          <div><dt>Current club</dt><dd>{applicant.currentClubName || '—'}</dd></div>
          <div><dt>Monthly</dt><dd>{number.format(applicant.monthlyGain)}</dd></div>
        </dl>
        <div className="applicant-trend">
          <p className="trend-label">30-day fans</p>
          <TrendChart label={applicant.ign} dailyGains={applicant.dailyGains} height={96} className="applicant-chart" />
        </div>
        <p>{applicant.privateNotes || 'No private notes'}</p>
        <div className="button-row">
          {applicant.status !== 'approved' && (
            <button className="primary" onClick={async () => { await setStatus(applicant, 'approved') }}>Approve</button>
          )}
          {applicant.status !== 'waitlisted' && (
            <button onClick={async () => { await setStatus(applicant, 'waitlisted') }}>Waitlist</button>
          )}
          <button onClick={() => setEditing(applicant)}>Edit</button>
          <button className="danger-link" onClick={async () => { if (confirm(`Delete ${applicant.ign}?`)) { await api.staffDeleteApplicant(applicant.umaId); await reload() } }}>Delete</button>
        </div>
      </article>)}</div>
    </section>
  </section>
}

function StaffClubSettings({
  clubs,
  reload,
}: {
  clubs: Club[]
  reload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Club | null>(clubs[0] || null)
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    try {
      await api.staffUpdateClub(editing.circleId, {
        name: String(form.get('name')),
        dailyTarget: Number(form.get('dailyTarget')),
        promotionRatio: Number(form.get('promotionRatio')),
        severeRatio: Number(form.get('severeRatio')),
        inactiveDays: Number(form.get('inactiveDays')),
        promotionEnabled: form.get('promotionEnabled') === 'on',
        rankGrade: String(form.get('rankGrade') || '') || null,
      })
      setMessage(`Saved ${String(form.get('name'))}.`)
      await reload()
    } catch (reason) {
      setMessage((reason as Error).message)
    }
  }
  if (!clubs.length) {
    return <section className="panel"><p className="muted">No managed clubs in your ACL.</p></section>
  }
  const current = editing && clubs.find((club) => club.circleId === editing.circleId) || clubs[0]
  return <section className="split-layout">
    <form className="panel form-stack" onSubmit={submit} key={current.circleId}>
      <div><p className="eyebrow">Configuration</p><h2>Edit club settings</h2></div>
      <label>Club
        <select
          value={current.circleId}
          onChange={(event) => setEditing(clubs.find((club) => club.circleId === event.target.value) || null)}
        >
          {clubs.map((club) => <option key={club.circleId} value={club.circleId}>{club.name}</option>)}
        </select>
      </label>
      <label>Display name<input name="name" required defaultValue={current.name} /></label>
      <label>Club rank badge
        <select name="rankGrade" defaultValue={current.rankGrade || ''}>
          <option value="">No badge</option>
          {rankGradeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <p className="muted">Shown on the public overview card. Uses images from /club-ranks.</p>
      <label>Daily requirement<input name="dailyTarget" type="number" min="0" required defaultValue={current.dailyTarget} /></label>
      <div className="field-row">
        <label>Promotion ratio<input name="promotionRatio" type="number" min="1" step=".05" defaultValue={current.promotionRatio || 1.25} /></label>
        <label>Severe ratio<input name="severeRatio" type="number" min="0" max="1" step=".05" defaultValue={current.severeRatio || .5} /></label>
      </div>
      <label>Inactive after days<input name="inactiveDays" type="number" min="1" defaultValue={current.inactiveDays || 3} /></label>
      <label className="check"><input name="promotionEnabled" type="checkbox" defaultChecked={current.promotionEnabled ?? true} /> Enable promotion-candidate assessments for this club</label>
      <p className="muted">Turn this off for your main club where members cannot be promoted further.</p>
      <div className="button-row"><button className="primary">Save club</button></div>
      {message && <p className="notice">{message}</p>}
    </form>
    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">Requirements</p><h2>Managed clubs</h2></div></div>
      <div className="stack-list">{clubs.map((club) => <article key={club.circleId}>
        <div>
          <strong>{club.name}</strong>
          <small className="id">{club.circleId}</small>
          <small className="id">Rank {rankGradeLabel(club.rankGrade)}</small>
          <small className="id">{club.promotionEnabled === false ? 'Promotion disabled' : 'Promotion enabled'}</small>
        </div>
        <span>{number.format(club.dailyTarget)} / day</span>
        <button type="button" onClick={() => setEditing(club)}>Edit</button>
      </article>)}</div>
    </section>
  </section>
}

type PlannerEntity = {
  key: string
  kind: 'member' | 'applicant'
  umaId: string
  name: string
  meta: string
  fallback: string
  sortValue: number
}

function copyUmaId(umaId: string) {
  void navigator.clipboard.writeText(umaId).catch(() => undefined)
}

function ActionChecklist({
  clubs,
  entities,
  destination,
  originLabel,
  focusClubId,
}: {
  clubs: Club[]
  entities: PlannerEntity[]
  destination: (entity: PlannerEntity) => string
  originLabel: (fallback: string) => string
  focusClubId: string | 'all'
}) {
  const visibleClubs = focusClubId === 'all' ? clubs : clubs.filter((club) => club.circleId === focusClubId)
  return <section className="panel action-checklist">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Execute in game</p>
        <h2>Kick / invite checklist</h2>
        <p>At-a-glance lists for club leaders. Click an Uma ID to copy it.</p>
      </div>
    </div>
    <div className="checklist-grid">
      {visibleClubs.map((club) => {
        const invites = entities.filter((entity) => {
          const dest = destination(entity)
          return dest === club.circleId && entity.fallback !== club.circleId
        })
        const removals = entities.filter((entity) => {
          if (entity.fallback !== club.circleId) return false
          const dest = destination(entity)
          return dest === 'kick' || (dest !== club.circleId && !['waitlist', 'applicants', 'unassigned'].includes(dest))
        })
        return <article key={club.circleId} className="checklist-club">
          <header>
            <h3>{club.name}</h3>
            <span>{invites.length} invite · {removals.length} remove</span>
          </header>
          <div className="checklist-columns">
            <div>
              <h4 className="checklist-invite">Invite ({invites.length})</h4>
              {invites.length === 0 ? <p className="muted">None</p> : (
                <ul>{invites.map((entity) => (
                  <li key={entity.key}>
                    <strong>{entity.name}</strong>
                    <button type="button" className="id-copy" onClick={() => copyUmaId(entity.umaId)}>{entity.umaId}</button>
                    <small>from {originLabel(entity.fallback)}</small>
                  </li>
                ))}</ul>
              )}
            </div>
            <div>
              <h4 className="checklist-remove">Kick / transfer out ({removals.length})</h4>
              {removals.length === 0 ? <p className="muted">None</p> : (
                <ul>{removals.map((entity) => {
                  const dest = destination(entity)
                  const label = dest === 'kick' ? 'Kick / remove' : `Transfer → ${originLabel(dest)}`
                  return <li key={entity.key}>
                    <strong>{entity.name}</strong>
                    <button type="button" className="id-copy" onClick={() => copyUmaId(entity.umaId)}>{entity.umaId}</button>
                    <small>{label}</small>
                  </li>
                })}</ul>
              )}
            </div>
          </div>
        </article>
      })}
    </div>
  </section>
}

function StaffPlanner({
  clubs,
  members,
  applicants,
  initialAssignments,
  boardStatus,
  reload,
}: {
  clubs: Club[]
  members: Member[]
  applicants: Applicant[]
  initialAssignments: Assignment[]
  boardStatus: string
  reload: () => Promise<void>
}) {
  const clubNames = useMemo(() => new Map(clubs.map((club) => [club.circleId, club.name])), [clubs])
  const [checklistFilter, setChecklistFilter] = useState<string | 'all'>('all')
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments)
  const assignmentsRef = useRef(assignments)
  const saveChainRef = useRef(Promise.resolve())
  const [busy, setBusy] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  useEffect(() => {
    const next = initialAssignments.map((item) => (
      item.destination === 'unassigned' ? { ...item, destination: 'applicants' } : item
    ))
    setAssignments(next)
    assignmentsRef.current = next
  }, [initialAssignments])

  const entities = useMemo<PlannerEntity[]>(() => [
    ...members.map((member) => ({
      key: `member:${member.umaId}`,
      kind: 'member' as const,
      umaId: member.umaId,
      name: member.ign,
      meta: `${compact.format(member.dailyAverage)}/d`,
      fallback: member.circleId || 'applicants',
      sortValue: member.dailyAverage,
    })),
    ...applicants
      .filter((applicant) => applicant.status !== 'rejected')
      .map((applicant) => ({
        key: `applicant:${applicant.umaId}`,
        kind: 'applicant' as const,
        umaId: applicant.umaId,
        name: applicant.ign,
        meta: `${compact.format(applicant.dailyAverage)}/d · ${applicant.status}`,
        fallback: 'applicants',
        sortValue: applicant.dailyAverage,
      })),
  ], [members, applicants])

  const destination = (entity: PlannerEntity) => {
    const assigned = assignments.find((item) => `${item.entityType}:${item.entityId}` === entity.key)?.destination
    if (!assigned) return entity.fallback
    return assigned === 'unassigned' ? 'applicants' : assigned
  }

  const originLabel = (fallback: string) => {
    if (fallback === 'applicants' || fallback === 'unassigned') return 'Applicants'
    return clubNames.get(fallback) || fallback
  }

  const persist = (next: Assignment[]) => {
    setAssignments(next)
    assignmentsRef.current = next
    setBusy(true)
    const run = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await api.staffSavePlan(assignmentsRef.current)
        } catch (error) {
          alert((error as Error).message)
          await reload()
        }
      })
    saveChainRef.current = run
    void run.finally(() => {
      if (saveChainRef.current === run) setBusy(false)
    })
    return run
  }

  const resolveDropDestination = (overId: string) => {
    if (!overId.includes(':')) return overId
    const overEntity = entities.find((entity) => entity.key === overId)
    return overEntity ? destination(overEntity) : null
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveDragId(String(active.id))
  }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDragId(null)
    if (!over) return
    const activeKey = String(active.id)
    const entity = entities.find((item) => item.key === activeKey)
    if (!entity) return
    const dest = resolveDropDestination(String(over.id))
    if (!dest) return
    const current = destination(entity)
    if (dest === current) return

    const [entityType, entityId] = activeKey.split(':') as ['member' | 'applicant', string]
    const next = assignmentsRef.current.filter((item) => !(item.entityType === entityType && item.entityId === entityId))
    if (dest !== entity.fallback) {
      next.push({
        entityType,
        entityId,
        destination: dest,
        position: next.filter((item) => item.destination === dest).length,
      })
    }
    await persist(next)
  }

  const onDragCancel = () => setActiveDragId(null)

  const topLanes = clubs.map((club) => ({ id: club.circleId, title: club.name }))
  const bottomLanes = [
    { id: 'kick', title: 'Kick / remove' },
    { id: 'applicants', title: 'Applicants' },
    { id: 'waitlist', title: 'Waitlist' },
  ]

  const cardsFor = (laneId: string) => entities
    .filter((entity) => destination(entity) === laneId)
    .sort((a, b) => {
      const aMoved = destination(a) !== a.fallback ? 1 : 0
      const bMoved = destination(b) !== b.fallback ? 1 : 0
      if (aMoved !== bMoved) return bMoved - aMoved
      return b.sortValue - a.sortValue
    })

  const renderLane = (lane: { id: string; title: string }) => {
    const cards = cardsFor(lane.id)
    const movedInLane = cards.filter((entity) => destination(entity) !== entity.fallback).length
    return <Lane key={lane.id} id={lane.id} title={lane.title} count={cards.length} movedCount={movedInLane}>
      {cards.map((entity) => {
        const moved = destination(entity) !== entity.fallback
        const originClass = originTone(entity.fallback, clubNames.get(entity.fallback))
        return <DraggableCard
          key={entity.key}
          id={entity.key}
          name={entity.name}
          meta={entity.meta}
          umaId={entity.umaId}
          kind={entity.kind}
          moved={moved}
          fromLabel={moved ? originLabel(entity.fallback) : null}
          originClass={originClass}
        />
      })}
    </Lane>
  }

  const movedCount = entities.filter((entity) => destination(entity) !== entity.fallback).length
  const activeEntity = activeDragId ? entities.find((entity) => entity.key === activeDragId) : null

  return <section className="planner staff-planner">
    <div className="planner-heading">
      <div>
        <p className="eyebrow">Draft assignments · {boardStatus}</p>
        <h2>Transfer planner</h2>
        <p>Drag between clubs, kick, applicants, or waitlist. Checklist above is what leaders execute in game.</p>
      </div>
      <div className="planner-actions">
        <span className="move-summary">{movedCount} planned move{movedCount === 1 ? '' : 's'}</span>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await saveChainRef.current.catch(() => undefined)
              await api.staffConfirmPlan()
              await reload()
            } catch (error) {
              alert((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirm plan
        </button>
      </div>
    </div>

    <div className="band-filter-row" role="group" aria-label="Checklist club filter">
      <button type="button" className={`band-chip ${checklistFilter === 'all' ? 'active' : ''}`} onClick={() => setChecklistFilter('all')}>
        All clubs<span>{clubs.length}</span>
      </button>
      {clubs.map((club) => (
        <button
          key={`check-${club.circleId}`}
          type="button"
          className={`band-chip ${checklistFilter === club.circleId ? 'active' : ''}`}
          onClick={() => setChecklistFilter(club.circleId)}
        >
          {club.name}
        </button>
      ))}
    </div>

    <ActionChecklist
      clubs={clubs}
      entities={entities}
      destination={destination}
      originLabel={originLabel}
      focusClubId={checklistFilter}
    />

    <DndContext onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="lanes staff-lanes-top">{topLanes.map(renderLane)}</div>
      <div className="lanes staff-lanes-bottom">{bottomLanes.map(renderLane)}</div>
      <DragOverlay dropAnimation={null}>
        {activeEntity ? (
          <DragCardOverlay
            name={activeEntity.name}
            meta={activeEntity.meta}
            umaId={activeEntity.umaId}
            kind={activeEntity.kind}
            moved={destination(activeEntity) !== activeEntity.fallback}
            fromLabel={destination(activeEntity) !== activeEntity.fallback ? originLabel(activeEntity.fallback) : null}
            originClass={originTone(activeEntity.fallback, clubNames.get(activeEntity.fallback))}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  </section>
}

function StaffBlacklist({
  entries,
  reload,
}: {
  entries: BlacklistEntry[]
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const filtered = entries.filter((entry) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      entry.umaId.includes(q)
      || entry.discordUsername.toLowerCase().includes(q)
      || entry.reason.toLowerCase().includes(q)
      || entry.createdBy.toLowerCase().includes(q)
    )
  })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError('')
    const data = new FormData(form)
    try {
      await api.staffAddBlacklist({
        umaId: String(data.get('umaId') || '').trim(),
        discordUsername: String(data.get('discordUsername') || '').trim(),
        reason: String(data.get('reason') || '').trim(),
      })
      form.reset()
      await reload()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: BlacklistEntry) => {
    if (!confirm(`Remove ${entry.discordUsername} (${entry.umaId}) from the blacklist?`)) return
    setBusy(true)
    setError('')
    try {
      await api.staffDeleteBlacklist(entry.id)
      await reload()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="split-layout applicants-layout">
    <form className="panel form-stack" onSubmit={submit}>
      <div>
        <p className="eyebrow">Blocklist</p>
        <h2>Add to blacklist</h2>
        <p className="muted">Blocked trainers cannot submit applications. Match is by Uma ID or Discord username.</p>
      </div>
      <label>Uma ID<input name="umaId" inputMode="numeric" pattern="\d+" required placeholder="123456789" /></label>
      <label>Discord username<input name="discordUsername" required minLength={2} maxLength={64} placeholder="name" /></label>
      <label>Reason<textarea name="reason" rows={4} maxLength={2000} placeholder="Optional — staff-only note" /></label>
      <div className="button-row">
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Add to blacklist'}</button>
      </div>
      {error && <p className="notice error">{error}</p>}
    </form>
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Blocked</p>
          <h2>{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}</h2>
          <p>{entries.length} total on blacklist</p>
        </div>
        <div className="filters">
          <input
            aria-label="Search blacklist"
            placeholder="Search Discord, Uma ID, reason"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Discord</th>
              <th>Uma ID</th>
              <th>Reason</th>
              <th>Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">No blacklist entries yet.</td></tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id}>
                <td><strong>{entry.discordUsername}</strong></td>
                <td>
                  <a href={`https://uma.moe/profile/${entry.umaId}`} target="_blank" rel="noreferrer">
                    <small className="id">{entry.umaId}</small>
                  </a>
                </td>
                <td>{entry.reason || <span className="muted">—</span>}</td>
                <td>
                  <span className="muted">
                    {entry.createdBy || '—'}
                    {entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleDateString()}` : ''}
                  </span>
                </td>
                <td>
                  <button type="button" className="danger-link" disabled={busy} onClick={() => void remove(entry)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </section>
}

function StaffPage() {
  const [auth, setAuth] = useState<'loading' | 'guest' | 'user'>('loading')
  const [userLabel, setUserLabel] = useState('')
  const [tab, setTab] = useState<'overview' | 'applicants' | 'planner' | 'tournaments' | 'blacklist' | 'settings'>('applicants')
  const [dashboard, setDashboard] = useState<PublicData | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [clubs, setClubs] = useState<Club[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [memberLinks, setMemberLinks] = useState<Array<{ umaId: string; discordId: string }>>([])
  const [directory, setDirectory] = useState<MemberDirectoryRow[]>([])
  const [profileUmaId, setProfileUmaId] = useState<string | null>(null)
  const [boardStatus, setBoardStatus] = useState('draft')
  const [error, setError] = useState('')
  const params = new URLSearchParams(window.location.search)
  const loginError = params.get('error')

  const reload = async () => {
    const me = await api.me()
    if (!me.authenticated || !me.user?.isManager) {
      setAuth('guest')
      return
    }
    setAuth('user')
    setUserLabel(me.user.label || me.user.globalName || me.user.username)
    const [dash, staff, clubPayload, plan, blocked] = await Promise.all([
      api.publicDashboard(),
      api.staffApplicants(),
      api.staffClubs(),
      api.staffPlan(),
      api.staffBlacklist(),
    ])
    setDashboard(dash)
    setApplicants(staff.applicants)
    setClubs(clubPayload.clubs)
    setMemberLinks(clubPayload.memberLinks || [])
    setDirectory(clubPayload.directory || [])
    setAssignments(plan.assignments)
    setBoardStatus(plan.board.status || 'draft')
    setBlacklist(blocked.entries)
  }

  useEffect(() => {
    reload().catch((reason) => {
      setAuth('guest')
      setError((reason as Error).message)
    })
  }, [])

  if (auth === 'loading') {
    return <main className="center-message"><h1>Staff</h1><p>Checking Discord session…</p></main>
  }

  if (auth === 'guest') {
    return <main className="center-message staff-login">
      <h1>Staff login</h1>
      <p>Sign in with Discord. Only allowlisted managers can open applicants.</p>
      {(loginError === 'unauthorized' || loginError === 'login_failed') && (
        <p className="notice error">
          {loginError === 'unauthorized'
            ? 'That Discord account is not in config/access.json.'
            : 'Discord login failed. Try again.'}
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      <div className="button-row">
        <a className="primary button-link" href="/api/auth/login?returnTo=/staff">Log in with Discord</a>
        <a href="/">Public overview</a>
      </div>
    </main>
  }

  const discordByUma = new Map(memberLinks.map((link) => [link.umaId, link.discordId]))
  const members = (dashboard?.clubs || []).flatMap((club) =>
    (club.members || []).map((member) => ({
      ...member,
      circleId: club.circleId,
      discordId: discordByUma.get(member.umaId) || member.discordId || null,
    })),
  )
  const saveMemberDiscord = async (umaId: string, discordId: string | null) => {
    const saved = await api.staffSaveMemberLink(umaId, discordId)
    setMemberLinks((current) => {
      const without = current.filter((link) => link.umaId !== umaId)
      if (!saved.discordId) return without
      return [...without, { umaId, discordId: saved.discordId }]
    })
  }
  const safeReload = async () => {
    try {
      await reload()
      setError('')
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return <main className="shell local-shell">
    <Header>
      <div className="button-row">
        <span className="muted">{userLabel}</span>
        <button type="button" onClick={async () => { await api.logout(); window.location.href = '/staff' }}>Log out</button>
      </div>
    </Header>
    {error && <p className="notice error">{error}</p>}
    <nav className="tabs" aria-label="Staff sections">
      {(['overview', 'applicants', 'planner', 'tournaments', 'blacklist', 'settings'] as const).map((item) => (
        <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>
      ))}
    </nav>
    {tab === 'overview' && dashboard && (
      <>
        <ClubSummary clubs={dashboard.clubs} />
        <MemberTable
          clubs={dashboard.clubs}
          members={members}
          assignments={assignments}
          onSaveDiscord={saveMemberDiscord}
          directory={directory}
          onOpenProfile={setProfileUmaId}
        />
        <PublicApplicants applicants={dashboard.applicants} clubs={dashboard.clubs} />
      </>
    )}
    {tab === 'applicants' && (
      <StaffApplicants applicants={applicants} clubs={clubs} reload={safeReload} />
    )}
    {tab === 'planner' && (
      <StaffPlanner
        clubs={clubs}
        members={members}
        applicants={applicants}
        initialAssignments={assignments}
        boardStatus={boardStatus}
        reload={safeReload}
      />
    )}
    {tab === 'tournaments' && (
      <StaffTournaments clubs={clubs} members={members} reload={safeReload} />
    )}
    {tab === 'blacklist' && (
      <StaffBlacklist entries={blacklist} reload={safeReload} />
    )}
    {tab === 'settings' && (
      <StaffClubSettings clubs={clubs} reload={safeReload} />
    )}
    {profileUmaId ? <MemberProfileModal umaId={profileUmaId} onClose={() => setProfileUmaId(null)} /> : null}
  </main>
}

function ClubSettings({ state, reload }: { state: DashboardState; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<Club | null>(null)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const club = {
      circleId: String(form.get('circleId')), name: String(form.get('name')),
      dailyTarget: Number(form.get('dailyTarget')), promotionRatio: Number(form.get('promotionRatio')),
      severeRatio: Number(form.get('severeRatio')), inactiveDays: Number(form.get('inactiveDays')),
      promotionEnabled: form.get('promotionEnabled') === 'on',
    }
    await (editing ? api.updateClub(editing.circleId, club) : api.addClub(club))
    setEditing(null); event.currentTarget.reset(); await reload()
  }
  return <section className="split-layout">
    <form className="panel form-stack" onSubmit={submit} key={editing?.circleId || 'new-club'}>
      <div><p className="eyebrow">Configuration</p><h2>{editing ? 'Edit club' : 'Add club'}</h2></div>
      <label>Circle ID<input name="circleId" required defaultValue={editing?.circleId} readOnly={Boolean(editing)} /></label>
      <label>Display name<input name="name" required defaultValue={editing?.name} /></label>
      <label>Daily requirement<input name="dailyTarget" type="number" min="0" required defaultValue={editing?.dailyTarget || ''} /></label>
      <div className="field-row">
        <label>Promotion ratio<input name="promotionRatio" type="number" min="1" step=".05" defaultValue={editing?.promotionRatio || 1.25} /></label>
        <label>Severe ratio<input name="severeRatio" type="number" min="0" max="1" step=".05" defaultValue={editing?.severeRatio || .5} /></label>
      </div>
      <label>Inactive after days<input name="inactiveDays" type="number" min="1" defaultValue={editing?.inactiveDays || 3} /></label>
      <label className="check"><input name="promotionEnabled" type="checkbox" defaultChecked={editing?.promotionEnabled ?? true} /> Enable promotion-candidate assessments for this club</label>
      <p className="muted">Turn this off for your main club (for example Dust Bunny) where members cannot be promoted further.</p>
      <div className="button-row"><button className="primary">{editing ? 'Save club' : 'Add club'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
    </form>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">Requirements</p><h2>Registered clubs</h2></div></div>
      <div className="stack-list">{state.clubs.map((club) => <article key={club.circleId}>
        <div><strong>{club.name}</strong><small className="id">{club.circleId}</small><small className="id">{club.promotionEnabled === false ? 'Promotion disabled' : 'Promotion enabled'}</small></div>
        <span>{number.format(club.dailyTarget)} / day</span>
        <button onClick={() => setEditing(club)}>Edit</button>
        <button className="danger-link" onClick={async () => { if (confirm(`Remove ${club.name}?`)) { await api.deleteClub(club.circleId); await reload() } }}>Remove</button>
      </article>)}</div>
    </section>
  </section>
}

function ApplicantManager({ state, reload }: { state: DashboardState; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<Applicant | null>(null)
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('pending')
  const clubNames = new Map(state.clubs.map((club) => [club.circleId, club.name]))
  const statusCounts = state.applicants.reduce<Record<string, number>>((counts, applicant) => {
    counts[applicant.status] = (counts[applicant.status] || 0) + 1
    return counts
  }, {})
  const filtered = state.applicants.filter((applicant) => statusFilter === 'all' || applicant.status === statusFilter)
  const setStatus = async (applicant: Applicant, status: Status) => {
    await api.updateApplicant(applicant.umaId, {
      umaId: applicant.umaId,
      ign: applicant.ign,
      targetClubId: applicant.targetClubId,
      status,
      privateNotes: applicant.privateNotes || '',
      publishPublicly: applicant.publishPublicly ?? true,
    })
    await reload()
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = {
      umaId: String(form.get('umaId')), ign: editing?.ign || 'Resolving…',
      targetClubId: String(form.get('targetClubId')), status: String(form.get('status')),
      privateNotes: String(form.get('privateNotes') || ''), publishPublicly: form.get('publishPublicly') === 'on',
    }
    await (editing ? api.updateApplicant(editing.umaId, body) : api.addApplicant(body))
    setEditing(null); event.currentTarget.reset(); await reload()
  }
  return <section className="split-layout applicants-layout">
    <form className="panel form-stack" onSubmit={submit} key={editing?.umaId || 'new-applicant'}>
      <div><p className="eyebrow">Manual intake</p><h2>{editing ? 'Edit applicant' : 'Add applicant'}</h2></div>
      <label>Uma ID<input name="umaId" inputMode="numeric" pattern="\d+" required readOnly={Boolean(editing)} defaultValue={editing?.umaId} /></label>
      <label>Applying to<select name="targetClubId" required defaultValue={editing?.targetClubId}><option value="">Select a club</option>{state.clubs.map((club) => <option key={club.circleId} value={club.circleId}>{club.name}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={editing?.status || 'pending'}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>Private notes<textarea name="privateNotes" rows={4} defaultValue={editing?.privateNotes} /></label>
      <label className="check"><input name="publishPublicly" type="checkbox" defaultChecked={editing?.publishPublicly ?? true} /> Publish Uma ID, IGN, performance, target club, and status</label>
      <div className="button-row"><button className="primary">{editing ? 'Save applicant' : 'Resolve and add'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
    </form>
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recruitment</p>
          <h2>{filtered.length} applicants</h2>
          <p>{statusFilter === 'all' ? `${state.applicants.length} total` : `${statusCounts[statusFilter] || 0} ${statusFilter}`}</p>
        </div>
      </div>
      <div className="band-filter-row" role="group" aria-label="Filter applicants by status">
        <button type="button" className={`band-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          All<span>{state.applicants.length}</span>
        </button>
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            className={`band-chip status-chip status-${status} ${statusFilter === status ? 'active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {status}<span>{statusCounts[status] || 0}</span>
          </button>
        ))}
      </div>
      <div className="applicant-cards">{filtered.length === 0 ? (
        <p className="muted empty-applicants">No applicants in this status.</p>
      ) : filtered.map((applicant) => <article key={applicant.umaId}>
        <div><strong>{applicant.ign}</strong><small className="id">{applicant.umaId}</small></div>
        <span className={`status status-${applicant.status}`}>{applicant.status}</span>
        <dl>
          <div><dt>Daily average</dt><dd>{number.format(applicant.dailyAverage)}</dd></div>
          <div><dt>Applying to</dt><dd>{clubNames.get(applicant.targetClubId) || applicant.targetClubId}</dd></div>
          <div><dt>Current club</dt><dd>{applicant.currentClubName || '—'}</dd></div>
          <div><dt>Monthly</dt><dd>{number.format(applicant.monthlyGain)}</dd></div>
        </dl>
        <div className="applicant-trend">
          <p className="trend-label">30-day fans</p>
          <TrendChart label={applicant.ign} dailyGains={applicant.dailyGains} height={96} className="applicant-chart" />
        </div>
        <p>{applicant.privateNotes || 'No private notes'}</p>
        <div className="button-row">
          {applicant.status !== 'approved' && (
            <button className="primary" onClick={async () => { await setStatus(applicant, 'approved') }}>Approve</button>
          )}
          {applicant.status !== 'waitlisted' && (
            <button onClick={async () => { await setStatus(applicant, 'waitlisted') }}>Waitlist</button>
          )}
          <button onClick={() => setEditing(applicant)}>Edit</button>
          <button className="danger-link" onClick={async () => { if (confirm(`Delete ${applicant.ign}?`)) { await api.deleteApplicant(applicant.umaId); await reload() } }}>Delete</button>
        </div>
      </article>)}</div>
    </section>
  </section>
}

function originTone(sourceId: string, clubName?: string | null) {
  if (sourceId === 'applicants' || sourceId === 'unassigned') return 'origin-applicant'
  const name = (clubName || '').toLowerCase()
  if (name.includes('dust')) return 'origin-dust'
  if (name.includes('dirt')) return 'origin-dirt'
  if (name.includes('damp')) return 'origin-damp'
  if (name.includes('dusk')) return 'origin-dusk'
  return 'origin-other'
}

function PlannerCardFace({
  name,
  meta,
  umaId,
  moved,
  fromLabel,
  originClass,
  kind,
}: {
  name: string
  meta: string
  umaId: string
  moved: boolean
  fromLabel?: string | null
  originClass?: string
  kind: 'member' | 'applicant'
}) {
  const tag = moved && fromLabel
    ? <em className={`move-tag ${originClass || ''}`}>{fromLabel.replace(/ Bunny$/i, '')}</em>
    : kind === 'applicant' && !moved
      ? <em className="move-tag origin-applicant">applicant</em>
      : null
  return <div className="drag-card-top">
    <div className="drag-main">
      <strong title={umaId}>{name}</strong>
      <span>{meta}</span>
    </div>
    {tag}
  </div>
}

function DraggableCard({
  id,
  name,
  meta,
  umaId,
  moved,
  fromLabel,
  originClass,
  kind,
}: {
  id: string
  name: string
  meta: string
  umaId: string
  moved: boolean
  fromLabel?: string | null
  originClass?: string
  kind: 'member' | 'applicant'
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return <article
    ref={setNodeRef}
    className={`drag-card ${kind} ${moved ? 'moved' : ''} ${originClass || ''} ${isDragging ? 'dragging' : ''}`}
    {...listeners}
    {...attributes}
  >
    <PlannerCardFace
      name={name}
      meta={meta}
      umaId={umaId}
      moved={moved}
      fromLabel={fromLabel}
      originClass={originClass}
      kind={kind}
    />
  </article>
}

function DragCardOverlay({
  name,
  meta,
  umaId,
  moved,
  fromLabel,
  originClass,
  kind,
}: {
  name: string
  meta: string
  umaId: string
  moved: boolean
  fromLabel?: string | null
  originClass?: string
  kind: 'member' | 'applicant'
}) {
  return <article className={`drag-card drag-overlay-card ${kind} ${moved ? 'moved' : ''} ${originClass || ''}`}>
    <PlannerCardFace
      name={name}
      meta={meta}
      umaId={umaId}
      moved={moved}
      fromLabel={fromLabel}
      originClass={originClass}
      kind={kind}
    />
  </article>
}

function Lane({ id, title, count, movedCount, children }: { id: string; title: string; count: number; movedCount: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const capped = !['waitlist', 'kick', 'applicants', 'unassigned'].includes(id)
  return <section ref={setNodeRef} className={`lane ${isOver ? 'over' : ''}`}>
    <header>
      <div>
        <h3>{title}</h3>
        {movedCount > 0 ? <small className="lane-moves">{movedCount} move{movedCount === 1 ? '' : 's'}</small> : null}
      </div>
      <span className={capped && count > 30 ? 'capacity-error' : ''}>{count}{capped && '/30'}</span>
    </header>
    <div className="lane-cards">{children}</div>
  </section>
}

function Planner({ state, reload }: { state: DashboardState; reload: () => Promise<void> }) {
  const clubNames = useMemo(() => new Map(state.clubs.map((club) => [club.circleId, club.name])), [state.clubs])
  const entities = useMemo(() => [
    ...state.members.map((member) => ({
      key: `member:${member.umaId}` as const,
      kind: 'member' as const,
      umaId: member.umaId,
      name: member.ign,
      meta: `${compact.format(member.dailyAverage)}/d`,
      fallback: member.circleId || 'applicants',
      sortValue: member.dailyAverage,
    })),
    ...state.applicants
      .filter((applicant) => applicant.status !== 'rejected')
      .map((applicant) => ({
      key: `applicant:${applicant.umaId}` as const,
      kind: 'applicant' as const,
      umaId: applicant.umaId,
      name: applicant.ign,
      meta: `${compact.format(applicant.dailyAverage)}/d · ${applicant.status}`,
      fallback: 'applicants',
      sortValue: applicant.dailyAverage,
    })),
  ], [state])
  const [assignments, setAssignments] = useState<Assignment[]>(state.assignments)
  const assignmentsRef = useRef(assignments)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  useEffect(() => {
    const next = state.assignments.map((item) => (
      item.destination === 'unassigned' ? { ...item, destination: 'applicants' } : item
    ))
    setAssignments(next)
    assignmentsRef.current = next
  }, [state.assignments])
  const destination = (entity: typeof entities[number]) => {
    const assigned = assignments.find((item) => `${item.entityType}:${item.entityId}` === entity.key)?.destination
    if (!assigned) return entity.fallback
    return assigned === 'unassigned' ? 'applicants' : assigned
  }
  const topLanes = state.clubs.map((club) => ({ id: club.circleId, title: club.name }))
  const bottomLanes = [
    { id: 'kick', title: 'Kick / remove' },
    { id: 'applicants', title: 'Applicants' },
    { id: 'waitlist', title: 'Waitlist' },
  ]
  const movedEntities = entities.filter((entity) => destination(entity) !== entity.fallback)
  const onDragStart = ({ active }: DragStartEvent) => setActiveDragId(String(active.id))
  const onDragCancel = () => setActiveDragId(null)
  const resolveDropDestination = (overId: string) => {
    if (!overId.includes(':')) return overId
    const overEntity = entities.find((entity) => entity.key === overId)
    return overEntity ? destination(overEntity) : null
  }
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDragId(null)
    if (!over) return
    const activeKey = String(active.id)
    const entity = entities.find((item) => item.key === activeKey)
    if (!entity) return
    const dest = resolveDropDestination(String(over.id))
    if (!dest) return
    const current = destination(entity)
    if (dest === current) return
    const [entityType, entityId] = activeKey.split(':') as ['member' | 'applicant', string]
    const next = assignmentsRef.current.filter((item) => !(item.entityType === entityType && item.entityId === entityId))
    if (dest !== entity.fallback) {
      next.push({ entityType, entityId, destination: dest, position: next.filter((item) => item.destination === dest).length })
    }
    setAssignments(next)
    assignmentsRef.current = next
    try { await api.savePlan(next) } catch (error) { alert((error as Error).message); await reload() }
  }
  const originLabel = (fallback: string) => {
    if (fallback === 'applicants' || fallback === 'unassigned') return 'Applicants'
    return clubNames.get(fallback) || fallback
  }
  const activeEntity = activeDragId ? entities.find((entity) => entity.key === activeDragId) : null
  const renderLane = (lane: { id: string; title: string }) => {
    const cards = entities
      .filter((entity) => destination(entity) === lane.id)
      .sort((a, b) => {
        const aMoved = destination(a) !== a.fallback ? 1 : 0
        const bMoved = destination(b) !== b.fallback ? 1 : 0
        if (aMoved !== bMoved) return bMoved - aMoved
        return b.sortValue - a.sortValue
      })
    const movedCount = cards.filter((entity) => destination(entity) !== entity.fallback).length
    return <Lane key={lane.id} id={lane.id} title={lane.title} count={cards.length} movedCount={movedCount}>
      {cards.map((entity) => {
        const moved = destination(entity) !== entity.fallback
        const originClass = originTone(entity.fallback, clubNames.get(entity.fallback))
        return <DraggableCard
          key={entity.key}
          id={entity.key}
          name={entity.name}
          meta={entity.meta}
          umaId={entity.umaId}
          kind={entity.kind}
          moved={moved}
          fromLabel={moved ? originLabel(entity.fallback) : null}
          originClass={originClass}
        />
      })}
    </Lane>
  }
  return <section className="planner">
    <div className="planner-heading">
      <div>
        <p className="eyebrow">Draft assignments</p>
        <h2>Transfer planner</h2>
        <p>Moves are planning records only and do not change the game. Highlighted cards have been reassigned.</p>
      </div>
      <div className="planner-actions">
        <span className="move-summary">{movedEntities.length} planned move{movedEntities.length === 1 ? '' : 's'}</span>
        <button className="primary" onClick={async () => { await api.confirmPlan(); await reload() }}>Confirm plan</button>
      </div>
    </div>
    <DndContext onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="lanes staff-lanes-top">{topLanes.map(renderLane)}</div>
      <div className="lanes staff-lanes-bottom">{bottomLanes.map(renderLane)}</div>
      <DragOverlay dropAnimation={null}>
        {activeEntity ? (
          <DragCardOverlay
            name={activeEntity.name}
            meta={activeEntity.meta}
            umaId={activeEntity.umaId}
            kind={activeEntity.kind}
            moved={destination(activeEntity) !== activeEntity.fallback}
            fromLabel={destination(activeEntity) !== activeEntity.fallback ? originLabel(activeEntity.fallback) : null}
            originClass={originTone(activeEntity.fallback, clubNames.get(activeEntity.fallback))}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  </section>
}

function Publisher() {
  const [preview, setPreview] = useState<{ previous: unknown; next: unknown } | null>(null)
  const [message, setMessage] = useState('')
  const load = () => api.preview().then(setPreview).catch((error) => setMessage(error.message))
  useEffect(() => { void load() }, [])
  return <section className="panel publish-panel">
    <div className="section-heading"><div><p className="eyebrow">Sanitized publication</p><h2>Exact public input</h2></div>
      <div className="button-row"><button onClick={load}>Refresh preview</button><button className="primary" onClick={async () => {
        if (!confirm('Publish this sanitized data?')) return
        try { const result = await api.publish(); setMessage(`Published to ${result.destination}`); await load() } catch (error) { setMessage((error as Error).message) }
      }}>Publish</button></div>
    </div>
    <p>Only the next JSON object is published. Private notes, Discord data, credentials, plans, and local paths are rejected server-side.</p>
    {message && <p className="notice">{message}</p>}
    <div className="json-grid"><div><h3>Previously published</h3><pre>{JSON.stringify(preview?.previous, null, 2)}</pre></div><div><h3>Next publication</h3><pre>{JSON.stringify(preview?.next, null, 2)}</pre></div></div>
  </section>
}

function LocalWorkspace() {
  const [tab, setTab] = useState<'overview' | 'applicants' | 'planner' | 'settings' | 'publish'>('overview')
  const [state, setState] = useState<DashboardState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = async () => { try { setState(await api.state()); setError('') } catch (reason) { setError((reason as Error).message) } }
  useEffect(() => { void reload() }, [])
  if (!state) return <main className="center-message"><h1>Local workspace</h1><p>{error || 'Starting local database…'}</p></main>
  return <main className="shell local-shell">
    <Header><div className="button-row"><Freshness date={state.clubs.map((club) => club.syncedAt).filter(Boolean).sort().at(-1)} /><button className="primary" disabled={busy} onClick={async () => {
      setBusy(true); try {
        const next = await api.sync()
        setState(next)
        setError(next.syncErrors?.length
          ? next.syncErrors.map((item) => `${item.id}: ${item.error}`).join(' · ')
          : '')
      } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
    }}>{busy ? 'Refreshing…' : 'Refresh data'}</button></div></Header>
    {error && <p className="notice error">{error}</p>}
    <nav className="tabs" aria-label="Workspace sections">{(['overview', 'applicants', 'planner', 'settings', 'publish'] as const).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === 'overview' && <><section className="summary-grid"><article><span>Clubs</span><strong>{state.clubs.length}</strong></article><article><span>Members</span><strong>{state.members.length}</strong></article><article><span>Applicants</span><strong>{state.applicants.length}</strong></article><article><span>Plan status</span><strong className="text-value">{state.board?.status || 'draft'}</strong></article></section><ClubSummary clubs={state.clubs.map((club) => ({ ...club, members: state.members.filter((member) => member.circleId === club.circleId) }))} /><MemberTable clubs={state.clubs} members={state.members} assignments={state.assignments} /></>}
    {tab === 'applicants' && <ApplicantManager state={state} reload={reload} />}
    {tab === 'planner' && <Planner state={state} reload={reload} />}
    {tab === 'settings' && <ClubSettings state={state} reload={reload} />}
    {tab === 'publish' && <Publisher />}
  </main>
}

export default function App() {
  // Never ship the SQLite local UI to Vercel/production, even if
  // VITE_LOCAL_WORKSPACE was accidentally set in the host env.
  if (import.meta.env.PROD) return <OnlineApp />
  if (import.meta.env.VITE_PUBLIC_ONLY === 'true') {
    return <PublicDashboard navigate={() => undefined} />
  }
  if (import.meta.env.MODE === 'workspace' || import.meta.env.VITE_LOCAL_WORKSPACE === 'true') {
    return <LocalWorkspace />
  }
  return <OnlineApp />
}

function OnlineApp() {
  const { path, navigate } = usePath()
  if (path.startsWith('/staff')) return <StaffPage />
  if (path.startsWith('/tourney')) return <TourneyPage path={path} navigate={navigate} />
  return <PublicSite path={path} navigate={navigate} />
}
