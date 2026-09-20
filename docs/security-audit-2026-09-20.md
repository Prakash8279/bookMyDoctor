# BookMyDoctor24 — Security Audit (2026-09-20)

**Scope:** Backend (`server/server`), frontend (`client`), mobile (`mobile`) — full read-only code review + `npm audit` on both Node projects.
**Method:** Manual code review across auth/RBAC, input validation & injection, secrets/config, frontend XSS/storage, and dependency scanning. No live database or third-party service was touched.

## Overall verdict

Yeh codebase overall **kaafi achhi tarah hardened** hai — jitni bhi common security mistakes hoti hain (SQL injection, mass assignment, plaintext passwords, missing role checks, XSS), unme se koi bhi *nahi* mili. Jo issues mile hain, wo mostly Medium/Low severity ke hain aur fix karna easy hai. Ek Critical-labeled item hai, lekin wo runtime app ka bug nahi — ek build-tool dependency (`bcrypt`) ke andar chhupa hua supply-chain issue hai.

---

## Findings (sabse zyada severe pehle)

### 1. [Critical — dependency, not app code] `tar` package via `bcrypt`'s build dependency
- **Kahan:** `server/server` → `node_modules/tar` (`bcrypt` → `@mapbox/node-pre-gyp` → `tar`)
- **Kya hai:** `npm audit` ne `tar` mein multiple critical advisories dikhaye (path traversal, symlink poisoning, arbitrary file overwrite) — yeh sab **install-time** (jab `npm install` chalta hai aur bcrypt ka prebuilt binary extract hota hai) exploit hote hain, runtime pe app khud is code ko use nahi karta.
- **Real risk:** Kam hai for normal operation, lekin agar kabhi ek malicious/compromised tarball install ho jaye, toh yeh vulnerable `tar` file-system par arbitrary writes kar sakta hai.
- **Fix:** `npm audit fix --force` chalane se `bcrypt` upgrade hoke `bcrypt@6.0.0` aa jayega (breaking change — thoda testing chahiye login/password flows par, lekin bcrypt ka hashing API practically same rehta hai).

### 2. [Medium] Password-reset token/link plaintext logs mein likha ja raha hai
- **Kahan:** `server/server/src/services/emailService.js` aur `smsService.js` ka `logProvider`, jo `auth.service.js` se call hota hai jab real email/SMS provider configure nahi hota.
- **Kya hai:** Jab tak aap real SMTP/SMS provider (Twilio, SendGrid, etc.) configure nahi karte, reset link/OTP application logs mein raw text mein print ho jaata hai — production `info` log level pe bhi.
- **Risk:** Jisko bhi log access hai (log-aggregation tool, ops dashboard, misconfigured log storage), wo kisi bhi user ka live password-reset token nikal ke uska account le sakta hai.
- **Fix:** Production mein jaane se pehle real email/SMS provider zaroor configure karein, ya kam se kam `logProvider` ko sirf non-production (`NODE_ENV !== 'production'`) mein hi allow karein.

### 3. [Medium] Uploaded documents (doctor verification, prescriptions) bina auth ke serve ho rahe hain
- **Kahan:** `server/server/src/app.js` — `/uploads` route `express.static` se serve hota hai, auth middleware se pehle.
- **Kya hai:** Filenames random UUID hain (guess karna mushkil), lekin agar URL kahin bhi leak ho jaye (browser history, log, support ticket mein paste), toh koi bhi login ke bina wo file khol sakta hai.
- **Risk:** Doctor ka ID document ya patient se juda hua koi private file leak ho sakta hai agar link kahin bhi expose ho jaye.
- **Fix:** Private categories (documents/prescriptions) ke liye signed/authenticated URL serving use karein; sirf public assets (profile photo, QR code) hi directly serve hon.

### 4. [Medium] Doctor ke bank account details plaintext mein DB mein store ho rahe hain
- **Kahan:** `server/server/prisma/schema.prisma` — `DoctorProfile.bankAccountHolderName`, `bankAccountNumber`, `bankIfscCode`.
- **Risk:** Agar database dump/backup kabhi leak ho jaye, doctors ke bank account numbers directly padhe ja sakte hain. Card details (PCI scope) nahi hain, lekin phir bhi sensitive financial PII hai.
- **Fix:** In fields ko application-level encryption ke saath store karein, ya kam se kam yeh confirm karein ki inhe sirf zaroori roles/queries hi select kar sakte hain.

