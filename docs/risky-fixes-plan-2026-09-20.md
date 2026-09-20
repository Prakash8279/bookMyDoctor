# Risky Fixes — Plan Only (Review Karke Decide Karo)

**Status:** Yeh teeno items sirf **PLAN + draft code** hain — kuch bhi apply/push nahi kiya gaya hai. Aapne "YE SAB FIX KRO" ke jawab mein explicitly bola tha safe fixes abhi karo, in teen risky items ko sirf explain karo — wahi kiya hai. Jab ready ho, bolo toh implement kar dunga (aur jahan zaroori hai wahan aap khud test/run karoge, kyunki inme se har ek ko real login/session/live-DB ke against verify karna padega).

Teeno alag-alag "risky" hain, alag reasons se:

| # | Item | Risk kis type ka hai |
|---|------|----------------------|
| 1 | `bcrypt` major-version upgrade (5.x → 6.x) | Har existing login/password-hash ke against regression test chahiye |
| 2 | JWT `localStorage` → httpOnly cookie migration | Bada architecture change — auth flow, CORS, aur Flutter mobile app teeno affected |
| 3 | Doctor bank-detail encryption | Naya secret + live production data ka one-time migration chahiye |

---

## 1. `bcrypt` major-version upgrade (5.x → 6.x)

**Kahan se aaya:** `npm audit` — `tar` (bcrypt ki build-dependency `@mapbox/node-pre-gyp` ke through) mein critical advisories hain, sirf `npm audit fix --force` unhe fix karta hai, jo `bcrypt` ko `6.0.0` pe upgrade kar deta hai (breaking change flag ke saath).

**Risk kya hai:** Yeh install-time/build-time vulnerability hai (tar extract hote waqt exploit hoti hai), runtime pe app khud is code path ko use nahi karta — isliye "abhi hi urgent" nahi hai. Lekin major version bump hone ki wajah se blind `--force` chalana risky hai:
- Har jagah jo `bcrypt.hash()`/`bcrypt.compare()` use hoti hai (login, signup, password reset — teen jagah: `auth.service.js` lines 43, 82, 155, 425) unka behavior same rehna chahiye.
- Native binary rebuild hoti hai (`bcrypt` ek C++ addon hai) — deployment environment (Windows dev machine vs. Linux Docker/production) dono jagah rebuild successful hona chahiye.
- Aapke demo/existing accounts ke stored password hashes bcrypt 5.x se bane hain — bcrypt hash format (`$2b$...`) version-independent hai, toh purane hashes bcrypt 6.x ke saath bhi compare hone chahiye, lekin isko explicitly test karna zaroori hai warna login tootne ka risk hai.

**Plan (jab ready ho):**
1. `server/server` mein `npm install bcrypt@^6.0.0` (ya `npm audit fix --force`).
2. Fresh install ke baad, native binary rebuild ho — confirm karo `node -e "require('bcrypt')"` error nahi deta (aapke real Windows machine + jahan bhi deploy karte ho, dono jagah).
3. Ek quick script/test se confirm karo: ek EXISTING (bcrypt 5.x se bana) password hash ab bhi `bcrypt.compare()` se match hota hai — koi bhi ek demo account ka password try karke.
4. Poora jest suite chalao (`auth.service.test.js`, `auth.flow.test.js` integration test) — yeh dono files bcrypt import karti hain, toh already inka pass hona confirm karega ki API same hai.
5. Sirf tab commit karo jab upar ke saare steps clean pass ho jayein.

**Kitna kaam:** Chhota (ek dependency bump + verification), lekin verification skip nahi karna — isliye "abhi convenient ho tab" wala low-priority item hai, urgent nahi.

---

## 2. JWT tokens `localStorage` se httpOnly cookie mein move karna (WEB CLIENT ONLY)

**Kahan se aaya:** `client/src/lib/apiClient.js` — access aur refresh dono tokens `localStorage` (`connect_auth_tokens` key) mein. Agar kabhi XSS aa jaye (abhi koi bug nahi mila, but third-party scripts — Google Sign-In, Razorpay widget — future risk hain), attacker JS se dono tokens directly padh sakta hai.

**Important — Flutter mobile app is is se AFFECTED NAHI hai:** `mobile/lib/core/token_store.dart` already `flutter_secure_storage` use karta hai (Android Keystore / iOS Keychain backed) — yeh already secure hai, browser localStorage jaisi XSS risk usme hai hi nahi. Yeh migration sirf **web client** ke liye hai. Iska matlab backend ko **dono tareeke se auth serve karna padega** — web ke liye cookie-based, mobile ke liye ab bhi existing bearer-token/JSON-body flow — kyunki ek hi backend dono clients handle karta hai.

