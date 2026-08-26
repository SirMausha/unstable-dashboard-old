import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { characterLabel, findCharacter } from '../_lib/characters.js'
import {
  clearTournamentPick,
  getTournamentBoard,
  listTournamentsForUser,
  saveTournamentPick,
} from '../_lib/db.js'
import { requireUser, sendError } from '../_lib/shared.js'

const pickSchema = z.object({
  tournamentId: z.number().int().positive(),
  playerId: z.number().int().positive(),
  round: z.number().int().positive(),
  characterId: z.string().trim().min(1).nullable(),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireUser(request, response)
    if (!user) return

    if (request.method === 'GET') {
      const id = Number(request.query.id)
      if (Number.isInteger(id) && id > 0) {
        const board = await getTournamentBoard(id)
        if (!board) return response.status(404).json({ error: 'Tournament not found.' })
        const onRoster = board.players.some((player) => player.discordId === user.discordId)
        if (!user.isManager && !onRoster) {
          return response.status(403).json({ error: 'You are not on this tournament roster.' })
        }
        return response.json({
          ...board,
          canEditAll: Boolean(user.isManager),
          locked: board.tournament.locked,
          user,
        })
      }

      const tournaments = await listTournamentsForUser(user.discordId, Boolean(user.isManager))
      return response.json({ tournaments, user })
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const input = pickSchema.parse(request.body)
      const updatedBy = user.label || user.globalName || user.username

      if (input.characterId == null || input.characterId === '') {
        await clearTournamentPick({
          tournamentId: input.tournamentId,
          playerId: input.playerId,
          round: input.round,
          actorDiscordId: user.discordId,
          isManager: Boolean(user.isManager),
        })
        return response.json({ ok: true, cleared: true })
      }

      const character = findCharacter(input.characterId)
      if (!character) return response.status(400).json({ error: 'Unknown character selection.' })

      const pick = await saveTournamentPick({
        tournamentId: input.tournamentId,
        playerId: input.playerId,
        round: input.round,
        characterId: character.id,
        characterName: character.characterName,
        updatedBy,
        actorDiscordId: user.discordId,
        isManager: Boolean(user.isManager),
      })

      return response.json({
        ok: true,
        pick: {
          ...pick,
          label: characterLabel(character),
        },
      })
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
