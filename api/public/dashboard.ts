import type { VercelRequest, VercelResponse } from '@vercel/node'
import { listPublicApplicants } from '../_lib/db.js'
import { buildPublicClub, loadClubs, sendError } from '../_lib/shared.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' })
    const clubConfigs = await loadClubs()
    const clubs = []
    for (const club of clubConfigs) {
      try {
        clubs.push(await buildPublicClub(club))
      } catch (error) {
        console.error(`Failed to load club ${club.circleId}`, error)
        clubs.push({ ...club, members: [], rank: null, yesterdayRank: null, rankDelta: null, lastMonthRank: null, monthlyFans: null, fansSinceYesterday: null, rankGrade: null, sourceUpdatedAt: null })
      }
    }
    const applicants = await listPublicApplicants()
    return response.json({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'uma.moe',
      clubs,
      applicants,
    })
  } catch (error) {
    return sendError(response, error)
  }
}
