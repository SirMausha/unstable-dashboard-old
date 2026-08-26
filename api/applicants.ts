import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import {
  deleteApplicant,
  listApplicants,
  updateApplicantFields,
  updateApplicantStatus,
  upsertApplicant,
} from './_lib/db.js'
import { requireManager, resolveUmaProfile, sendError } from './_lib/shared.js'

const createSchema = z.object({
  umaId: z.string().trim().regex(/^\d+$/, 'Uma ID must contain only digits.'),
  targetClubId: z.string().trim().min(1),
  status: z.enum(['pending', 'approved', 'waitlisted', 'rejected']).default('pending'),
  privateNotes: z.string().max(4000).default(''),
  publishPublicly: z.boolean().default(true),
  discordUsername: z.string().trim().max(64).default(''),
})

const patchSchema = z.object({
  status: z.enum(['pending', 'approved', 'waitlisted', 'rejected']).optional(),
  privateNotes: z.string().max(4000).optional(),
  publishPublicly: z.boolean().optional(),
  targetClubId: z.string().min(1).optional(),
  discordUsername: z.string().trim().max(64).optional(),
  refresh: z.boolean().optional(),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireManager(request, response)
    if (!user) return

    if (request.method === 'GET') {
      const applicants = await listApplicants(user.clubIds)
      return response.json({ applicants, user })
    }

    if (request.method === 'POST') {
      const input = createSchema.parse(request.body)
      if (!user.clubIds.includes(input.targetClubId)) {
        return response.status(403).json({ error: 'You do not manage that club.' })
      }
      const profile = await resolveUmaProfile(input.umaId)
      const applicant = await upsertApplicant({
        umaId: input.umaId,
        ign: profile.ign,
        discordUsername: input.discordUsername,
        targetClubId: input.targetClubId,
        status: input.status,
        privateNotes: input.privateNotes,
        publishPublicly: input.publishPublicly,
        currentClubId: profile.currentClubId,
        currentClubName: profile.currentClubName,
        lastUpdatedAt: profile.lastUpdatedAt,
        totalFans: profile.totalFans,
        monthlyGain: profile.monthlyGain,
        dailyAverage: profile.dailyAverage,
        todayGain: profile.todayGain,
        dailyGains: profile.dailyGains,
      })
      return response.status(201).json(applicant)
    }

    const umaId = String(request.query.umaId || request.body?.umaId || '').trim()
    if (!umaId) return response.status(400).json({ error: 'umaId is required.' })

    if (request.method === 'DELETE') {
      const deleted = await deleteApplicant(umaId, user.clubIds)
      return response.status(deleted ? 204 : 404).end()
    }

    if (request.method === 'PATCH' || request.method === 'PUT') {
      const input = patchSchema.parse(request.body || {})
      if (input.refresh) {
        const currentList = await listApplicants(user.clubIds)
        const current = currentList.find((item) => item.umaId === umaId)
        if (!current) return response.status(404).json({ error: 'Applicant not found.' })
        const profile = await resolveUmaProfile(umaId)
        const updated = await upsertApplicant({
          ...current,
          ...profile,
          discordUsername: input.discordUsername ?? current.discordUsername,
          targetClubId: input.targetClubId || current.targetClubId,
          status: input.status || current.status,
          privateNotes: input.privateNotes ?? current.privateNotes,
          publishPublicly: input.publishPublicly ?? current.publishPublicly,
        })
        return response.json(updated)
      }

      const hasFieldUpdate =
        input.status !== undefined
        || input.privateNotes !== undefined
        || input.publishPublicly !== undefined
        || input.targetClubId !== undefined
        || input.discordUsername !== undefined

      if (!hasFieldUpdate) return response.status(400).json({ error: 'Nothing to update.' })

      if (
        input.status !== undefined
        && input.privateNotes === undefined
        && input.publishPublicly === undefined
        && input.targetClubId === undefined
        && input.discordUsername === undefined
      ) {
        const updated = await updateApplicantStatus(umaId, input.status, user.clubIds)
        if (!updated) return response.status(404).json({ error: 'Applicant not found.' })
        return response.json(updated)
      }

      const updated = await updateApplicantFields(umaId, user.clubIds, input)
      if (!updated) return response.status(404).json({ error: 'Applicant not found.' })
      return response.json(updated)
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
