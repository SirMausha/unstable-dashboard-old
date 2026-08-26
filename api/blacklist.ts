import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import {
  addBlacklistEntry,
  deleteBlacklistEntry,
  listBlacklist,
} from './_lib/db.js'
import { requireManager, sendError } from './_lib/shared.js'

const createSchema = z.object({
  umaId: z.string().trim().regex(/^\d+$/, 'Uma ID must contain only digits.'),
  discordUsername: z.string().trim().min(2).max(64),
  reason: z.string().trim().max(2000).default(''),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireManager(request, response)
    if (!user) return

    if (request.method === 'GET') {
      const entries = await listBlacklist()
      return response.json({ entries, user })
    }

    if (request.method === 'POST') {
      const input = createSchema.parse(request.body)
      const entry = await addBlacklistEntry({
        umaId: input.umaId,
        discordUsername: input.discordUsername,
        reason: input.reason,
        createdBy: user.label || user.globalName || user.username,
      })
      return response.status(201).json(entry)
    }

    if (request.method === 'DELETE') {
      const id = Number(request.query.id || request.body?.id)
      if (!Number.isInteger(id) || id <= 0) {
        return response.status(400).json({ error: 'id is required.' })
      }
      const deleted = await deleteBlacklistEntry(id)
      return response.status(deleted ? 204 : 404).end()
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
