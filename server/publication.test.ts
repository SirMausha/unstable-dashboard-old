import { afterEach, describe, expect, it } from 'vitest'
import { createStore, type Store } from './db.js'
import { assertPublicPayload, buildPublicInput, validateAssignments } from './publication.js'

let store: Store | undefined
afterEach(() => store?.close())

describe('public export and planning validation', () => {
  it('exports only allowlisted applicant fields', () => {
    store = createStore(':memory:')
    store.upsertClub({
      circleId: '123', name: 'Main', dailyTarget: 1000,
      promotionRatio: 1.25, severeRatio: 0.5, inactiveDays: 3, promotionEnabled: false,
    })
    store.upsertApplicant({
      umaId: '456', ign: 'Runner', targetClubId: '123', status: 'waitlisted',
      privateNotes: 'Do not publish', publishPublicly: true,
    })
    const exported = buildPublicInput(store)
    expect(JSON.stringify(exported)).not.toContain('Do not publish')
    expect(exported.applicants[0]).toEqual({
      umaId: '456', ign: 'Runner', targetClubId: '123',
      status: 'waitlisted', publishPublicly: true,
    })
  })

  it('rejects private-shaped fields recursively', () => {
    expect(() => assertPublicPayload({ applicant: { discordId: '1' } })).toThrow('Forbidden public field')
    expect(() => assertPublicPayload({ token: 'secret' })).toThrow('Forbidden public field')
  })

  it('rejects duplicates and club capacity overflow', () => {
    const duplicate = [
      { entityType: 'member', entityId: '1', destination: 'club', position: 0 },
      { entityType: 'member', entityId: '1', destination: 'club', position: 1 },
    ]
    expect(validateAssignments(duplicate, ['club']).join(' ')).toContain('Duplicate')
    const overflow = Array.from({ length: 31 }, (_, index) => ({
      entityType: 'member', entityId: String(index), destination: 'club', position: index,
    }))
    expect(validateAssignments(overflow, ['club']).join(' ')).toContain('capacity')
  })
})
