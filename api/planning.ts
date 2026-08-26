import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import {
  confirmPlan,
  getPlanningBoard,
  listAssignments,
  listClubs,
  saveAssignments,
} from './_lib/db.js'
import { requireManager, sendError } from './_lib/shared.js'

const assignmentSchema = z.object({
  entityType: z.enum(['member', 'applicant']),
  entityId: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  position: z.number().int().nonnegative(),
})

const putSchema = z.object({
  assignments: z.array(assignmentSchema),
})

function validateAssignments(
  assignments: Array<{ entityType: string; entityId: string; destination: string; position: number }>,
  clubIds: string[],
) {
  const errors: string[] = []
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const item of assignments) {
    const key = `${item.entityType}:${item.entityId}`
    if (seen.has(key)) errors.push(`Duplicate assignment for ${key}.`)
    seen.add(key)
    if (clubIds.includes(item.destination)) {
      counts.set(item.destination, (counts.get(item.destination) || 0) + 1)
    } else if (!['waitlist', 'kick', 'unassigned', 'applicants'].includes(item.destination)) {
      errors.push(`Unknown destination ${item.destination}.`)
    }
  }
  for (const [clubId, count] of counts) {
    if (count > 30) errors.push(`Club ${clubId} has ${count} assignments; capacity is 30.`)
  }
  return errors
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireManager(request, response)
    if (!user) return

    const clubs = await listClubs(user.clubIds)
    const clubIds = clubs.map((club) => club.circleId)

    if (request.method === 'GET') {
      const [board, assignments] = await Promise.all([getPlanningBoard(), listAssignments()])
      return response.json({ board, assignments, clubs, user })
    }

    if (request.method === 'PUT') {
      const input = putSchema.parse(request.body)
      const errors = validateAssignments(input.assignments, clubIds)
      if (errors.length) return response.status(400).json({ error: errors.join(' ') })
      const assignments = await saveAssignments(input.assignments)
      const board = await getPlanningBoard()
      return response.json({ board, assignments })
    }

    if (request.method === 'POST') {
      const action = String(request.query.action || request.body?.action || 'confirm')
      if (action !== 'confirm') return response.status(400).json({ error: 'Unknown planning action.' })
      const current = await listAssignments()
      const errors = validateAssignments(current, clubIds)
      if (errors.length) return response.status(400).json({ error: errors.join(' ') })
      const result = await confirmPlan()
      return response.json(result)
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
