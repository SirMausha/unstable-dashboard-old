import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import {
  createTournament,
  deleteTournament,
  getTournamentBoard,
  listTournaments,
  replaceTournamentRoster,
  updateTournament,
  type TournamentDistance,
} from './_lib/db.js'
import { requireManager, sendError } from './_lib/shared.js'

const distances = ['sprint', 'mile', 'medium', 'long', 'dirt'] as const

const tournamentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  rounds: z.number().int().min(1).max(8),
  eventDate: z.string().trim().min(4),
})

const rosterSchema = z.object({
  players: z.array(z.object({
    discordId: z.string().trim().min(5).max(32),
    displayName: z.string().trim().min(1).max(64),
    team: z.number().int().min(1).max(8).default(1),
    distance: z.enum(distances),
    sortOrder: z.number().int().nonnegative().default(0),
    umaId: z.string().trim().regex(/^\d+$/).nullable().optional(),
  })),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireManager(request, response)
    if (!user) return

    if (request.method === 'GET') {
      const id = Number(request.query.id)
      if (Number.isInteger(id) && id > 0) {
        const board = await getTournamentBoard(id)
        if (!board) return response.status(404).json({ error: 'Tournament not found.' })
        return response.json({ ...board, user })
      }
      const tournaments = await listTournaments()
      return response.json({ tournaments, user })
    }

    if (request.method === 'POST') {
      const input = tournamentSchema.parse(request.body)
      const tournament = await createTournament(input)
      return response.status(201).json(tournament)
    }

    const id = Number(request.query.id || request.body?.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.status(400).json({ error: 'id is required.' })
    }

    if (request.method === 'PUT') {
      if (request.query.roster === '1' || request.body?.roster === true) {
        const input = rosterSchema.parse(request.body)
        const players = await replaceTournamentRoster(
          id,
          input.players.map((player, index) => ({
            ...player,
            distance: player.distance as TournamentDistance,
            sortOrder: player.sortOrder ?? index,
            umaId: player.umaId ?? null,
          })),
        )
        return response.json({ players })
      }
      const input = tournamentSchema.parse(request.body)
      const tournament = await updateTournament(id, input)
      if (!tournament) return response.status(404).json({ error: 'Tournament not found.' })
      return response.json(tournament)
    }

    if (request.method === 'DELETE') {
      const deleted = await deleteTournament(id)
      return response.status(deleted ? 204 : 404).end()
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
