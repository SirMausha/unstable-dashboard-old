import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { findBlacklistMatch, upsertApplicant } from './_lib/db.js'
import { notifyApplication } from './_lib/discord.js'
import { loadClubs, resolveUmaProfile, sendError } from './_lib/shared.js'

const applySchema = z.object({
  umaId: z.string().trim().regex(/^\d+$/, 'Uma ID must contain only digits.'),
  discordUsername: z.string().trim().min(2).max(64),
  targetClubId: z.string().trim().min(1),
  notes: z.string().trim().max(2000).default(''),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method === 'GET') {
      const clubs = await loadClubs()
      return response.json({
        clubs: clubs.map((club) => ({ circleId: club.circleId, name: club.name })),
      })
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })

    const input = applySchema.parse(request.body)
    const clubs = await loadClubs()
    const club = clubs.find((item) => item.circleId === input.targetClubId)
    if (!club) return response.status(400).json({ error: 'Selected club is not accepting applications.' })

    const blocked = await findBlacklistMatch(input.umaId, input.discordUsername)
    if (blocked) {
      return response.status(403).json({ error: 'This trainer cannot apply to Bunny clubs.' })
    }

    const profile = await resolveUmaProfile(input.umaId)
    const applicant = await upsertApplicant({
      umaId: input.umaId,
      ign: profile.ign,
      discordUsername: input.discordUsername,
      targetClubId: input.targetClubId,
      status: 'pending',
      privateNotes: input.notes,
      publishPublicly: true,
      currentClubId: profile.currentClubId,
      currentClubName: profile.currentClubName,
      lastUpdatedAt: profile.lastUpdatedAt,
      totalFans: profile.totalFans,
      monthlyGain: profile.monthlyGain,
      dailyAverage: profile.dailyAverage,
      todayGain: profile.todayGain,
      dailyGains: profile.dailyGains,
    })

    await notifyApplication({
      ign: applicant.ign,
      umaId: applicant.umaId,
      discordUsername: input.discordUsername,
      clubName: club.name,
      dailyAverage: profile.dailyAverage,
      monthlyGain: profile.monthlyGain,
      dailyGains: profile.dailyGains,
      notes: input.notes,
      currentClubName: profile.currentClubName,
    })

    return response.status(201).json({
      ok: true,
      applicant: {
        umaId: applicant.umaId,
        ign: applicant.ign,
        targetClubId: applicant.targetClubId,
        status: applicant.status,
      },
    })
  } catch (error) {
    return sendError(response, error)
  }
}