**Yeh sabse bada scope wala item hai — isme yeh sab badalta hai:**

### Backend (`server/server`)
1. **Login/refresh response**: access token response body mein rahega jaisा abhi hai (mobile ke liye zaroori), lekin **web client ke request se aane par** refresh token ko response body mein bhejne ke bajaye ek `Set-Cookie` header mein bhejo:
   ```js
   res.cookie('refreshToken', refreshToken, {
     httpOnly: true,
     secure: env.isProduction, // localhost HTTP dev mein false, real deploy (HTTPS) mein true
     sameSite: env.isProduction ? 'none' : 'lax', // web aur API alag origin/port par hain (5173 vs 4000/nginx) — cross-site cookie ke liye 'none' + secure chahiye production mein
     path: '/auth/refresh', // sirf refresh endpoint ko yeh cookie bhejni chahiye, har request ko nahi
     maxAge: <refresh token ki expiry, ms mein>,
   })
   ```
   Web vs mobile ko distinguish karne ke liye ek naya request header chahiye (e.g. `X-Client: web` client se bhejna) ya User-Agent check — mobile ke liye purana JSON-body-token flow bilkul same rakho.
2. **Refresh endpoint**: ab request body ke refresh token ke alawa `req.cookies.refreshToken` bhi check kare (web client ke liye). `cookie-parser` middleware add karna hoga (`app.js` mein) — abhi shayad already nahi hai, confirm karna padega.
3. **CORS config**: `app.js` mein CORS middleware ko `credentials: true` set karna hoga, aur `Access-Control-Allow-Origin` ko wildcard (`*`) se exact `CLIENT_ORIGIN` env value pe pin karna hoga (cookies ke saath wildcard origin allowed hi nahi hota browsers mein).
4. **CSRF protection**: Ab jab refresh token browser cookie mein hai, browser HAR request pe automatically bhej dega usi origin ko — iska matlab CSRF (Cross-Site Request Forgery) ka naya attack-surface khulta hai jo pehle (bearer token, JS explicitly attach karta tha) nahi tha. Isliye `SameSite=lax/strict` ke saath-saath ek CSRF token bhi consider karna padega agar refresh endpoint state-changing hai (isse token rotate hota hai, toh haan hai) — ya kam se kam refresh cookie ka `path` sirf `/auth/refresh` tak restrict karna (upar already suggested).
5. **Logout**: `res.clearCookie('refreshToken', { path: '/auth/refresh' })` add karna.

### Frontend (`client/src/lib/apiClient.js`)
1. Access token abhi jaisa hai wahi rahega (module-scope memory variable — already localStorage se bhi kam risky, kyunki page reload pe already access token expire ho chuka hota hai typically) — **ya isko bhi sirf in-memory (localStorage se hata ke) rakh sakte hain**, taaki XSS se sirf ek short-lived access token milे, refresh token bilkul nahi.
2. `axios.create({ ..., withCredentials: true })` add karna — taaki browser refresh cookie automatically bhej sake.
3. Refresh-token ka silent-refresh call ab request body mein refresh token bhejne ke bajaye sirf `POST /auth/refresh` (cookie automatically attach ho jayegi) karega.
4. `localStorage.setItem(TOKEN_STORAGE_KEY, ...)` wala poora block hata sakte hain (ya sirf access token store karna hai toh usko rakho, refresh token wala hissa hatao).

### Mobile (`mobile/`)
- **Koi change nahi** — already secure storage use kar raha hai, aur cookies native app mein anyway practical nahi hote iss tarah se. Backend ko sirf yeh confirm karna hai ki mobile ka existing JSON-body refresh flow break na ho jab web ka cookie flow add ho raha ho (dono paths parallel chalne chahiye, ek dusre ko replace na karein).

**Kyun risky hai:**
- Auth ek cross-cutting concern hai — login, refresh, logout, aur "session expired" har jagah touch hota hai (web AND mobile dono, kyunki backend shared hai).
- CORS + cookie + CSRF teeno ek saath sahi configure karna zaroori hai, warna ya toh login hi tootega, ya security hole reh jayega jo pehle se bhi zyada bada ho sakta hai (misconfigured CORS + credentials:true = bahut risky).
- Existing sabhi logged-in users ka session is deploy ke baad ek baar invalidate ho sakta hai (naya cookie-based flow purane localStorage token ko automatically migrate nahi karega) — sabko dobara login karna pad sakta hai.

