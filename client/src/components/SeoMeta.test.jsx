import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { SeoMeta } from './SeoMeta'

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <SeoMeta />
  </MemoryRouter>,
)

describe('SeoMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <link rel="canonical" href="https://bookadoctors.com/" />
      <meta name="description" content="" />
      <meta name="robots" content="" />
      <meta property="og:url" content="" />
      <meta property="og:title" content="" />
      <meta property="og:description" content="" />
      <meta name="twitter:title" content="" />
      <meta name="twitter:description" content="" />
    `
  })

  it('sets unique metadata and canonical URL for public routes', async () => {
    renderAt('/clinics')

    await waitFor(() => expect(document.title).toBe('Find Clinics Near You | BookADoctors'))
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://bookadoctors.com/clinics')
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', expect.stringContaining('index, follow'))
  })

  it('prevents private portal routes from being indexed', async () => {
    renderAt('/patient/dashboard')

    await waitFor(() => expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'))
  })

  it('makes the shipping and exchange policy public with its own canonical URL', async () => {
    renderAt('/shipping-exchange-policy')
    await waitFor(() => expect(document.title).toBe('Shipping and Exchange Policy | BookADoctors'))
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://bookadoctors.com/shipping-exchange-policy')
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', expect.stringContaining('index, follow'))
  })
})
