import { describe, expect, it } from 'vitest'
import { bunnyHistoryStints } from './tenure.js'

describe('bunny network tenure', () => {
  it('counts unique months across club transfers and splits stints', () => {
    const bunny = new Set(['dust', 'dirt'])
    const result = bunnyHistoryStints([
      { year: 2026, month: 3, circle_id: 'dust', circle_name: 'Dust Bunny' },
      { year: 2026, month: 4, circle_id: 'dust', circle_name: 'Dust Bunny' },
      { year: 2026, month: 5, circle_id: 'dirt', circle_name: 'Dirt Bunny' },
      { year: 2026, month: 5, circle_id: 'other', circle_name: 'Elsewhere' },
    ], bunny)
    expect(result.uniqueMonths).toBe(3)
    expect(result.stints).toHaveLength(2)
    expect(result.stints[0]).toMatchObject({ circleId: 'dust', monthCount: 2, startMonth: 3, endMonth: 4 })
    expect(result.stints[1]).toMatchObject({ circleId: 'dirt', monthCount: 1, startMonth: 5 })
  })

  it('starts a new stint after a gap outside the network', () => {
    const bunny = new Set(['dust'])
    const result = bunnyHistoryStints([
      { year: 2026, month: 1, circle_id: 'dust', circle_name: 'Dust Bunny' },
      { year: 2026, month: 3, circle_id: 'dust', circle_name: 'Dust Bunny' },
    ], bunny)
    expect(result.uniqueMonths).toBe(2)
    expect(result.stints).toHaveLength(2)
  })
})