### 5. [Medium] Frontend mein JWT tokens `localStorage` mein store ho rahe hain
- **Kahan:** `client/src/lib/apiClient.js` — access + refresh dono tokens `localStorage` mein.
- **Risk:** Abhi koi XSS bug nahi mila app mein, lekin agar future mein kisi dependency ya third-party script (Google Sign-In, Razorpay widget) ke through XSS aa jaye, toh attacker localStorage se dono tokens directly nikal sakta hai — poora account takeover, sirf current session nahi.
- **Fix:** Kam se kam refresh token ko httpOnly, Secure, SameSite=strict cookie mein move karein taaki JS se accessible na ho.

### 6. [Moderate — dependency] `react-router` mein open-redirect + SSR hydration issue
- **Kahan:** `client/package.json` → `react-router`/`react-router-dom` (advisory GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg).
- **Fix:** `npm audit fix` (non-breaking) chalayein.

### 7. [Moderate — dependency] `morgan` (log forging) aur `qs` (DoS/array-limit bypass) — backend
- **Fix:** `npm audit fix` (non-breaking) chalayein.

### 8. [Low/Info] Admin IP allowlist default se off hai
- **Kahan:** `ADMIN_IP_ALLOWLIST` env var khaali hai `.env.example` mein.
- Yeh koi bug nahi — admin routes already `authenticate` + `authorize('admin','superadmin')` se protected hain — lekin extra defense-in-depth layer chahiye toh production mein IP allowlist bhi set kar sakte hain.

---

## Jo cheezein already sahi/secure hain (achhi baat)

- **Passwords:** bcrypt (cost factor 12) har jagah, plaintext kahin nahi, timing-safe dummy-hash compare login enumeration rokta hai.
- **JWT:** algorithm allowlist (`HS256` only), expiry properly enforced, role/status har request pe DB se re-check hota hai (disable/role-change turant effective).
- **Refresh tokens:** hashed storage, single-use rotation, reuse detection sabhi sessions revoke kar deta hai.
- **SQL injection:** koi bhi raw query string-concatenation se nahi bani — sab tagged-template parameterized hain.
- **Mass assignment:** `req.body` kabhi bhi directly Prisma create/update mein spread nahi hota; explicit field allowlist (`pickPresentFields`) consistently use hoti hai. Signup pe role hamesha server-side `'patient'` fix hai.
- **IDOR:** appointments/payments/medical records — sab jagah ownership check hota hai before returning data.
- **File uploads:** MIME allowlist (koi SVG/HTML/JS allowed nahi), size caps, random UUID filenames (path traversal impossible), PDFs force-download hote hain.
- **CORS:** specific origin allowlist, credentials false (cookie-based auth use hi nahi hota).
- **Security headers:** `helmet()` lagi hui hai; HTTPS force-redirect production mein.
- **Error handling:** stack trace/internal error client ko kabhi nahi jaata, sirf server logs mein.
- **Logging:** passwords/tokens/OTP request logs mein print nahi hote.
- **Secrets:** koi `.env` file repo mein commit nahi hai, sab `.gitignore` mein cover hain; hardcoded API keys/secrets kahin nahi mile.
- **Frontend:** `dangerouslySetInnerHTML`/`eval`/`innerHTML` kahin bhi use nahi hua — XSS ka koi sink nahi mila. Razorpay secret key kabhi bhi frontend mein nahi aata.

---

## Priority action list

1. `npm audit fix` chalayein dono (`client` aur `server/server`) — `morgan`, `qs`, `react-router` non-breaking fix ho jayenge.
2. Production mein jaane se pehle real email/SMS provider zaroor configure karein (Finding #2) — yeh sabse important hai agar app live users ke saath chal rahi hai.
3. `/uploads` ko authenticated/signed serving mein migrate karein (Finding #3).
4. Doctor bank details encryption ya restricted-select add karein (Finding #4).
5. Refresh token ko httpOnly cookie mein move karna consider karein (Finding #5) — bada refactor hai, isliye lower priority, lekin future-proofing ke liye achha hai.
6. `npm audit fix --force` (bcrypt upgrade) — thoda testing ke saath, jab convenient ho.

---

*Yeh audit static code review par based hai — koi live database, real email/SMS, ya production traffic touch nahi kiya gaya. Isse penetration test ka substitute na maanein; production deploy se pehle ek dedicated pen-test bhi recommend kiya jaata hai agar real patient data involved hai.*
