import { useEffect, useMemo, useState, Fragment } from 'react'
import { api, type SessionUser } from './api'
import { CharacterPicker } from './CharacterPicker'
import type { Tournament, TournamentBoard, TournamentDistance, TournamentPick, TournamentPlayer } from './types'

const distanceOrder: TournamentDistance[] = ['sprint', 'mile', 'medium', 'long', 'dirt']
const distanceLabels: Record<TournamentDistance, string> = {
  sprint: 'Sprint',
  mile: 'Mile',
  medium: 'Medium',
  long: 'Long',
  dirt: 'Dirt',
}

function groupPlayers(players: TournamentPlayer[]) {
  const teams = [...new Set(players.map((player) => player.team))].sort((a, b) => a - b)
  return teams.map((team) => {
    const teamPlayers = players.filter((player) => player.team === team)
    const distances = distanceOrder
      .map((distance) => ({
        distance,
        players: teamPlayers
          .filter((player) => player.distance === distance)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      }))
      .filter((group) => group.players.length > 0)
    return { team, distances }
  })
}

export function TourneyPage({
  path,
  navigate,
}: {
  path: string
  navigate: (to: string) => void
}) {
  const params = new URLSearchParams(window.location.search)
  const requestedId = Number(params.get('id') || '')
  const loginError = params.get('error')

  const [auth, setAuth] = useState<'loading' | 'guest' | 'user'>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [board, setBoard] = useState<(TournamentBoard & { canEditAll: boolean; locked: boolean }) | null>(null)
  const [picks, setPicks] = useState<TournamentPick[]>([])
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const loadList = async () => {
    const me = await api.me()
    if (!me.authenticated || !me.user) {
      setAuth('guest')
      setUser(null)
      return
    }
    setAuth('user')
    setUser(me.user)
    const list = await api.tourneyList()
    setTournaments(list.tournaments)
  }

  const loadBoard = async (id: number) => {
    const payload = await api.tourneyBoard(id)
    setBoard(payload)
    setPicks(payload.picks)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await loadList()
        if (cancelled) return
        if (Number.isInteger(requestedId) && requestedId > 0) {
          await loadBoard(requestedId)
        }
      } catch (reason) {
        if (!cancelled) {
          setAuth('guest')
          setError((reason as Error).message)
        }
      }
    })()
    return () => { cancelled = true }
  }, [path])

  const grouped = useMemo(() => (board ? groupPlayers(board.players) : []), [board])

  const pickFor = (playerId: number, round: number) =>
    picks.find((pick) => pick.playerId === playerId && pick.round === round) || null

  const canEditPlayer = (player: TournamentPlayer) => {
    if (!board || !user) return false
    if (board.canEditAll) return true
    if (board.locked) return false
    return player.discordId === user.discordId
  }

  const savePick = async (player: TournamentPlayer, round: number, characterId: string | null) => {
    if (!board) return
    const key = `${player.id}:${round}`
    setSavingKey(key)
    setError('')
    try {
      const result = await api.tourneySavePick({
        tournamentId: board.tournament.id,
        playerId: player.id,
        round,
        characterId,
      })
      setPicks((current) => {
        const without = current.filter((pick) => !(pick.playerId === player.id && pick.round === round))
        if (result.cleared || !result.pick) return without
        return [...without, result.pick]
      })
    } catch (reason) {
      setError((reason as Error).message)
      await loadBoard(board.tournament.id)
    } finally {
      setSavingKey(null)
    }
  }

  if (auth === 'loading') {
    return <main className="center-message"><h1>Tournaments</h1><p>Checking Discord session…</p></main>
  }

  if (auth === 'guest') {
    return <main className="center-message staff-login">
      <h1>Tournament board</h1>
      <p>Log in with Discord to see tournaments you are rostered on.</p>
      {loginError && <p className="notice error">Discord login failed. Try again.</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="button-row">
        <a className="primary button-link" href="/api/auth/login?returnTo=/tourney">Log in with Discord</a>
        <a href="/">Public overview</a>
      </div>
    </main>
  }

  if (board) {
    const rounds = Array.from({ length: board.tournament.rounds }, (_, index) => index + 1)
    return <main className="shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Tournament picks</p>
          <h1>{board.tournament.name}</h1>
          <p className="lede">
            Lock date {new Date(board.tournament.eventDate).toLocaleDateString()}
            {board.locked ? ' · locked for players' : ''}
          </p>
        </div>
        <div className="button-row">
          <span className="muted">{user?.globalName || user?.username}</span>
          <button type="button" onClick={() => { setBoard(null); navigate('/tourney') }}>All tournaments</button>
          <button type="button" onClick={async () => { await api.logout(); window.location.href = '/tourney' }}>Log out</button>
        </div>
      </header>
      {board.locked && !board.canEditAll ? (
        <p className="notice">Picks are locked after the event date. Ask a manager if something needs changing.</p>
      ) : null}
      {error && <p className="notice error">{error}</p>}

      <div className="tourney-teams">
        {grouped.map(({ team, distances }) => (
          <section key={team} className="panel tourney-team-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Team {team}</p>
                <h2>{distances.reduce((sum, group) => sum + group.players.length, 0)} players</h2>
              </div>
            </div>

            {distances.map(({ distance, players }) => (
              <div key={distance} className="tourney-distance-block">
                <header className="tourney-distance-heading">
                  <h3>{distanceLabels[distance]}</h3>
                  <span>{players.length} player{players.length === 1 ? '' : 's'}</span>
                </header>
                <div
                  className="tourney-distance-grid"
                  style={{ gridTemplateColumns: `24px repeat(${players.length}, minmax(108px, 1fr))` }}
                >
                  <div className="tourney-corner" aria-hidden />
                  {players.map((player) => (
                    <div
                      key={`head-${player.id}`}
                      className={`tourney-col-head ${player.discordId === user?.discordId ? 'mine' : ''}`}
                      title={player.discordId}
                    >
                      <strong>{player.displayName}</strong>
                    </div>
                  ))}
                  {rounds.map((round) => (
                    <Fragment key={`${distance}-r${round}`}>
                      <div className="tourney-round-label">
                        {board.tournament.rounds === 1 ? 'Uma' : `R${round}`}
                      </div>
                      {players.map((player) => {
                        const editable = canEditPlayer(player)
                        const pick = pickFor(player.id, round)
                        const key = `${player.id}:${round}`
                        return <div
                          key={key}
                          className={`tourney-pick-cell ${player.discordId === user?.discordId ? 'mine' : ''} ${savingKey === key ? 'saving' : ''}`}
                        >
                          <CharacterPicker
                            compact
                            stacked
                            value={pick?.characterId || null}
                            disabled={!editable || savingKey === key}
                            onChange={(characterId) => void savePick(player, round, characterId)}
                          />
                        </div>
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  }

  return <main className="shell">
    <header className="site-header">
      <div>
        <p className="eyebrow">Tournament picks</p>
        <h1>Your tournaments</h1>
        <p className="lede">Only events you are rostered on appear here.</p>
      </div>
      <div className="button-row">
        <span className="muted">{user?.globalName || user?.username}</span>
        {user?.isManager ? <a href="/staff">Staff</a> : null}
        <button type="button" onClick={async () => { await api.logout(); window.location.href = '/tourney' }}>Log out</button>
      </div>
    </header>
    {error && <p className="notice error">{error}</p>}
    <section className="panel">
      {tournaments.length === 0 ? (
        <p className="empty-row">You’re not on any tournament rosters yet.</p>
      ) : (
        <div className="tourney-list">
          {tournaments.map((tournament) => (
            <button
              key={tournament.id}
              type="button"
              className="tourney-list-card"
              onClick={() => {
                navigate(`/tourney?id=${tournament.id}`)
                void loadBoard(tournament.id).catch((reason) => setError((reason as Error).message))
              }}
            >
              <strong>{tournament.name}</strong>
              <span>{tournament.rounds} round{tournament.rounds === 1 ? '' : 's'} · {new Date(tournament.eventDate).toLocaleDateString()}</span>
              <span>{tournament.playerCount ?? '—'} players{tournament.locked ? ' · locked' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  </main>
}
