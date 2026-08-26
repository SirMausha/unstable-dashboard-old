import { describe, expect, it } from 'vitest'
import { applicantCircleCandidates, classifyPerformance, getEffectiveJstPeriod, getFullPeriodFanStats, getMemberFanStats, isMemberActive, pickCurrentMonthRecord } from './performance.js'

describe('performance calculations', () => {
  it('uses the previous JST month before day two', () => {
    expect(getEffectiveJstPeriod(new Date('2026-07-31T16:00:00Z'))).toEqual({ year: 2026, month: 6 })
    expect(getEffectiveJstPeriod(new Date('2026-07-31T14:00:00Z'))).toEqual({ year: 2026, month: 6 })
  })

  it('handles a negative club-transfer baseline', () => {
    expect(getMemberFanStats([-1000, 0, 1400, 1900])).toMatchObject({
      dailyFans: [1000, 1400, 1900],
      monthlyGain: 900,
      dailyAverage: 450,
    })
  })

  it('uses this month’s club before the leftover previous-club circle', () => {
    const root = {
      circle: { circle_id: 'old', name: 'VodkaToes' },
      fan_history: {
        monthly: [
          { year: 2026, month: 8, circle_id: 'dirt', circle_name: 'Dirt Bunny', monthly_gain: 100 },
          { year: 2026, month: 7, circle_id: 'old', circle_name: 'VodkaToes', monthly_gain: 50 },
        ],
      },
    }
    expect(pickCurrentMonthRecord(root.fan_history.monthly, new Date('2026-08-10T00:00:00+09:00'))).toMatchObject({
      circle_id: 'dirt',
      month: 8,
    })
    expect(applicantCircleCandidates(root, new Date('2026-08-10T00:00:00+09:00'))).toEqual(['dirt', 'old'])
  })

  it('keeps previous-club days in the applicant month chart', () => {
    expect(getFullPeriodFanStats([-1518, -1521, 1682, 1747])).toMatchObject({
      dailyFans: [1518, 1521, 1682, 1747],
      monthlyGain: 229,
    })
    expect(getMemberFanStats([-1518, -1521, 1682, 1747])).toMatchObject({
      dailyFans: [1521, 1682, 1747],
      monthlyGain: 226,
    })
  })

  it('explains target and inactivity classifications', () => {
    expect(classifyPerformance({
      dailyAverage: 130, dailyTarget: 100, lastUpdatedAt: '2026-07-31T00:00:00Z',
      now: new Date('2026-08-01T00:00:00Z'),
    }).band).toBe('promotion')
    expect(classifyPerformance({
      dailyAverage: 500, dailyTarget: 100, lastUpdatedAt: '2026-07-20T00:00:00Z',
      now: new Date('2026-08-01T00:00:00Z'),
    }).band).toBe('inactive')
    expect(classifyPerformance({
      dailyAverage: 200, dailyTarget: 100, lastUpdatedAt: '2026-07-31T00:00:00Z',
      promotionEnabled: false, now: new Date('2026-08-01T00:00:00Z'),
    }).band).toBe('meeting')
    expect(classifyPerformance({
      dailyAverage: 91, dailyTarget: 100, lastUpdatedAt: '2026-07-31T00:00:00Z',
      now: new Date('2026-08-01T00:00:00Z'),
    }).band).toBe('meeting')
    expect(classifyPerformance({
      dailyAverage: 89, dailyTarget: 100, lastUpdatedAt: '2026-07-31T00:00:00Z',
      now: new Date('2026-08-01T00:00:00Z'),
    }).band).toBe('under')
  })

  it('treats transferred trainers with zeroed calendar slots as inactive', () => {
    const now = new Date('2026-08-01T17:00:00Z') // JST Aug 2
    const fans = Array.from({ length: 31 }, () => 0)
    expect(isMemberActive({ daily_fans: fans, last_updated: '2026-08-02T00:00:00Z' }, null, now)).toBe(false)
    fans[1] = 1200
    fans[0] = 1100
    expect(isMemberActive({ daily_fans: fans, last_updated: '2026-08-02T00:00:00Z' }, null, now)).toBe(true)
  })
})