**Isliye:** Yeh ek dedicated session mein, live testing ke saath (aap khud browser + mobile app dono se login/refresh/logout try karke) karna sahi rahega — abhi sirf draft/plan hai.

---

## 3. Doctor bank-account details encryption

**Kahan se aaya:** `prisma/schema.prisma` — `DoctorProfile.bankAccountHolderName`, `bankAccountNumber`, `bankIfscCode` — plaintext columns hain. Agar database dump/backup kabhi leak ho, yeh directly padhe ja sakte hain. Card details jaisa PCI scope nahi hai, lekin financial PII hai.

**Kaam karti hai sirf 3 files mein** (chhota surface area, achi baat hai):
- `doctors.service.js` — likhna/padhna
- `me.service.js` — doctor apna profile dekhta/update karta hai
- `me.validation.js` — input validation

**Plan (application-level field encryption, DB-level nahi — kyunki search/filter in fields pe kabhi nahi hota):**
1. **Naya secret chahiye** — ek `BANK_DETAILS_ENCRYPTION_KEY` env var (32-byte random key, jaise `openssl rand -hex 32` se banega). **Yeh secret main khud kabhi nahi generate/store karunga apki taraf se** — aapko khud generate karke apne real `.env` mein daalna hoga (standing rule: secrets sirf aap hi enter karo).
2. Ek naya `services/encryptionService.js` — Node ke built-in `crypto` module se AES-256-GCM (authenticated encryption — tamper-detect bhi karta hai):
   ```js
   const crypto = require('crypto')
   const KEY = Buffer.from(env.bankDetailsEncryptionKey, 'hex') // 32 bytes
   function encrypt(plaintext) {
     if (plaintext == null) return null
     const iv = crypto.randomBytes(12)
     const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
     const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
     const authTag = cipher.getAuthTag()
     // iv + authTag + ciphertext, ek hi base64 string mein store karne ke liye
     return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
   }
   function decrypt(stored) {
     if (stored == null) return null
     const raw = Buffer.from(stored, 'base64')
     const iv = raw.subarray(0, 12)
     const authTag = raw.subarray(12, 28)
     const ciphertext = raw.subarray(28)
     const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
     decipher.setAuthTag(authTag)
     return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
   }
   module.exports = { encrypt, decrypt }
   ```
3. `doctors.service.js`/`me.service.js` mein jahan bhi in 3 fields ko WRITE kiya jata hai (create/update), `encrypt()` se guzar ke store karo. Jahan bhi READ/return kiya jata hai (admin view, doctor apna profile), `decrypt()` se guzar ke wapas bhejo.
4. **Live data migration (sabse risky hissa):** Jo doctors already register ho chuke hain, unke bank details abhi plaintext hain DB mein. Encryption switch-on karne ke baad, ek one-time script chalana padega jo:
   - Har existing row padhe (jahan yeh 3 fields non-null hain)
   - Unhe naye `encrypt()` function se encrypt kare
   - Wapas DB mein update kare
   - **Yeh script sirf AAP apne real database ke against chalaoge** — sandbox se live DB tak network route hi nahi hai (standing constraint), aur yeh ek destructive-ish operation hai (existing data overwrite) jo bina explicit confirmation ke kabhi nahi chalani chahiye.
5. Schema.prisma mein column type `String?` hi rahega (encrypted value bhi ek string hai, base64) — sirf ek comment add karenge documenting ki yeh ab encrypted hai.

**Kyun risky hai:**
- Naya secret env mein chahiye (aapko khud generate/set karna hoga).
- Ek baar encryption on hone ke baad, agar `BANK_DETAILS_ENCRYPTION_KEY` kabhi lost ho gayi, toh saare doctors ke bank details PERMANENTLY unreadable ho jayenge (koi backup-decrypt raasta nahi) — is key ka secure backup rakhna critical hai.
- Live migration script real production data ko modify karta hai — agar kisi bug ki wajah se galat encrypt ho gaya, existing correct data corrupt ho sakta hai. Isliye migration se pehle DB ka fresh backup lena zaroori hoga (aap khud).

**Isliye:** Yeh bhi ek dedicated session mein karna sahi hai — pehle key generate karo, phir main code likh doon, phir aap apne backup ke baad migration script khud chalao.

---

## Summary — Kab Karna Hai

Teeno items abhi **koi urgent production risk nahi** hain (bcrypt sirf install-time, JWT abhi tak koi XSS nahi mila, bank details sirf backup-leak scenario mein risky) — isliye "jab convenient ho" wali priority hai, jaise security audit doc mein bhi likha tha. Jab bhi ready ho, bol dena — teeno independent hain, ek saath ya alag-alag, jaisa comfortable ho.
