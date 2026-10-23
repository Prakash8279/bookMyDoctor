import apiClient from './apiClient'

// Upload rows created while production still had the development default may contain
// http://localhost:4000/uploads/... . On a real user's browser that hostname means the user's
// own device, not BookADoctors. Keep old rows usable by rebasing only our own /uploads paths onto
// the API origin; unrelated external image URLs are left untouched.
export function resolveMediaUrl(value, options = {}) {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''

  const pageUrl = options.pageUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
  // Some focused component tests replace apiClient with a light mock that has no
  // axios `defaults` object. Keep URL resolution usable there and in any future
  // non-Axios adapter as well.
  const apiBaseUrl = options.apiBaseUrl || apiClient?.defaults?.baseURL || '/api'
  try {
    const page = new URL(pageUrl)
    const api = new URL(apiBaseUrl, page)
    const source = new URL(raw, page)
    const isUpload = source.pathname === '/uploads' || source.pathname.startsWith('/uploads/')
    const sourceIsLocal = ['localhost', '127.0.0.1', '10.0.2.2'].includes(source.hostname)
    const pageIsLocal = ['localhost', '127.0.0.1'].includes(page.hostname)
    if (isUpload && (raw.startsWith('/uploads/') || (sourceIsLocal && !pageIsLocal))) {
      return `${api.origin}${source.pathname}${source.search}${source.hash}`
    }
    return source.href
  } catch {
    return raw
  }
}
