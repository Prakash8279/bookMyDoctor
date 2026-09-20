# BookMyDoctor24 — Data Load Review (2026-09-20)

**Scope:** Backend (Prisma queries), frontend (API call patterns), aur existing load-testing tool ka status.
**Method:** Puri codebase ka static review — DB query efficiency, pagination, indexes, caching, aur frontend se kitni baar/kitna data call ho raha hai. Koi live database ya real server touch nahi kiya gaya (sandbox se aapke local server tak network route hi nahi hai).

## Overall verdict

Backend **already kaafi optimized hai** — N+1 query pattern (jahan 1 list ke liye 1 query lagti hai lekin phir har item ke liye alag-alag extra query chal jaati hai) **kahin nahi mila**, aur pagination/indexes/caching zyadatar jagah sahi se lagi hui hai. Frontend mein bhi zyadatar cheezein sahi hain, lekin **queue aur booking status ke liye polling thoda aggressive hai** — yeh sabse bada real load-risk hai jo mila.

---

## Backend findings

### 1. [Medium] Live queue list 500 tokens pe cap hai, real pagination nahi
- **Kahan:** `server/server/src/modules/queue/queue.service.js` (`listQueue`, `MAX_QUEUE_FETCH = 500`)
- **Kya hai:** Agar ek clinic ke ek din mein 500 se zyada queue tokens ban jayein (jaise kisi bade camp/mela mein), toh 500 ke baad wale patients ka "aapse pehle kitne log hain" aur "estimated wait time" galat ho jaata hai — silently, sirf ek warning log hoti hai, error nahi.
- **Fix:** Isse proper `skip`/`take` pagination mein convert karein, ya per-doctor limit lagayein taaki total kabhi 500 cross na kare.

### 2. [Low-Medium] `ActivityLog.actionType` filter par index nahi hai
- **Kahan:** `prisma/schema.prisma` — `ActivityLog` model, aur `admin.service.js` jahan `actionType` se filter hota hai.
- **Risk:** Abhi 30-second cache ki wajah se load kam hai, lekin jaise-jaise activity log table badi hoti jayegi (har action ek row banati hai), yeh filter slow ho sakta hai bina index ke.
- **Fix:** `@@index([actionType, createdAt])` add karein.

### 3. [Low] `Notification` table par koi index nahi
- Kam priority hai kyunki yeh table sirf admin broadcasts se badhti hai (per-user events nahi), aur already cached hai. Future-proofing ke liye index add kar sakte hain.

### Jo backend mein already sahi hai
- **N+1 query pattern kahin nahi mila** — har list-loop pehle se fetched data par hi kaam karta hai, dobara query nahi maarta.
- **Pagination** almost har list endpoint (appointments, payments, doctors, medical records, reviews, complaints, clinics, geography, receptionists, family members, notifications) mein `skip/take` + `count` ke saath sahi se lagi hai.
- **Indexes** hot models (Appointment, Payment, DoctorProfile) par actual query patterns se match karte hain.
- **Redis caching** read-heavy, kam-badalne-wale endpoints (cities/areas/specializations list, doctor search, clinics list, admin dashboard stats) par sahi se lagi hai, fail-open design ke saath (Redis down ho toh bhi app crash nahi hoga).
- **bcrypt** hamesha async use hota hai request path mein — event loop block nahi hota.

---

## Frontend findings

### 1. [High] Booking confirm hone ka status har 1.7 second mein poll hota hai, 40 second tak
- **Kahan:** `client/src/store/useAppStore.js` — `createAppointment` function.
- **Kya hai:** Booking submit karne ke baad, frontend `booking-status/:jobId` endpoint ko **har 1.7 second mein** call karta hai, up to 40 seconds tak (matlab 1 booking = up to ~23 extra GET requests).
- **Real load scenario:** Subah jab OPD slots khulte hain aur 500 log ek saath booking karte hain, sirf yeh polling hi ~11,000 extra requests ek minute mein bana sakti hai — bilkul usi waqt jab backend ka booking-queue worker already sabse zyada busy hota hai.
- **Fix:** Exponential backoff use karein (1.5s → 3s → 5s → ...) ya WebSocket/Server-Sent-Events se push notification bhejें, polling ki jagah.

