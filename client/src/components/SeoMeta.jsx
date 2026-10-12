import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_URL = 'https://bookadoctors.com'
const DEFAULT_TITLE = 'BookADoctors | Book Doctor Appointments Online in India'
const DEFAULT_DESCRIPTION = 'Find verified doctors and clinics, book appointments online, and track live queue tokens with BookADoctors across India.'

const PUBLIC_META = {
  '/': [DEFAULT_TITLE, DEFAULT_DESCRIPTION],
  '/search': ['Find Doctors Near You | BookADoctors', 'Search verified doctors by specialty, clinic, and location, then book an appointment online with BookADoctors.'],
  '/clinics': ['Find Clinics Near You | BookADoctors', 'Discover clinics, doctors, services, and appointment availability near you with BookADoctors.'],
  '/for-doctors': ['BookADoctors for Doctors and Clinics', 'Manage appointments, digital tokens, live queues, staff, and patient communication with BookADoctors.'],
  '/emergency': ['Find Emergency Care | BookADoctors', 'Find available emergency clinics and doctors near you through BookADoctors.'],
  '/about': ['About BookADoctors', 'Learn how BookADoctors helps patients find verified doctors, book appointments, and track clinic queues.'],
  '/contact': ['Contact BookADoctors', 'Contact BookADoctors for appointment support, clinic onboarding, doctor registration, and account help.'],
  '/blog': ['BookADoctors Health and Appointment Guides', 'Read practical BookADoctors guides about doctor visits, appointments, clinics, and live queues.'],
  '/terms': ['Terms of Service | BookADoctors', 'Read the BookADoctors terms of service for patients, doctors, clinics, and staff.'],
  '/privacy': ['Privacy Policy | BookADoctors', 'Read how BookADoctors collects, uses, protects, and manages personal information.'],
  '/cancellation-refund-policy': ['Cancellation and Refund Policy | BookADoctors', 'Read the BookADoctors appointment cancellation and refund policy.'],
}

const CANONICAL_ALIASES = {
  '/terms-of-service': '/terms',
  '/privacy-policy': '/privacy',
  '/privacypolicy': '/privacy',
}

const setMeta = (selector, attribute, value) => {
  const element = document.head.querySelector(selector)
  if (element) element.setAttribute(attribute, value)
}

export function SeoMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const canonicalPath = CANONICAL_ALIASES[pathname] || pathname
    const doctorProfile = /^\/doctors?\/[^/]+$/.test(canonicalPath)
    const publicMeta = PUBLIC_META[canonicalPath] || (doctorProfile
      ? ['Doctor Profile | BookADoctors', 'View doctor details, clinic information, and appointment availability on BookADoctors.']
      : null)
    const title = publicMeta?.[0] || DEFAULT_TITLE
    const description = publicMeta?.[1] || DEFAULT_DESCRIPTION
    const isIndexable = Boolean(publicMeta)
    const canonicalUrl = `${SITE_URL}${canonicalPath === '/' ? '/' : canonicalPath}`

    document.title = title
    setMeta('meta[name="description"]', 'content', description)
    setMeta('meta[name="robots"]', 'content', isIndexable
      ? 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'
      : 'noindex, nofollow')
    setMeta('link[rel="canonical"]', 'href', canonicalUrl)
    setMeta('meta[property="og:url"]', 'content', canonicalUrl)
    setMeta('meta[property="og:title"]', 'content', title)
    setMeta('meta[property="og:description"]', 'content', description)
    setMeta('meta[name="twitter:title"]', 'content', title)
    setMeta('meta[name="twitter:description"]', 'content', description)
  }, [pathname])

  return null
}
