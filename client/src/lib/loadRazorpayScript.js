// Loads Razorpay's Checkout widget script on demand instead of blocking every page load with it.
// Previously this script was a plain <script> tag in index.html with no async/defer, so the
// browser could not finish loading ANY page — homepage, doctor search, admin panel, all of it —
// until this third-party script had downloaded. When Razorpay's CDN was slow, the whole site
// appeared frozen for 40+ seconds for every visitor, even ones who never intended to pay online.
// See razorpay-script-loading-fix-plan.md for the full writeup.
//
// Safe to call multiple times or from multiple components — the script is only ever injected
// once, and every caller in-flight shares the same promise.
let razorpayScriptPromise = null

export function loadRazorpayScript() {
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => {
      if (window.Razorpay) {
        resolve(window.Razorpay)
      } else {
        reject(new Error('Razorpay script loaded but window.Razorpay is missing.'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load the Razorpay payment script.'))
    document.head.appendChild(script)
  }).catch((err) => {
    // Don't permanently cache a failure — let the next call (e.g. the patient clicking "Pay now"
    // again) retry instead of being stuck forever because of one transient network blip.
    razorpayScriptPromise = null
    throw err
  })
  return razorpayScriptPromise
}
