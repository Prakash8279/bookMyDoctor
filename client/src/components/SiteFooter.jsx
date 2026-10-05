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
            <img src={brandLogoUrl} alt="BookMyDoctors" className="h-full w-full rounded-[13px] object-cover" />
          </span>
          <span><strong>BookMyDoctors</strong></span>
        </Link>
        <p className="footer-copy">Healthcare that respects your time. Discover verified doctors, book instantly, and follow your clinic queue live.</p>
        <div className="contact-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect></svg>
          <a href="mailto:bookmydoctors@gmail.com" className="hover:underline">bookmydoctors@gmail.com</a>
        </div>
        <div className="contact-line">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-phone"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          <a href="tel:+917323074966" className="font-medium hover:underline">+91 7323074966</a>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <a
            href="https://wa.me/917323074966?text=Hi%20BookMyDoctors%2C%20I%20would%20like%20to%20inquire%20about%20doctor%20appointments."
            target="_blank"
            rel="noopener noreferrer"
            title="Chat on WhatsApp"
            aria-label="BookMyDoctors WhatsApp"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white transition-transform hover:scale-110"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.311.045-.698.072-2.126-.519-1.815-.752-2.984-2.587-3.074-2.709-.089-.122-.738-.981-.738-1.871 0-.89.467-1.328.633-1.509.167-.18.364-.225.486-.225.122 0 .244.001.35.006.113.005.263-.043.411.314.155.372.531 1.294.577 1.388.046.094.077.204.015.328-.061.124-.092.202-.183.308-.091.106-.192.237-.274.318-.092.091-.188.19-.081.374.107.184.475.783 1.021 1.269.702.626 1.294.82 1.478.911.185.091.292.08.401-.046.108-.125.467-.544.591-.73.124-.186.248-.155.417-.093.169.062 1.077.508 1.262.6.185.093.308.139.354.217.046.079.046.455-.098.86z"/>
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.891.523 3.662 1.436 5.176L2 22l4.981-1.399C8.423 21.493 10.153 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.063c-1.667 0-3.219-.481-4.536-1.309l-.326-.205-2.97.834.846-2.906-.222-.341C3.904 14.73 3.4 13.409 3.4 12c0-4.742 3.858-8.6 8.6-8.6 4.741 0 8.6 3.858 8.6 8.6 0 4.741-3.859 8.063-8.6 8.063z"/>
            </svg>
          </a>
          <a
            href="https://www.instagram.com/bookmy.doctors?stkn=MWJrMTNvNjg3MW8wbg=="
            target="_blank"
            rel="noopener noreferrer"
            title="Follow on Instagram"
            aria-label="BookMyDoctors Instagram"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white transition-transform hover:scale-110"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line>
            </svg>
          </a>
          <a
            href="https://www.facebook.com/share/1DsGYTZR4w/"
            target="_blank"
            rel="noopener noreferrer"
            title="Follow on Facebook"
            aria-label="BookMyDoctors Facebook"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1877F2] text-white transition-transform hover:scale-110"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </a>
        </div>
      </div>
    </div>

    <div className="container footer-bottom">
      <span>© 2026 BookMyDoctors. All rights reserved.</span>
      {/* Privacy/Terms now point at the real /privacy and /terms pages
          (App.jsx) — previously this whole line was plain non-interactive
          text with no pages behind it. Accessibility stays plain text: no
          accessibility statement page exists yet, and stubbing one is out
          of scope here. */}
      <span><Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/cancellation-refund-policy">Cancellation &amp; Refund</Link> · Accessibility</span>
    </div>
  </footer>
}



