import { useState } from 'react'
import { SiteHeader } from './PublicPages'
import { FormField } from '../components/FormField'
import { useAppStore } from '../store/useAppStore'

// New page (Play Store requirement): any app that supports account creation
// must offer a way to request account/data deletion via a web page reachable
// without logging in (and after the app is uninstalled). Per product
// decision, this is a simple request-based flow rather than a fully
// automated self-serve deletion: it reuses the existing public `POST
// /contact` endpoint (no backend changes needed) so the request lands in the
// same admin-reviewed Contact inbox as any other support request, tagged
// with a fixed subject so admins can recognize and prioritize it.
const Button = ({ children, className = '', ...props }) => (
  <button className={`btn-primary ${className}`} {...props}>
    {children}
  </button>
)
const ErrorNote = ({ children }) => (children ? <p role="alert" className="mt-3 text-sm font-semibold text-error">{children}</p> : null)

const RETAINED_ITEMS = [
  'Financial and payment records we are required to keep for accounting, tax, or audit purposes.',
  'A clinic\'s own clinical notes and records for consultations you completed with them — these are the treating clinic\'s independent recordkeeping obligation, separate from your BookMyDoctor24 account.',
  'Information relevant to an open dispute, complaint, or investigation, until it is resolved.',
]

export function AccountDeletion() {
  const submitContactRequest = useAppStore((state) => state.submitContactRequest)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const send = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (!values.confirm) {
      setError('Please confirm the checkbox below before submitting — this tells us you understand deletion cannot be undone.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const messageLines = [
        `Account email to delete: ${values.email || ''}`,
        values.role ? `Account type: ${values.role}` : null,
        values.reason ? `Reason (optional): ${values.reason}` : null,
        'Confirmation: user has confirmed they understand this request is permanent, subject to the retained-records exceptions described on the deletion request page.',
      ].filter(Boolean)
      await submitContactRequest({
        name: values.name || 'Account deletion request',
        email: values.email || '',
        subject: 'Account & data deletion request',
        message: messageLines.join('\n'),
      })
      setSent(true)
      form.reset()
    } catch (err) {
      setError(err.message || 'Could not submit this request. Please try again, or email us directly.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Account settings</p>
          <h1 className="mt-1 text-3xl">Request account & data deletion</h1>
          <p className="mt-3 leading-7 text-muted">
            You can request deletion of your BookMyDoctor24 account and the personal data associated with it, whether
            or not you still have the app installed. Simply uninstalling the app does not delete your account or your
            data — please submit a request below.
          </p>

          <div className="mt-6 rounded-button border border-border bg-surface p-4 text-sm text-muted">
            <p className="font-semibold text-ink">What happens after you submit a request</p>
            <p className="mt-2">
              Our team verifies the request against the account email you provide, then deletes your account and
              associated personal data within 30 days. A few things are kept even after deletion, for legal or
              recordkeeping reasons:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {RETAINED_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {sent ? (
            <div className="mt-6 rounded-button border border-success/30 bg-success/10 p-4 text-sm font-semibold text-success" role="status">
              Request received. Our team will verify and process it, and may contact you at the email you provided if
              we need to confirm your identity first.
            </div>
          ) : (
            <form onSubmit={send} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Full name" name="name" required />
                <FormField label="Account email" name="email" type="email" required />
              </div>
              <FormField label="Account type (optional)" name="role" type="select" options={['Patient', 'Doctor', 'Clinic / receptionist', 'Not sure']} />
              <FormField label="Reason (optional)" name="reason" type="textarea" placeholder="Optional — helps us improve, does not affect your request" />
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="confirm" className="mt-1" />
                <span>
                  I understand this permanently deletes my BookMyDoctor24 account and associated personal data
                  (subject to the exceptions listed above), and this cannot be undone.
                </span>
              </label>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit deletion request'}
              </Button>
              <ErrorNote>{error}</ErrorNote>
            </form>
          )}

          <p className="mt-8 border-t border-border pt-4 text-sm text-muted">
            Prefer email? Send the same details to{' '}
            <a href="mailto:bookmydoctor24@gmail.com" className="font-semibold text-primary-dark underline">
              bookmydoctor24@gmail.com
            </a>{' '}
            with the subject "Account & data deletion request". See our{' '}
            <a href="/privacy" className="font-semibold text-primary-dark underline">
              Privacy Policy
            </a>{' '}
            for more on what information we collect and retain.
          </p>
        </article>
      </main>
    </>
  )
}
