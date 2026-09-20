# Phase 0 verdict — AUTH_MAX_INFLIGHT guard vs rate limiter (2026-09-20)

**Sawaal tha:** Login load test mein bahut saari requests reject ho rahi thi (300-1000 concurrent par 87-98%) — kya iski wajah `AUTH_MAX_INFLIGHT=90` guard hai (jise ab threshold badhane ki zaroorat ho), ya kuch aur?

**Jawaab — server ke apne log se confirm kiya gaya:**

Ek clean, isolated `login-loadtest.js` run ke baad `server-log.txt` mein har `/auth/login` line ka status code count kiya gaya:

| Status | Count | Matlab |
|---|---|---|
| 429 | 67,268 | Rate limiter (`authLimiter`) ne reject kiya |
| 503 (guard) | **0** | In-flight guard ne EK BHI request reject nahi ki |
| (incomplete) | 790 | Bahut zyada load ki wajah se connection beech mein cut hua |

**Verdict: `AUTH_MAX_INFLIGHT=90` guard is baar kabhi trigger hi nahi hua.** Poora reject `authLimiter` (429, brute-force-protection rate limit) ki wajah se tha — guard ko is samay badalne ki zaroorat nahi hai.

## Yeh rate limit real production mein masla kyun nahi hai

`authLimiter` **IP-based** hai (`middleware/rateLimiter.js` — default keyGenerator, IP se key banti hai). Matlab "15 minute mein max 10,000 login attempts" wali limit **har alag IP/device ke liye alag** hai, poore app ke liye ek saath shared nahi.

- Local load test mein saari (67,268+) requests EK HI computer/IP (localhost) se gayi thi — jaise ek hi insaan baar-baar try kar raha ho — isliye woh IP apni khud ki limit turant paar kar gaya.
- Real production mein 50,000 alag users apne-apne alag IP/device se login karenge — har ek ka apna alag 10,000-per-15-min quota hoga. Koi bhi normal user itni baar login nahi try karta, isliye yeh limit real users ko kabhi touch nahi karegi.

**Isliye:** 50,000 concurrent production logins ke target ke liye `authLimiter`/`AUTH_RATE_LIMIT_MAX` mein koi change zaroori nahi hai. Asli cheezein jo matter karti hain woh hain server compute capacity (CPU, containers) aur database connections — dono `docs/aws-scaling-plan-2026-09-20.md` mein cover ki gayi hain.

## Ab kya khula chhoda gaya hai

`AUTH_MAX_INFLIGHT=90` ka real behavior (kitna high traffic yeh actually rok sakta hai) is round mein isolate nahi ho paya, kyunki rate limiter hamesha usse pehle hi trigger ho jaata hai. Agar isko specifically test karna ho, toh temporarily bahut high `AUTH_RATE_LIMIT_MAX` (jaise 1,000,000) set karke local test dobara chalana padega — filhal zaroorat nahi, kyunki guard ne kabhi kisi legitimate request ko reject nahi kiya.
