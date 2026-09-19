import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCsv, csvCell, downloadCsv } from './csv'

describe('csvCell', () => {
  it('wraps a value in double quotes', () => {
    expect(csvCell('hello')).toBe('"hello"')
  })

  it('doubles embedded double quotes', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('treats null/undefined as an empty string', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('stringifies a non-string value', () => {
    expect(csvCell(42)).toBe('"42"')
  })
})

describe('buildCsv', () => {
  it('joins a header row and data rows with commas and newlines', () => {
    const csv = buildCsv(['Name', 'Age'], [['Alice', 30], ['Bob', 25]])
    expect(csv).toBe('"Name","Age"\n"Alice","30"\n"Bob","25"')
  })

  it('escapes quotes within data rows', () => {
    const csv = buildCsv(['Note'], [['She said "hi"']])
    expect(csv).toBe('"Note"\n"She said ""hi"""')
  })

  it('produces just the header row when there are no data rows', () => {
    expect(buildCsv(['A', 'B'], [])).toBe('"A","B"')
  })
})

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an object URL, clicks a download anchor, and revokes the URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('patients.csv', '"Name"\n"Alice"')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
