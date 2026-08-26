import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { listClubs, listMemberDirectory, listMemberLinks, getMemberProfileRecord, updateClub, upsertMemberLink } from './_lib/db.js'
import { fetchUmaJson, requireManager, sendError } from './_lib/shared.js'
import { bunnyHistoryStints } from './_lib/tenure.js'

const rankGrades = ['ss', 'splus', 's', 'aplus', 'a', 'bplus', 'b'] as const

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  dailyTarget: z.number().int().nonnegative(),
  promotionRatio: z.number().positive(),
  severeRatio: z.number().min(0).max(1),
  inactiveDays: z.number().int().positive(),
  promotionEnabled: z.boolean(),
  rankGrade: z.enum(rankGrades).nullish(),
})

const linkSchema = z.object({
  link: z.literal(true),
  umaId: z.string().trim().regex(/^\d+$/, 'Uma ID must contain only digits.'),
  discordId: z.string().trim().max(32).optional().default(''),
})

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const user = await requireManager(request, response)
    if (!user) return

    if (request.method === 'GET') {
      const profileId = String(request.query.profile || '').trim()
      if (profileId) {
        const clubs = await listClubs(user.clubIds)
        const stored = (await getMemberProfileRecord(profileId)) || { profile: null, clubDays: [], tournaments: [] }
        const bunnyIds = new Set(clubs.map((club) => club.circleId))
        let umaName: string | null = stored.profile?.ign || null
        let history: Array<{ year?: number; month?: number; circle_id?: string | number | null; circle_name?: string | null }> = []
        try {
          const root = await fetchUmaJson<any>(`https://uma.moe/api/v4/user/profile/${encodeURIComponent(profileId)}`)
          umaName = root?.trainer?.name || umaName
          history = Array.isArray(root?.circle_history) ? root.circle_history : []
        } catch {
          // Keep stored rows if uma.moe is unavailable.
        }
        const tenure = bunnyHistoryStints(history, bunnyIds)
        const clubNames = new Map(clubs.map((club) => [club.circleId, club.name]))
        return response.json({
          umaId: profileId,
          ign: umaName || stored.profile?.ign || profileId,
          discordId: stored.profile?.discordId || null,
          status: stored.profile?.status || (tenure.uniqueMonths ? 'former' : 'unknown'),
          currentCircleId: stored.profile?.currentCircleId || null,
          currentClubName: stored.profile?.currentCircleId ? clubNames.get(stored.profile.currentCircleId) || null : null,
          lastCircleId: stored.profile?.lastCircleId || null,
          lastClubName: stored.profile?.lastCircleId ? clubNames.get(stored.profile.lastCircleId) || null : null,
          firstSeenOn: stored.profile?.firstSeenOn || null,
          lastSeenOn: stored.profile?.lastSeenOn || null,
          observedDays: stored.profile?.observedDays || 0,
          networkMonths: tenure.uniqueMonths,
          firstNetworkMonth: tenure.first ? `${tenure.first.year}-${String(tenure.first.month).padStart(2, '0')}` : null,
          lastNetworkMonth: tenure.last ? `${tenure.last.year}-${String(tenure.last.month).padStart(2, '0')}` : null,
          stints: tenure.stints.map((stint) => ({
            ...stint,
            circleName: clubNames.get(stint.circleId) || stint.circleName || stint.circleId,
          })),
          clubDays: stored.clubDays.map((row) => ({
            ...row,
            circleName: clubNames.get(row.circleId) || row.circleId,
          })),
          tournaments: stored.tournaments,
          umaMoeUrl: `https://uma.moe/profile/${encodeURIComponent(profileId)}`,
        })
      }
      const [clubs, memberLinks, directory] = await Promise.all([
        listClubs(user.clubIds),
        listMemberLinks(),
        listMemberDirectory(),
      ])
      return response.json({ clubs, memberLinks, directory, user, rankGrades })
    }

    if (request.method === 'PUT' || request.method === 'PATCH') {
      if (request.body?.link === true) {
        const input = linkSchema.parse(request.body)
        const saved = await upsertMemberLink(input.umaId, input.discordId || null)
        return response.json({ umaId: input.umaId, discordId: saved?.discordId || null })
      }
      const circleId = String(request.query.circleId || request.body?.circleId || '').trim()
      if (!circleId) return response.status(400).json({ error: 'circleId is required.' })
      if (!user.clubIds.includes(circleId)) {
        return response.status(403).json({ error: 'You do not manage that club.' })
      }
      const input = updateSchema.parse(request.body)
      const club = await updateClub(circleId, user.clubIds, {
        name: input.name,
        dailyTarget: input.dailyTarget,
        promotionRatio: input.promotionRatio,
        severeRatio: input.severeRatio,
        inactiveDays: input.inactiveDays,
        promotionEnabled: input.promotionEnabled,
        rankGrade: input.rankGrade ?? null,
      })
      if (!club) return response.status(404).json({ error: 'Club not found.' })
      return response.json(club)
    }

    return response.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    return sendError(response, error)
  }
}
