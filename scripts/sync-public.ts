import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { applicantCircleCandidates, applicantClubName, getActiveCutoffMs, getFullPeriodFanStats, getTodayFanGain, isMemberActive, pickCurrentMonthRecord, withMonthSummary } from '../server/performance.js'

const inputSchema = z.object({
  schemaVersion: z.literal(1),
  clubs: z.array(z.object({
    circleId: z.string().min(1),
    name: z.string().min(1),
    dailyTarget: z.number().nonnegative(),
    promotionRatio: z.number().positive().default(1.25),
    severeRatio: z.number().min(0).max(1).default(0.5),
    inactiveDays: z.number().int().positive().default(3),
    promotionEnabled: z.boolean().default(true),
    rankGrade: z.enum(['ss', 'splus', 's', 'aplus', 'a', 'bplus', 'b']).nullable().optional(),
  })),
  applicants: z.array(z.object({
    umaId: z.string().min(1),
    ign: z.string().min(1),
    targetClubId: z.string().min(1),
    status: z.enum(['pending', 'approved', 'waitlisted', 'rejected']),
    publishPublicly: z.literal(true),
  })),
})

type CircleMember = {
  viewer_id?: string | number
  trainer_name?: string
  daily_fans?: number[]
  last_updated?: string | null
}

type CirclePayload = {
  circle?: {
    circle_id?: string | number
    name?: string
    live_rank?: number
    monthly_rank?: number
    last_month_rank?: number
    yesterday_rank?: number
    live_points?: number
    yesterday_points?: number
    monthly_point?: number
    last_updated?: string
    last_live_update?: string
  }
  members?: CircleMember[]
}

const key = String(process.env.UMA_API_KEY || process.env.UMA_MOE_API_KEY || '').trim()
if (!key) throw new Error('UMA_API_KEY is required to refresh public data.')

const headers = { 'X-API-Key': key, Authorization: `Bearer ${key}` }
const inputPath = path.resolve(process.env.PUBLIC_INPUT_PATH || 'public-data/input.json')
const outputPath = path.resolve(process.env.PUBLIC_OUTPUT_PATH || 'public/data/dashboard.json')
const input = inputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))

async function fetchUma<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`uma.moe returned ${response.status} for ${url}`)
  return response.json() as Promise<T>
}

function fanStats(raw: number[] = []) {
  const values = raw.filter(Number.isFinite)
  const lastPositive = values.reduce((found, value, index) => value > 0 ? index : found, -1)
  if (lastPositive < 0) {
    return { totalFans: 0, monthlyGain: 0, dailyAverage: 0, todayGain: 0, dailyGains: [] as number[] }
  }

  const trimmed = values.slice(0, lastPositive + 1)
  const lastNegative = trimmed.reduce((found, value, index) => value < 0 ? index : found, -1)
  let cumulative: number[]
  if (lastNegative >= 0) {
    const baseline = Math.abs(trimmed[lastNegative])
    const tracked = trimmed.slice(lastNegative + 1).filter((value) => value > 0)
    cumulative = [baseline]
    for (const value of tracked) cumulative.push(value)
  } else {
    const start = trimmed.findIndex((value) => value > 0)
    cumulative = start < 0 ? [] : trimmed.slice(start).reduce<number[]>((result, value) => {
      result.push(value > 0 ? value : (result.at(-1) ?? 0))
      return result
    }, [])
  }

  const first = cumulative[0] ?? 0
  const latest = cumulative.at(-1) ?? first
  const dailyGains = cumulative.slice(1).map((value, index) => Math.max(0, value - cumulative[index]))
  return {
    totalFans: latest,
    monthlyGain: Math.max(0, latest - first),
    dailyAverage: Math.round(Math.max(0, latest - first) / Math.max(1, cumulative.length - 1)),
    todayGain: dailyGains.at(-1) ?? 0,
    dailyGains,
  }
}

function classify(
  average: number,
  updatedAt: string | null | undefined,
  club: z.infer<typeof inputSchema>['clubs'][number],
) {
  const staleDays = updatedAt
    ? Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY
  if (staleDays >= club.inactiveDays) {
    return { band: 'inactive', reason: `No update for ${Math.floor(staleDays)} days` }
  }
  const ratio = club.dailyTarget > 0 ? average / club.dailyTarget : 1
  if (club.promotionEnabled !== false && ratio >= club.promotionRatio) {
    return { band: 'promotion', reason: `${Math.round(ratio * 100)}% of daily requirement` }
  }
  if (ratio >= 0.9) return { band: 'meeting', reason: `${Math.round(ratio * 100)}% of daily requirement` }
  if (ratio < club.severeRatio) {
    return { band: 'severe', reason: `${Math.round(ratio * 100)}% of daily requirement` }
  }
  return { band: 'under', reason: `${Math.round(ratio * 100)}% of daily requirement` }
}

