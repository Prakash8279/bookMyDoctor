import { describe, expect, it } from 'vitest'
import { inIndiaDateRange, isIndiaDateRangeValid } from './indiaDateRange'

describe('India date ranges', () => {
  it('filters UTC timestamps using the India business date', () => {
    expect(inIndiaDateRange('2026-10-21T20:00:00Z', '2026-10-22', '2026-10-22')).toBe(true)
    expect(inIndiaDateRange('2026-10-21T18:00:00Z', '2026-10-22', '2026-10-22')).toBe(false)
  })

  it('supports All dates and rejects incomplete or reversed ranges', () => {
    expect(inIndiaDateRange(null, '', '')).toBe(true)
    expect(isIndiaDateRangeValid('', '')).toBe(true)
    expect(isIndiaDateRangeValid('2026-10-22', '')).toBe(false)
    expect(isIndiaDateRangeValid('2026-10-23', '2026-10-22')).toBe(false)
  })
})
