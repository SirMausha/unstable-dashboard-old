import type { Band } from './types'

export const MEETING_RATIO = 0.9

export function assessMember(input: {
  dailyAverage: number
  dailyTarget: number
  lastUpdatedAt?: string | null
  promotionRatio?: number
  meetingRatio?: number
  severeRatio?: number
  inactiveDays?: number
  promotionEnabled?: boolean
  now?: Date
}): { band: Band; reason: string } {
  const {
    dailyAverage,
    dailyTarget,
    lastUpdatedAt,
    promotionRatio = 1.25,
    meetingRatio = MEETING_RATIO,
    severeRatio = 0.5,
    inactiveDays = 3,
    promotionEnabled = true,
    now = new Date(),
  } = input
  const updatedMs = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : Number.NaN
  const staleDays = Number.isFinite(updatedMs)
    ? Math.max(0, (now.getTime() - updatedMs) / 86_400_000)
    : Number.POSITIVE_INFINITY
  if (staleDays >= inactiveDays) {
    return { band: 'inactive', reason: `No update for ${Math.floor(staleDays)} days` }
  }
  const ratio = dailyTarget > 0 ? dailyAverage / dailyTarget : 1
  const reason = `${Math.round(ratio * 100)}% of daily requirement`
  if (promotionEnabled && ratio >= promotionRatio) return { band: 'promotion', reason }
  if (ratio >= meetingRatio) return { band: 'meeting', reason }
  if (ratio < severeRatio) return { band: 'severe', reason }
  return { band: 'under', reason }
}