const circleCache = new Map<string, Promise<CirclePayload>>()
function getCircle(circleId: string) {
  if (!circleCache.has(circleId)) {
    circleCache.set(
      circleId,
      fetchUma<CirclePayload>(`https://uma.moe/api/v4/circles?circle_id=${encodeURIComponent(circleId)}`),
    )
  }
  return circleCache.get(circleId)!
}

const clubs = []
for (const configured of input.clubs) {
  const data = await getCircle(configured.circleId)
  const roster = data.members || []
  const cutoff = getActiveCutoffMs(roster)
  const members = roster
    .filter((member) => isMemberActive(member, cutoff))
    .map((member) => {
      const metrics = fanStats(member.daily_fans)
      return {
        umaId: String(member.viewer_id ?? ''),
        ign: member.trainer_name || 'Unknown',
        lastUpdatedAt: member.last_updated || null,
        ...metrics,
        ...classify(metrics.dailyAverage, member.last_updated, configured),
      }
    }).filter((member) => member.umaId)

  const circle = data.circle
  const liveRank = circle?.live_rank ?? circle?.monthly_rank ?? null
  const yesterdayRank = circle?.yesterday_rank ?? null
  const livePoints = typeof circle?.live_points === 'number' ? circle.live_points : null
  const yesterdayPoints = typeof circle?.yesterday_points === 'number' ? circle.yesterday_points : null
  const monthlyFans = livePoints ?? (typeof circle?.monthly_point === 'number' ? circle.monthly_point : null)

  clubs.push({
    circleId: configured.circleId,
    name: data.circle?.name || configured.name,
    rank: liveRank,
    yesterdayRank,
    rankDelta: liveRank != null && yesterdayRank != null ? yesterdayRank - liveRank : null,
    lastMonthRank: data.circle?.last_month_rank || null,
    monthlyFans,
    fansSinceYesterday:
      livePoints != null && yesterdayPoints != null ? livePoints - yesterdayPoints : null,
    rankGrade: configured.rankGrade ?? null,
    dailyTarget: configured.dailyTarget,
    promotionRatio: configured.promotionRatio,
    severeRatio: configured.severeRatio,
    inactiveDays: configured.inactiveDays,
    sourceUpdatedAt: circle?.last_live_update || circle?.last_updated || null,
    members,
  })
}

const applicants = []
for (const configured of input.applicants) {
  const profile = await fetchUma<Record<string, unknown>>(
    `https://uma.moe/api/v4/user/profile/${encodeURIComponent(configured.umaId)}`,
  )
  const trainer = profile.trainer as Record<string, unknown> | undefined
  const circle = profile.circle as Record<string, unknown> | undefined
  const month = pickCurrentMonthRecord(
    (profile.fan_history as { monthly?: Array<Record<string, unknown>> } | undefined)?.monthly,
  )
  let member: CircleMember | undefined
  let loadedClubName: string | null = null
  let currentCircleId = ''
  for (const circleId of applicantCircleCandidates(profile as { fan_history?: { monthly?: unknown }; circle?: { circle_id?: string | number | null } })) {
    const circleData = await getCircle(circleId)
    const found = circleData.members?.find((entry) => String(entry.viewer_id) === configured.umaId)
    if (found) {
      member = found
      currentCircleId = circleId
      loadedClubName = circleData.circle?.name || null
      break
    }
  }
  const stats = withMonthSummary(getFullPeriodFanStats(member?.daily_fans), month)
  applicants.push({
    umaId: configured.umaId,
    ign: String(trainer?.name ?? month?.trainer_name ?? configured.ign),
    targetClubId: configured.targetClubId,
    status: configured.status,
    currentClubId: currentCircleId || null,
    currentClubName: applicantClubName(month, circle as { name?: string | null }, loadedClubName),
    lastUpdatedAt: member?.last_updated || null,
    totalFans: stats.totalFans,
    monthlyGain: stats.monthlyGain,
    dailyAverage: stats.dailyAverage,
    todayGain: getTodayFanGain(member?.daily_fans),
    dailyGains: stats.dailyGains,
  })
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'uma.moe',
  clubs,
  applicants,
}

const forbidden = /discord|token|secret|password|privateNote|databasePath/i
function assertSanitized(value: unknown, keyPath = 'root'): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSanitized(item, `${keyPath}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [field, child] of Object.entries(value)) {
    if (forbidden.test(field)) throw new Error(`Forbidden public field: ${keyPath}.${field}`)
    assertSanitized(child, `${keyPath}.${field}`)
  }
}

assertSanitized(output)
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Public dashboard refreshed: ${clubs.length} clubs, ${applicants.length} applicants.`)
