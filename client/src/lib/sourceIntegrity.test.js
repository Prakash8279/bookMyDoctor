import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('source integrity', () => {
  it('does not append standalone undefined expressions to AdminPages', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminPages.jsx'), 'utf8')
    expect(source).not.toMatch(/^\s*undefined\s*;?\s*$/m)
  })
})
