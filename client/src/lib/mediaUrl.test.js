import { describe, expect, it } from 'vitest'
import { resolveMediaUrl } from './mediaUrl'

describe('resolveMediaUrl', () => {
  it('repairs legacy localhost upload URLs on production', () => {
    expect(resolveMediaUrl('http://localhost:4000/uploads/photo.png', {
      pageUrl: 'https://bookadoctors.com/patient/dashboard',
      apiBaseUrl: 'https://api.bookadoctors.com',
    })).toBe('https://api.bookadoctors.com/uploads/photo.png')
  })

  it('resolves a stored upload path against the API origin', () => {
    expect(resolveMediaUrl('/uploads/photo.png', {
      pageUrl: 'https://bookadoctors.com',
      apiBaseUrl: 'https://api.bookadoctors.com',
    })).toBe('https://api.bookadoctors.com/uploads/photo.png')
  })

  it('does not rewrite unrelated external images', () => {
    expect(resolveMediaUrl('https://images.example.com/user.jpg', {
      pageUrl: 'https://bookadoctors.com',
      apiBaseUrl: 'https://api.bookadoctors.com',
    })).toBe('https://images.example.com/user.jpg')
  })
})
