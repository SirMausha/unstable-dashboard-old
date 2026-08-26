import { useEffect, useState } from 'react'
import { api } from './api'
import type { TrainerMiniProfile } from './types'

const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

function formatYm(value: string | null) {
  if (!value) return '—'
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return value
  return monthLabel(year, month)
}

export function MemberProfileModal({
  umaId,
  onClose,
}: {
  umaId: string
  onClose: () => void
}) {
  const [profile, setProfile] = useState<TrainerMiniProfile | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError('')
    api.staffMemberProfile(umaId)
      .then((payload) => { if (!cancelled) setProfile(payload) })
      .catch((reason) => { if (!cancelled) setError((reason as Error).message) })
    return () => { cancelled = true }
  }, [umaId])

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="panel mini-profile" role="dialog" aria-modal="true" aria-labelledby="mini-profile-title" onClick={(event) => event.stopPropagation()}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Trainer profile</p>
          <h2 id="mini-profile-title">{profile?.ign || 'Loading…'}</h2>
          <p className="muted">{umaId}</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {error && <p className="notice error">{error}</p>}
      {!profile && !error ? <p className="muted">Loading uma.moe + club history…</p> : null}
      {profile ? (
        <>
          <p className={`plan-status ${profile.status === 'current' ? 'plan-move' : 'plan-kick'}`}>
            {profile.status === 'current'
              ? `Current · ${profile.currentClubName || 'Bunny network'}`
              : profile.status === 'former'
                ? `Former · last ${profile.lastClubName || 'Bunny club'}`
                : 'Not in saved club history yet'}
          </p>
          <dl className="apply-club-meta mini-profile-meta">
            <div><dt>Network tenure</dt><dd>{profile.networkMonths ? `${profile.networkMonths} month${profile.networkMonths === 1 ? '' : 's'}` : '—'}</dd></div>
            <div><dt>Since</dt><dd>{formatYm(profile.firstNetworkMonth) !== '—' ? formatYm(profile.firstNetworkMonth) : (profile.firstSeenOn || '—')}</dd></div>
            <div><dt>Days observed</dt><dd>{profile.observedDays || '—'}</dd></div>
            <div><dt>Discord</dt><dd className="id" style={{ margin: 0 }}>{profile.discordId || '—'}</dd></div>
          </dl>
          <p className="muted">Time in Dust / Dirt / Damp / Dusk counts as one stay, even after moving between them. Months away from the network are not counted.</p>
          {profile.stints.length ? (
            <div>
              <h3 className="mini-profile-sub">Club history</h3>
              <ul className="mini-profile-stints">
                {profile.stints.map((stint, index) => (
                  <li key={`${stint.circleId}-${index}`}>
                    <strong>{stint.circleName}</strong>
                    <span>
                      {monthLabel(stint.startYear, stint.startMonth)}
                      {' – '}
                      {profile.status === 'current' && index === profile.stints.length - 1
                        ? 'present'
                        : monthLabel(stint.endYear, stint.endMonth)}
                      {` · ${stint.monthCount} mo`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {profile.clubDays.length ? (
            <div>
              <h3 className="mini-profile-sub">Tracked days</h3>
              <ul className="mini-profile-stints">
                {profile.clubDays.map((row) => (
                  <li key={row.circleId}>
                    <strong>{row.circleName}</strong>
                    <span>{row.days} day{row.days === 1 ? '' : 's'} · {row.firstSeenOn} – {row.lastSeenOn}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {profile.tournaments.length ? (
            <div>
              <h3 className="mini-profile-sub">Tournaments</h3>
              <ul className="mini-profile-stints">
                {profile.tournaments.map((tournament) => (
                  <li key={tournament.id}>
                    <strong>{tournament.name}</strong>
                    <span>{tournament.eventDate ? new Date(tournament.eventDate).toLocaleDateString() : '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="button-row">
            <a className="button-link" href={profile.umaMoeUrl} target="_blank" rel="noreferrer">uma.moe profile</a>
          </div>
        </>
      ) : null}
    </section>
  </div>
}
