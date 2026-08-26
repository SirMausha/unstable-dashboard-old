import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from './api'
import type { Club, Member, Tournament, TournamentDistance, TournamentPlayer } from './types'

const distances: TournamentDistance[] = ['sprint', 'mile', 'medium', 'long', 'dirt']

type DraftPlayer = {
  key: string
  discordId: string
  displayName: string
  team: number
  distance: TournamentDistance
  sortOrder: number
  umaId: string | null
}

function toDraft(player: TournamentPlayer): DraftPlayer {
  return {
    key: `p-${player.id}`,
    discordId: player.discordId,
    displayName: player.displayName,
    team: player.team,
    distance: player.distance,
    sortOrder: player.sortOrder,
    umaId: player.umaId,
  }
}

function eventDateInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function StaffTournaments({
  clubs,
  members,
}: {
  clubs: Club[]
  members: Member[]
  reload?: () => Promise<void>
}) {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [players, setPlayers] = useState<DraftPlayer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [memberUmaId, setMemberUmaId] = useState('')
  const [memberDiscordId, setMemberDiscordId] = useState('')
  const [memberTeam, setMemberTeam] = useState(1)
  const [memberDistance, setMemberDistance] = useState<TournamentDistance>('mile')

  const selected = tournaments.find((item) => item.id === selectedId) || null
  const memberOptions = useMemo(() => {
    const clubNames = new Map(clubs.map((club) => [club.circleId, club.name]))
    return [...members]
      .sort((a, b) => a.ign.localeCompare(b.ign))
      .map((member) => ({
        ...member,
        label: `${member.ign} · ${clubNames.get(member.circleId || '') || 'club'}${member.discordId ? ' · linked' : ''}`,
      }))
  }, [clubs, members])

  useEffect(() => {
    const member = members.find((item) => item.umaId === memberUmaId)
    setMemberDiscordId(member?.discordId || '')
  }, [memberUmaId, members])

  const load = async (preferId?: number | null) => {
    const payload = await api.staffTournaments()
    setTournaments(payload.tournaments)
    const nextId = preferId ?? selectedId ?? payload.tournaments[0]?.id ?? null
    setSelectedId(nextId)
    if (nextId) {
      const board = await api.staffTournament(nextId)
      setPlayers(board.players.map(toDraft))
    } else {
      setPlayers([])
    }
  }

  useEffect(() => {
    load().catch((reason) => setError((reason as Error).message))
  }, [])

  const selectTournament = async (id: number) => {
    setSelectedId(id)
    setError('')
    setMessage('')
    try {
      const board = await api.staffTournament(id)
      setPlayers(board.players.map(toDraft))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const createTournament = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError('')
    setMessage('')
    const data = new FormData(form)
    try {
      const created = await api.staffCreateTournament({
        name: String(data.get('name') || '').trim(),
        rounds: Number(data.get('rounds') || 1),
        eventDate: String(data.get('eventDate') || ''),
      })
      form.reset()
      await load(created.id)
      setMessage('Tournament created.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveMeta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const form = event.currentTarget
    setBusy(true)
    setError('')
    setMessage('')
    const data = new FormData(form)
    try {
      await api.staffUpdateTournament(selected.id, {
        name: String(data.get('name') || '').trim(),
        rounds: Number(data.get('rounds') || 1),
        eventDate: String(data.get('eventDate') || ''),
      })
      await load(selected.id)
      setMessage('Tournament updated.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveRoster = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api.staffSaveTournamentRoster(
        selected.id,
        players.map((player, index) => ({
          discordId: player.discordId.trim(),
          displayName: player.displayName.trim(),
          team: player.team,
          distance: player.distance,
          sortOrder: index,
          umaId: player.umaId,
        })),
      )
      await load(selected.id)
      setMessage('Roster saved.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeTournament = async () => {
    if (!selected) return
    if (!confirm(`Delete tournament “${selected.name}”?`)) return
    setBusy(true)
    try {
      await api.staffDeleteTournament(selected.id)
      await load(null)
      setMessage('Tournament deleted.')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addOutsider = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const discordId = String(data.get('discordId') || '').trim()
    const displayName = String(data.get('displayName') || '').trim()
    if (!discordId || !displayName) return
    if (players.some((player) => player.discordId === discordId)) {
      setError('That Discord ID is already on the roster.')
      return
    }
    setPlayers((current) => [
      ...current,
      {
        key: `new-${discordId}-${Date.now()}`,
        discordId,
        displayName,
        team: Number(data.get('team') || 1),
        distance: String(data.get('distance') || 'mile') as TournamentDistance,
        sortOrder: current.length,
        umaId: null,
      },
    ])
    form.reset()
    setError('')
  }

  const addMember = () => {
    const member = members.find((item) => item.umaId === memberUmaId)
    if (!member) {
      setError('Pick a club member.')
      return
    }
    const discordId = memberDiscordId.trim()
    if (!discordId) {
      setError('Discord ID is required for login matching.')
      return
    }
    if (players.some((player) => player.discordId === discordId)) {
      setError('That Discord ID is already on the roster.')
      return
    }
    setPlayers((current) => [
      ...current,
      {
        key: `mem-${member.umaId}-${Date.now()}`,
        discordId,
        displayName: member.ign,
        team: memberTeam,
        distance: memberDistance,
        sortOrder: current.length,
        umaId: member.umaId,
      },
    ])
    void api.staffSaveMemberLink(member.umaId, discordId).catch((reason) => setError((reason as Error).message))
    setMemberUmaId('')
    setMemberDiscordId('')
    setError('')
  }

  return <section className="tourney-staff">
    <div className="split-layout applicants-layout">
      <form className="panel form-stack" onSubmit={createTournament}>
        <div>
          <p className="eyebrow">Tournaments</p>
          <h2>Create tournament</h2>
          <p className="muted">Set rounds (1 = single pick, 3 = one Uma per round) and the lock date.</p>
        </div>
        <label>Name<input name="name" required maxLength={120} placeholder="Spring Cup" /></label>
        <div className="field-row">
          <label>Rounds<input name="rounds" type="number" min={1} max={8} defaultValue={3} required /></label>
          <label>Event date<input name="eventDate" type="date" required /></label>
        </div>
        <div className="button-row">
          <button className="primary" disabled={busy}>Create</button>
        </div>
      </form>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>{tournaments.length} tournament{tournaments.length === 1 ? '' : 's'}</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Rounds</th><th>Date</th><th>Players</th><th></th></tr></thead>
            <tbody>
              {tournaments.length === 0 ? (
                <tr><td colSpan={5} className="empty-row">No tournaments yet.</td></tr>
              ) : tournaments.map((tournament) => (
                <tr key={tournament.id} className={selectedId === tournament.id ? 'row-selected' : ''}>
                  <td><strong>{tournament.name}</strong>{tournament.locked ? <span className="plan-status plan-kick"> locked</span> : null}</td>
                  <td>{tournament.rounds}</td>
                  <td>{new Date(tournament.eventDate).toLocaleDateString()}</td>
                  <td>{tournament.playerCount ?? '—'}</td>
                  <td><button type="button" onClick={() => void selectTournament(tournament.id)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    {selected ? (
      <section className="panel tourney-roster-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Roster</p>
            <h2>{selected.name}</h2>
            <p className="muted">
              Players only see tournaments they are on. After {new Date(selected.eventDate).toLocaleDateString()}, only managers can change picks.
            </p>
          </div>
          <div className="button-row">
            <a className="button-link" href={`/tourney?id=${selected.id}`} target="_blank" rel="noreferrer">Open board</a>
            <button type="button" className="danger-link" disabled={busy} onClick={() => void removeTournament()}>Delete</button>
          </div>
        </div>

        <form className="form-stack tourney-meta-form" onSubmit={saveMeta} key={`meta-${selected.id}`}>
          <div className="field-row">
            <label>Name<input name="name" required defaultValue={selected.name} /></label>
            <label>Rounds<input name="rounds" type="number" min={1} max={8} required defaultValue={selected.rounds} /></label>
            <label>Event date<input name="eventDate" type="date" required defaultValue={eventDateInput(selected.eventDate)} /></label>
          </div>
          <div className="button-row"><button className="primary" disabled={busy}>Save details</button></div>
        </form>

        <div className="tourney-add-grid">
          <div className="panel form-stack nested-panel">
            <h3>Add club member</h3>
            <p className="muted">Discord IDs are saved on the member and reused for later tournaments.</p>
            <label>Member
              <select value={memberUmaId} onChange={(event) => setMemberUmaId(event.target.value)}>
                <option value="">Select member</option>
                {memberOptions.map((member) => (
                  <option key={member.umaId} value={member.umaId}>{member.label}</option>
                ))}
              </select>
            </label>
            <label>Discord ID<input value={memberDiscordId} onChange={(event) => setMemberDiscordId(event.target.value)} placeholder={memberUmaId ? 'saved if blank next time' : 'numeric Discord snowflake'} /></label>
            <div className="field-row">
              <label>Team<input type="number" min={1} max={8} value={memberTeam} onChange={(event) => setMemberTeam(Number(event.target.value) || 1)} /></label>
              <label>Distance
                <select value={memberDistance} onChange={(event) => setMemberDistance(event.target.value as TournamentDistance)}>
                  {distances.map((distance) => <option key={distance} value={distance}>{distance}</option>)}
                </select>
              </label>
            </div>
            <button type="button" onClick={addMember}>Add member</button>
          </div>

          <form className="panel form-stack nested-panel" onSubmit={addOutsider}>
            <h3>Add outsider</h3>
            <label>Discord ID<input name="discordId" required placeholder="numeric Discord snowflake" /></label>
            <label>Display name<input name="displayName" required placeholder="IGN or nickname" /></label>
            <div className="field-row">
              <label>Team<input name="team" type="number" min={1} max={8} defaultValue={1} /></label>
              <label>Distance
                <select name="distance" defaultValue="mile">
                  {distances.map((distance) => <option key={distance} value={distance}>{distance}</option>)}
                </select>
              </label>
            </div>
            <button type="submit">Add outsider</button>
          </form>
        </div>

        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Discord ID</th><th>Team</th><th>Distance</th><th></th></tr></thead>
            <tbody>
              {players.length === 0 ? (
                <tr><td colSpan={5} className="empty-row">No players on roster yet.</td></tr>
              ) : players.map((player, index) => (
                <tr key={player.key}>
                  <td>
                    <input
                      value={player.displayName}
                      onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, displayName: event.target.value } : item))}
                    />
                  </td>
                  <td>
                    <input
                      value={player.discordId}
                      onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, discordId: event.target.value } : item))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={player.team}
                      onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, team: Number(event.target.value) || 1 } : item))}
                    />
                  </td>
                  <td>
                    <select
                      value={player.distance}
                      onChange={(event) => setPlayers((current) => current.map((item, i) => i === index ? { ...item, distance: event.target.value as TournamentDistance } : item))}
                    >
                      {distances.map((distance) => <option key={distance} value={distance}>{distance}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="danger-link" onClick={() => setPlayers((current) => current.filter((_, i) => i !== index))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" className="primary" disabled={busy} onClick={() => void saveRoster()}>Save roster</button>
        </div>
      </section>
    ) : null}

    {message && <p className="notice">{message}</p>}
    {error && <p className="notice error">{error}</p>}
  </section>
}
