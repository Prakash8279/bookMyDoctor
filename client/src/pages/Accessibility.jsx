import { SiteHeader } from './PublicPages'

const SECTIONS = [
  [
    'Our approach',
    'BookADoctors aims to make its website and mobile experience usable for as many people as possible, including people who use assistive technology or navigate with a keyboard.',
  ],
  [
    'Accessibility features',
    'We use clear headings, labelled form controls, visible keyboard focus, readable colour contrast, responsive layouts, and touch-friendly controls. Important actions are not communicated by colour alone.',
  ],
  [
    'Supported use',
    'The website is designed for current versions of major mobile and desktop browsers. Browser zoom, text scaling, keyboard navigation, and screen-reader labels are supported wherever the platform provides an interactive control.',
  ],
  [
    'Need assistance?',
    'If any page, form, or feature is difficult to use, email support@bookadoctors.com and mention the page, device, browser, and the problem you experienced. We will review the issue and help you complete the task.',
  ],
]

export function Accessibility() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="mt-2 rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Support</p>
          <h1 className="mt-1 text-3xl">Accessibility</h1>
          <p className="mt-2 text-sm text-muted">How we make BookADoctors easier to use.</p>

          <div className="mt-6 space-y-6">
            {SECTIONS.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="text-xl">{heading}</h2>
                <p className="mt-2 leading-7 text-muted">{body}</p>
              </section>
            ))}
          </div>

          <a
            href="mailto:support@bookadoctors.com?subject=Accessibility%20support"
            className="btn-primary mt-8 inline-flex"
          >
            Email accessibility support
          </a>
        </article>
      </main>
    </>
  )
}
