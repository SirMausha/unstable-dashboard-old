import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  applicantCircleCandidates,
  applicantClubName,
  classifyPerformance,
  getActiveCutoffMs,
  getFullPeriodFanStats,
  getMemberFanStats,
  getTodayFanGain,
  isMemberActive,
  pickCurrentMonthRecord,
  withMonthSummary,
} from '../../server/performance.js'

export type ClubConfig = {
  circleId: string
  name: string
  dailyTarget: number
  promotionRatio: number
  severeRatio: number
  inactiveDays: number
  promotionEnabled?: boolean
  rankGrade?: string | null
}

export function readClubs(): ClubConfig[] {
  const file = path.join(process.cwd(), 'config', 'clubs.json')
  const payload = JSON.parse(readFileSync(file, 'utf8')) as { clubs: ClubConfig[] }
  return payload.clubs
}

/** Prefer Neon club settings (seeded from config); fall back to config file if DB is unavailable. */
export async function loadClubs(clubIds?: string[]): Promise<ClubConfig[]> {
  try {
    const { listClubs } = await import('./db.js')
    const rows = await listClubs(clubIds)
    if (rows.length) {
      return rows.map((club) => ({
        circleId: club.circleId,
        name: club.name,
        dailyTarget: club.dailyTarget,
        promotionRatio: club.promotionRatio,
        severeRatio: club.severeRatio,
        inactiveDays: club.inactiveDays,
        promotionEnabled: club.promotionEnabled,
        rankGrade: club.rankGrade,
      }))
    }
  } catch (error) {
    console.error('Failed to load clubs from database; using config file.', error)
  }
  const fallback = readClubs()
  if (clubIds?.length) return fallback.filter((club) => clubIds.includes(club.circleId))
  return fallback
}

export async function fetchUmaJson<T>(url: string): Promise<T> {
  const key = String(process.env.UMA_API_KEY || process.env.UMA_MOE_API_KEY || '').trim()
  if (!key) throw new Error('UMA_API_KEY is not configured.')
  const response = await fetch(url, {
    headers: { 'X-API-Key': key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    if (response.status === 404) throw new Error('Not found on uma.moe.')
    if (response.status === 401 || response.status === 403) throw new Error('uma.moe rejected this API key.')
    throw new Error(`uma.moe returned ${response.status}.`)
  }
  return response.json() as Promise<T>
}

export async function resolveUmaProfile(umaId: string) {
  const root = await fetchUmaJson<any>(`https://uma.moe/api/v4/user/profile/${encodeURIComponent(umaId)}`)
  const trainer = root?.trainer ?? root?.user ?? root?.profile ?? root
  const month = pickCurrentMonthRecord(root?.fan_history?.monthly)
  const circle = root?.circle ?? trainer?.circle ?? root?.club
  const ign = trainer?.name ?? trainer?.trainer_name ?? month?.trainer_name
  if (!ign) throw new Error(`Trainer ${umaId} was not found on uma.moe.`)
  let member: any = null
  let loadedClubName: string | null = null
  let currentClubId: string | null = null
  for (const circleId of applicantCircleCandidates(root)) {
    const circleData = await fetchUmaJson<any>(`https://uma.moe/api/v4/circles?circle_id=${encodeURIComponent(circleId)}`)
    const found = (circleData?.members || []).find((item: any) => String(item.viewer_id) === String(umaId))
    if (found) {
      member = found
      currentClubId = circleId
      loadedClubName = circleData?.circle?.name ?? null
      break
    }
  }
  const stats = withMonthSummary(getFullPeriodFanStats(member?.daily_fans), month)
  return {
    ign: String(ign),
    currentClubId,
    currentClubName: applicantClubName(month, circle, loadedClubName),
    lastUpdatedAt: member?.last_updated ?? null,
    totalFans: stats.totalFans,
    monthlyGain: stats.monthlyGain,
    dailyAverage: stats.dailyAverage,
    todayGain: getTodayFanGain(member?.daily_fans),
    dailyGains: stats.dailyGains,
  }
}

export async function buildPublicClub(club: ClubConfig) {
  const data = await fetchUmaJson<any>(`https://uma.moe/api/v4/circles?circle_id=${encodeURIComponent(club.circleId)}`)
  const circle = data?.circle || {}
  const roster = data?.members || []
  const cutoff = getActiveCutoffMs(roster)
  const members = roster
    .filter((member: any) => isMemberActive(member, cutoff))
    .map((member: any) => {
      const stats = getMemberFanStats(member.daily_fans)
      const decision = classifyPerformance({
        dailyAverage: stats.dailyAverage,
        dailyTarget: club.dailyTarget,
        lastUpdatedAt: member.last_updated,
        promotionRatio: club.promotionRatio,
        severeRatio: club.severeRatio,
        inactiveDays: club.inactiveDays,
        promotionEnabled: club.promotionEnabled !== false,
      })
      return {
        umaId: String(member.viewer_id),
        ign: member.trainer_name || 'Unknown',
        lastUpdatedAt: member.last_updated ?? null,
        totalFans: stats.totalFans,
        monthlyGain: stats.monthlyGain,
        dailyAverage: stats.dailyAverage,
        todayGain: getTodayFanGain(member.daily_fans),
        dailyGains: stats.dailyGains,
        band: decision.band,
        reason: decision.reason,
      }
    })

  const liveRank = circle.live_rank ?? circle.monthly_rank ?? null
  const yesterdayRank = circle.yesterday_rank ?? null
  const livePoints = typeof circle.live_points === 'number' ? circle.live_points : null
  const yesterdayPoints = typeof circle.yesterday_points === 'number' ? circle.yesterday_points : null
  const monthlyFans = livePoints ?? (typeof circle.monthly_point === 'number' ? circle.monthly_point : null)
  const rankDelta =
    liveRank != null && yesterdayRank != null ? yesterdayRank - liveRank : null

  const built = {
    ...club,
    rank: liveRank,
    yesterdayRank,
    rankDelta,
    lastMonthRank: circle.last_month_rank ?? null,
    monthlyFans,
    fansSinceYesterday:
      livePoints != null && yesterdayPoints != null ? livePoints - yesterdayPoints : null,
    rankGrade: club.rankGrade || null,
    sourceUpdatedAt: circle.last_live_update ?? circle.last_updated ?? null,
    members,
  }

  try {
    const { recordManagedRoster } = await import('./db.js')
    await recordManagedRoster(
      club.circleId,
      members.map((member: { umaId: string; ign: string }) => ({ umaId: member.umaId, ign: member.ign })),
    )
  } catch (error) {
    console.error(`Failed to persist roster for ${club.circleId}`, error)
  }

  return built
}
