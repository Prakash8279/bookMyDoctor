import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('source integrity', () => {
  it('keeps hidden form controls small and preserves responsive grid column spans', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/responsive.css'), 'utf8')
    expect(css).toContain(':is(input, select, textarea):not(.sr-only)')
    expect(css).toMatch(/\.portal-content :is\(input, select, textarea\)\.sr-only\s*\{[^}]*width: 1px;[^}]*min-height: 0;/)
    expect(css).not.toMatch(/\.portal-content :is\(\.grid-cols-2, \.grid-cols-3\)\s*\{/)
    expect(css).toMatch(/\.portal-content :is\(\.data-scroll, \.overflow-x-auto\)\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;/)
    expect(css).toMatch(/\.portal-content dl > \.flex > dt\s*\{[^}]*max-width: 45%;[^}]*flex-shrink: 1;/)
    expect(css).toContain('.portal-profile-photo-copy')
    expect(css).toMatch(/\.admin-portal \.page-heading__action > \.flex\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(css).toMatch(/\.admin-record-details > \*\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/)
  })
  it('does not append standalone undefined expressions to AdminPages', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminPages.jsx'), 'utf8')
    expect(source).not.toMatch(/^\s*undefined\s*;?\s*$/m)
  })
})
