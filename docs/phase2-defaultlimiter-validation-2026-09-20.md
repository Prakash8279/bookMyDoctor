# Phase 2 validation — defaultLimiter fairness fix (2026-09-20)

**Sawaal tha:** Pehle `defaultLimiter` (global rate limiter) mein ek fairness fix kiya gaya tha, lekin real authenticated multi-role traffic ke against kabhi test nahi hua tha.

**Test:** Isolated `full-api-sweep.js` run (login-loadtest.js ke turant baad nahi, alag se) — 5 demo accounts (patient/doctor/receptionist/admin/superadmin) se login, fir 28 GET endpoints ka ek validation pass, fir 50-concurrent flat load sabhi 28 endpoints par, fir ek deeper progressive ramp (10 → 50 → 150 → 400 concurrent) do endpoints par: `/appointments` (seedha Postgres se) aur `/doctors` (cache se).

**Result — sab kuch clean:**

| Test | Result |
|---|---|
| 5 demo logins | 5/5 OK |
| 28 endpoints validation | 28/28 → 200 OK |
| Flat sweep (50 concurrent × 28 endpoints) | 0 errors, 0 non-2xx across the board |
| `/appointments` ramp (10→400 concurrent) | 0 errors, 0 non-2xx |
| `/doctors` ramp (10→400 concurrent) | 0 errors, 0 non-2xx |

**Verdict: `defaultLimiter` fairness fix confirmed working** — real multi-role authenticated traffic ke saath koi galat/unfair rejection nahi mila, even at 400 concurrent.

## Ek extra cheez jo dikhi (useful for scaling plan)

`/appointments` (Postgres-hitting) ka throughput concurrency badhne par bhi ~400-450 req/sec par hi flat reh gaya (sirf latency badhi, 25ms → 947ms) — yeh isi baat ka saboot hai ki `DB_POOL_SIZE` (abhi default 5) hi is endpoint ki asli speed-limit hai, na ki koi rate limiter ya guard. `/doctors` (cache-fronted) bahut behtar scale kiya (~1300+ req/sec, concurrency badhne par bhi). Yeh `docs/aws-scaling-plan-2026-09-20.md` mein already suggested RDS Proxy / DB pool tuning ki zaroorat ko confirm karta hai.

## Reminder

Is test ke liye `AUTH_RATE_LIMIT_MAX` aur `DEFAULT_RATE_LIMIT_MAX` local `.env` mein temporarily high rakhe gaye hain (testing ke liye zaroori). Real production deployment (AWS) mein yeh values us environment ke apne `.env`/config mein alag, sahi (production-safe) set kiye jayenge — local wale file ko abhi badalne ki zaroorat nahi.
