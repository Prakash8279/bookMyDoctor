import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, formatMoneyPlain, sequenceId, shortId, stableId } from './format'

describe('formatDate', () => {
  it('returns an em dash for a falsy value', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate(0)).toBe('—')
  })

  it('formats a valid date string as DD Mon YYYY', () => {
    expect(formatDate('2026-03-05')).toBe('05 Mar 2026')
  })

  it('formats a Date instance', () => {
    expect(formatDate(new Date('2025-12-25T00:00:00Z'))).toBe('25 Dec 2025')
  })

  it('returns the original value stringified when it cannot be parsed', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatMoney', () => {
  it('formats a plain number with the rupee sign and Indian grouping', () => {
    expect(formatMoney(1234.5)).toBe('₹1,234.5')
  })

  it('treats a missing value as 0', () => {
    expect(formatMoney(undefined)).toBe('₹0')
    expect(formatMoney(null)).toBe('₹0')
  })

  it('coerces a numeric string', () => {
    expect(formatMoney('500')).toBe('₹500')
  })

  it('formats a large amount with thousands separators', () => {
    expect(formatMoney(1234567)).toBe('₹12,34,567')
  })
})

describe('formatMoneyPlain', () => {
  it('formats a plain number with an ASCII "Rs." prefix instead of the rupee glyph', () => {
    expect(formatMoneyPlain(1234.5)).toBe('Rs. 1,234.5')
  })

  it('treats a missing value as 0', () => {
    expect(formatMoneyPlain(undefined)).toBe('Rs. 0')
    expect(formatMoneyPlain(null)).toBe('Rs. 0')
  })

  it('matches formatMoney\'s numeric formatting, just with a different prefix', () => {
    const amount = 1234567
    expect(formatMoneyPlain(amount)).toBe(formatMoney(amount).replace('₹', 'Rs. '))
  })
})

describe('shortId', () => {
  it('defaults to a "#" prefix and the last 4 characters', () => {
    expect(shortId('appt_9f8e7d6c5b4a')).toBe('#5b4a')
  })

  it('applies a custom prefix', () => {
    expect(shortId('appt_9f8e7d6c5b4a', 'DC-')).toBe('DC-5b4a')
  })

  it('works on an id with no underscore', () => {
    expect(shortId('abcdefgh')).toBe('#efgh')
  })

  it('treats a missing id as an empty string', () => {
    expect(shortId(null)).toBe('#')
    expect(shortId(undefined)).toBe('#')
  })

  it('handles a numeric id', () => {
    expect(shortId(123456789)).toBe('#6789')
  })
})

describe('sequenceId', () => {
  it('starts at DC01 for index 0', () => {
    expect(sequenceId(0)).toBe('DC01')
  })

  it('counts up with the index', () => {
    expect(sequenceId(1)).toBe('DC02')
    expect(sequenceId(8)).toBe('DC09')
  })

  it('does not truncate past two digits', () => {
    expect(sequenceId(99)).toBe('DC100')
  })

  it('applies a custom prefix', () => {
    expect(sequenceId(0, 'BK')).toBe('BK01')
  })
})

describe('stableId', () => {
  it('formats a stored patient/doctor/clinic number with its prefix, no zero-padding', () => {
    expect(stableId(1, 'DCP')).toBe('DCP1')
    expect(stableId(23, 'DCD')).toBe('DCD23')
    expect(stableId(7, 'DCC')).toBe('DCC7')
  })

  it('coerces a numeric string', () => {
    expect(stableId('5', 'DCP')).toBe('DCP5')
  })

  it('falls back to "<prefix>—" for a legacy row with no stored number yet', () => {
    expect(stableId(null, 'DCP')).toBe('DCP—')
    expect(stableId(undefined, 'DCD')).toBe('DCD—')
    expect(stableId('', 'DCC')).toBe('DCC—')
  })

  it('falls back to "<prefix>—" instead of crashing on a non-numeric value', () => {
    expect(stableId('not-a-number', 'DCP')).toBe('DCP—')
  })

  // The whole point of this formatter (vs. sequenceId above): the same record's number stays
  // identical across calls regardless of any notion of "position" — there simply isn't one here.
  it('never changes for the same stored number, unlike position-based sequenceId', () => {
    expect(stableId(4, 'DCP')).toBe(stableId(4, 'DCP'))
  })
})