### 2. [Medium-High] Live queue status 4 alag jagah se independently poll ho raha hai, har 15 second mein
- **Kahan:** `PatientPages.jsx`, `PortalSectionPages.jsx` (2 jagah), `PublicPages.jsx` — sab apna-apna `setInterval(load, 15000)` chala rahe hain.
- **Risk:** 200 patients agar ek saath queue page dekh rahe hon, toh ~800 requests/min chalti rahengi — aur tab background mein ho tab bhi polling nahi rukti.
- **Fix:** Ek shared polling hook banayein (sab jagah reuse ho), aur `document.visibilitychange` check add karein taaki tab background mein ho toh polling ruk jaye.

### 3. [Medium] Admin list pages har baar poora data dobara fetch karte hain
- **Kahan:** Doctor Verification, Manage Patients, Manage Clinics (AdminPages.jsx) — tab switch karke wapas aane par bhi poori list (100 rows tak) dobara fetch hoti hai, koi caching nahi.
- **Fix:** Chhota client-side cache/TTL add karein taaki 30-60 second ke andar dobara aane par re-fetch na ho.

### Jo frontend mein already sahi hai
- Doctor search **client-side filtering** use karta hai (ek baar 100 doctors fetch, phir sab filters browser mein) — **keystroke pe koi API call nahi jaati**, debounce ki zaroorat hi nahi.
- Independent data (specializations, cities, doctors, clinics) `Promise.allSettled` se **parallel** fetch hota hai, sequential waterfall nahi.
- 401 token-refresh calls automatically de-duplicate hoti hain agar multiple requests ek saath fail hon.
- Notifications ka 30-second poll interval backend ke cache TTL se match karta hai — yeh deliberate aur sahi hai.

---

## Actual "load test" (concurrency) ke baare mein

Aapke repo mein already ek **load-testing tool** maujood hai: `loadtest/login-loadtest.js` — yeh login endpoint ko 20 se 1000 concurrent requests tak test karta hai, taaki dekha ja sake server kitna load handle kar sakta hai.

**Important:** Yeh test sirf aapke apne PC ke real terminals (server + worker + Redis chal rahe hon) ke against chal sakta hai — maine check kiya, is sandbox aur aapke device ke isolated environment se aapke local server (`localhost:4000`) tak koi network route nahi hai ("connection refused" aaya). Isliye yeh test **sirf aap khud apne PC par** chala sakte hain:

1. `server/.env` mein `AUTH_RATE_LIMIT_MAX` ko temporarily `100000` kar dein, server restart karein.
2. `loadtest` folder mein `npm install` phir `node login-loadtest.js` chalayein.
3. Output copy karke mujhe bhej dein — main results padh ke agla step bata dunga.
4. Test ke baad `AUTH_RATE_LIMIT_MAX` wapas `10` kar dein aur server restart karein (login endpoint ko unprotected mat chhodiye).

Agar chahein toh main yeh steps aur detail mein guide kar sakta hoon.

---

## Priority action list

1. **Booking-status polling ko backoff mein badlein** (Finding #1, frontend) — sabse bada real-world load risk hai.
2. **Queue polling ko ek shared hook mein consolidate karein + tab-hidden pe pause karein** (Finding #2, frontend).
3. **Queue list ko proper pagination dein**, 500-cap hatayein (Finding #1, backend).
4. Admin list pages ke liye chhota caching layer add karein (Finding #3, frontend) — lower priority.
5. `ActivityLog`/`Notification` par indexes add karein — jab table badi hone lage tab bhi kar sakte hain, abhi urgent nahi.
6. Jab convenient ho, `loadtest/login-loadtest.js` chalakar real concurrency numbers dekhein.

*Yeh review static code analysis par based hai — koi live traffic ya real load generate nahi kiya gaya.*
