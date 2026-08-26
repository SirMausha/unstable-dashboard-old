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
} from './performance.js'

export class UmaClient {
  private readonly key: string
  private readonly circles = new Map<string, Promise<any>>()

  constructor(key = process.env.UMA_API_KEY || process.env.UMA_MOE_API_KEY || '') {
    this.key = key.trim()
  }

  private async request<T>(url: string): Promise<T> {
    if (!this.key) throw new Error('UMA_API_KEY is not configured.')
    const response = await fetch(url, {
      headers: { 'X-API-Key': this.key, Authorization: `Bearer ${this.key}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      if (response.status === 404) throw new Error('Not found on uma.moe.')
      if (response.status === 401 || response.status === 403) throw new Error('uma.moe rejected this API key.')
      throw new Error(`uma.moe returned ${response.status}.`)
    }
    return response.json() as Promise<T>
  }

  clearCache() {
    this.circles.clear()
  }

  getCircle(circleId: string): Promise<any> {
    if (!this.circles.has(circleId)) {
      this.circles.set(circleId, this.request(`https://uma.moe/api/v4/circles?circle_id=${encodeURIComponent(circleId)}`))
    }
    return this.circles.get(circleId)!
  }

  getProfile(umaId: string): Promise<any> {
    return this.request(`https://uma.moe/api/v4/user/profile/${encodeURIComponent(umaId)}`)
  }

  async resolveApplicant(umaId: string) {
    const root = await this.getProfile(umaId)
    const trainer = root?.trainer ?? root?.user ?? root?.profile ?? root
    const month = pickCurrentMonthRecord(root?.fan_history?.monthly)
    const circle = root?.circle ?? trainer?.circle ?? root?.club
    const ign = trainer?.name ?? trainer?.trainer_name ?? month?.trainer_name
    if (!ign) throw new Error(`Trainer ${umaId} was not found on uma.moe.`)
    let member: any = null
    let loadedClubName: string | null = null
    let currentClubId: string | null = null
    for (const circleId of applicantCircleCandidates(root)) {
      const circleData = await this.getCircle(circleId)
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

  async resolveClub(club: {
    circleId: string
    dailyTarget: number
    promotionRatio: number
    severeRatio: number
    inactiveDays: number
    promotionEnabled?: boolean
  }) {
    const data = await this.getCircle(club.circleId)
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
    return {
      circle: {
        name: data?.circle?.name || club.circleId,
        sourceUpdatedAt: data?.circle?.last_updated ?? null,
        rank: data?.circle?.live_rank || data?.circle?.monthly_rank || null,
        lastMonthRank: data?.circle?.last_month_rank ?? null,
      },
      members,
    }
  }
}
