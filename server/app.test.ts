import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createStore, type Store } from './db.js'

let store: Store | undefined
afterEach(() => store?.close())

describe('local API', () => {
  it('resolves and normalizes an applicant before storing it', async () => {
    store = createStore(':memory:')
    store.upsertClub({
      circleId: '100', name: 'Main', dailyTarget: 1000,
      promotionRatio: 1.25, severeRatio: 0.5, inactiveDays: 3, promotionEnabled: true,
    })
    const uma = {
      resolveApplicant: async () => ({
        ign: 'Resolved IGN', currentClubId: '200', currentClubName: 'Old Club',
        lastUpdatedAt: '2026-07-31T00:00:00Z', totalFans: 2000,
        monthlyGain: 1000, dailyAverage: 500, todayGain: 600, dailyGains: [400, 600],
      }),
    }
    const response = await request(createApp(store, uma as never))
      .post('/api/applicants')
      .send({
        umaId: '123456789', ign: 'Ignored', targetClubId: '100',
        status: 'pending', privateNotes: 'private', publishPublicly: true,
      })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      umaId: '123456789', ign: 'Resolved IGN', currentClubName: 'Old Club', dailyAverage: 500,
    })
  })

  it('rejects an applicant for an unknown club', async () => {
    store = createStore(':memory:')
    const response = await request(createApp(store, {} as never))
      .post('/api/applicants')
      .send({ umaId: '123', targetClubId: 'missing', status: 'pending', publishPublicly: true })
    expect(response.status).toBe(400)
  })
})
