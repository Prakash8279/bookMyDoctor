# BookMyDoctor24 — 50,000 Concurrent Login Production Plan (AWS)

**Sawaal:** Production mein AWS par deploy karke, 50,000 log ek saath login kar sakein — aur cloud ka bill bhi kam rahe.

**Seedha jawaab:** Yeh scale (50,000 ek saath) achieve hoga **auto-scaling** se — matlab kaam ke hisaab se apne aap chhote/zyada servers chalte hain. Isi wajah se bill bhi kam rehta hai: jab traffic kam ho (raat ko, normal din), tab bahut kam servers chalte hain aur kam paisa lagta hai. Jab traffic ka spike aaye (50,000 jaisa), tab woh apne aap badh jaate hain, aur spike khatam hote hi wapas kam ho jaate hain. Aap 24 ghante ke liye "50,000 capacity" ka paisa kabhi nahi dete — sirf jitni der zaroorat ho utni der ka.

Ek cheez clearly samajh lo: yeh ek EK COMPUTER/SERVER se possible nahi hai, chahe kitna bhi tuning kar lo — hardware ki limit hai. Real companies bhi 50,000 jaisa scale isi tarah — **kai chhote servers milkar** — handle karte hain, ek bada server se nahi.

---

## 1. Architecture — kya-kya lagega

Simple shabdon mein, poora system 5 main hisso mein banta hai:

1. **Load Balancer (AWS Application Load Balancer / ALB)** — sabse aage khada rehta hai. Har incoming request ko available servers mein baant deta hai. Yeh already aapke code mein support hai (`/health` endpoint already bana hua hai isi purpose ke liye — server sahi hai ya nahi, ALB isi se check karta hai).

2. **API Servers (AWS ECS Fargate — auto-scaling)** — aapka Node.js server yahin chalega. "Fargate" ka matlab hai aapko khud se server manage nahi karna padta — bas kitne "containers" chahiye woh AWS khud manage karta hai. Traffic badhne par apne aap zyada containers chalu ho jaate hain, kam hone par band ho jaate hain. Aapke paas already `Dockerfile` (container image) ready hai — isi ka use hoga.

3. **Database (AWS RDS for PostgreSQL + RDS Proxy)** — Postgres database. Dikkat yeh hai ki jab bahut saare API containers ek saath chalenge (jaise 50-100), har ek apna alag database connection banata hai — Postgres ek limit ke baad "too many connections" error dene lagta hai. **RDS Proxy** ek beech ka layer hai jo hazaaron connections ko kam, efficient connections mein convert kar deta hai — isse database overload nahi hota. Yeh is scale ke liye zaroori hai.

4. **Redis (AWS ElastiCache)** — aapke code mein already Redis use ho raha hai (rate limiting aur booking lock ke liye) — yeh managed AWS version hai, taaki khud Redis server maintain na karna pade.

5. **Auto-Scaling Rules** — yeh batata hai AWS ko: "jab CPU ya requests zyada ho jaayein, naye containers chalu karo; jab kam ho jaayein, band kar do." Isi se bill control mein rehta hai.

```
User → ALB (load balancer) → ECS Fargate (kai API containers, auto-scale) → RDS Proxy → Postgres
                                              ↓
                                         ElastiCache (Redis)
```

---

## 2. Bill kam kaise rahega — cost control ke tareeke

- **Auto-scale to minimum:** Normal traffic mein sirf 1-2 chhote containers chalenge (bahut kam cost). Spike (50,000) ke time hi zyada chalenge, aur spike khatam hote hi wapas kam ho jayenge.
- **Fargate Spot:** Extra capacity (jo sirf spike ke time chahiye) ke liye "Spot" pricing use kar sakte hain — normal price se **60-70% tak sasta**, bas thoda risk hai ki AWS zaroorat padne par wapas le sakta hai (isliye sirf extra/burst capacity ke liye, baseline ke liye nahi).
- **RDS Proxy** khud thoda extra cost hai, lekin isse bada, mehenga database plan lena nahi padta — chhota database instance bhi 50,000 connections handle kar leta hai proxy ke through.
- **Right-sizing:** Shuru mein chhote instance size se start karo, real traffic dekh kar hi bada karo — andaza laga kar bada instance lena paisa waste hai.
- **CloudWatch alarms** laga dena taaki bill achanak zyada badhe toh turant pata chal jaye.

**Note on exact prices:** AWS ke rates region aur time ke saath badalte rehte hain, isliye is document mein exact ₹/$ number nahi diya — jab deploy karne ka time aaye, tab **AWS Pricing Calculator** (aws.amazon.com/pricing/calculator) se apne expected traffic ke hisaab se sahi, current estimate nikaalna sahi rahega.

---

## 3. Code mein pehle se kya ready hai (achha news)

Jab maine code check kiya, kaafi cheezein pehle se hi is tarah ke scaling ke liye taiyar mili:

- Login JWT token se hota hai, server pe koi session save nahi hoti — matlab koi bhi request kisi bhi container pe ja sakti hai, koi "sticky" requirement nahi.
- Rate-limiting aur booking-lock already Redis mein shared hai — matlab 100 containers bhi chalein, sab ek hi jagah count karte hain, sahi tarika hai.
- Database connection pool size already ek env variable (`DB_POOL_SIZE`) se control hoti hai — RDS Proxy ke saath isko chhota rakhna hoga (jaise 5) taaki total connections control mein rahein.
- Password security strength (`BCRYPT_SALT_ROUNDS`) bhi already ek env variable hai — zaroorat padne par tune kar sakte hain.
- `/health` endpoint pehle se bana hua hai, load balancer isi se check karega ki container zinda hai ya nahi.
- Maine pichhle step mein ek `cluster.js` bhi add kiya tha (single machine par sab CPU cores use karne ke liye) — AWS Fargate setup mein iski utni zaroorat nahi (wahan zyada CONTAINERS chalate hain, ek container ke andar clustering ki jagah), lekin nuksaan bhi nahi karta.

Matlab: **code side se koi bada blocker nahi hai** — jo kaam bacha hai woh hai actual AWS resources banana aur unhe configure karna.

---

## 4. Aage kya karna hai (step-by-step)

Yeh steps AWS account ke andar cheezein banayenge — **inmein se kuch cheezon ka paisa lagता hai**, isliye har bade step se pehle main aapse confirm karunga, khud se kabhi bina bataye AWS resource nahi banaunga. Aur **aapka AWS password/access key kabhi bhi main type/enter nahi karunga** — woh aapko khud AWS Console mein login karke karna hoga.

1. AWS account ready karna (agar nahi hai) aur billing alert set karna (taaki koi surprise bill na aaye).
2. RDS PostgreSQL database banana + RDS Proxy attach karna.
3. ElastiCache Redis banana.
4. Container image (Docker) ko AWS ECR (image storage) mein upload karna.
5. ECS Fargate service banana, auto-scaling rules set karna (min/max containers).
6. ALB (load balancer) laga kar `/health` endpoint se jodna.
7. Environment variables set karna (DATABASE_URL, REDIS_URL, JWT secrets, etc. — yeh sab AWS ke apne secure jagah mein jaayenge, kahin file mein plain likh kar nahi).
8. Load test karke dekhna ki auto-scaling sahi se kaam kar raha hai.

**Batao jab AWS account use karne ke liye ready ho — tab hum ek-ek step confirm karte hue aage badhenge.**
