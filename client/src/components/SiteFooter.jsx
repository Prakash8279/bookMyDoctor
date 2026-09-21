import { Link } from 'react-router-dom'
import brandLogoUrl from '../assets/brand-logo.png'

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="container footer-grid">
      <div>
        <Link to="/" className="brand brand-light">
          {/* BUG FIX ("galat logo use kiye ho"): real app logo, not the generic Lucide
              heart-pulse stock icon this used to be — see lib/brandLogo.js for the same fix on
              the PDF receipts. */}
          <span className="brand-mark">
            <img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" />
          </span>
          <span><strong>BookMyDoctor24</strong></span>
        </Link>
        <p className="footer-copy">Healthcare that respects your time. Discover verified doctors, book instantly, and follow your clinic queue live.</p>
        <div className="contact-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect></svg>
          bookmydoctor24@gmail.com
        </div>
      </div>

      <div>
        <h3>Patients</h3>
        <Link to="/search">Find a doctor</Link>
        <Link to="/patient/appointments">My appointments</Link>
        <Link to="/patient/queue">Live queue</Link>
        <Link to="/patient/records">Health records</Link>
      </div>

      <div>
        <h3>Professionals</h3>
        <Link to="/register?role=doctor">Join as a doctor</Link>
        <Link to="/doctor/dashboard">Doctor portal</Link>
        <Link to="/receptionist/dashboard">Reception portal</Link>
        <Link to="/admin/dashboard">Admin portal</Link>
      </div>

      <div>
        <h3>Contact</h3>
        <div className="contact-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>
          India
        </div>
        <div className="contact-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-phone"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"></path></svg>
          Support available 9 AM–8 PM
        </div>
        <Link to="/contact" className="footer-support">Contact support</Link>
      </div>
    </div>

    <div className="container footer-bottom">
      <span>© 2026 BookMyDoctor24. All rights reserved.</span>
      {/* Privacy/Terms now point at the real /privacy and /terms pages
          (App.jsx) — previously this whole line was plain non-interactive
          text with no pages behind it. Accessibility stays plain text: no
          accessibility statement page exists yet, and stubbing one is out
          of scope here. */}
      <span><Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/cancellation-refund-policy">Cancellation &amp; Refund</Link> · Accessibility</span>
    </div>
  </footer>
}



