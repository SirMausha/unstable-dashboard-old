import { afterEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from './db.js'

let store: Store | undefined
afterEach(() => store?.close())

describe('member ownership across clubs', () => {
  it('allows the same trainer to move from one club roster to another', () => {
    store = createStore(':memory:')
    store.upsertClub({
      circleId: 'dust', name: 'Dust Bunny', dailyTarget: 1000,
      promotionRatio: 1.25, severeRatio: 0.5, inactiveDays: 3, promotionEnabled: true,
    })
    store.upsertClub({
      circleId: 'dirt', name: 'Dirt Bunny', dailyTarget: 1000,
      promotionRatio: 1.25, severeRatio: 0.5, inactiveDays: 3, promotionEnabled: true,
    })

    const sensaw = {
      umaId: 'sensaw', ign: 'Sensaw', lastUpdatedAt: '2026-08-01T00:00:00Z',
      totalFans: 1000, monthlyGain: 100, dailyAverage: 50, todayGain: 10,
      dailyGains: [10], band: 'under', reason: '50%',
    }

    store.replaceMembers('dust', { name: 'Dust Bunny' }, [sensaw])
    expect(store.getMembers()).toHaveLength(1)
    expect(store.getMembers()[0].circleId).toBe('dust')

    store.replaceMembers('dirt', { name: 'Dirt Bunny' }, [sensaw])
    const members = store.getMembers()
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ umaId: 'sensaw', circleId: 'dirt' })
  })
})
