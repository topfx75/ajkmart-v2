# AJKMart - Free Deployment Guide
# Render (Backend) + Vercel (Frontend) + Neon (Database)

---

## Step 1: Database — Neon.tech (Free PostgreSQL)

1. [neon.tech](https://neon.tech) par signup karein (GitHub se login)
2. **New Project** → name: `ajkmart`
3. Database create hone ke baad **Connection String** copy karein
   - Format: `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`
4. Yeh string save kar lein — aage DATABASE_URL mein use hogi

---

## Step 2: Backend — Render.com (Free API Server)

1. [render.com](https://render.com) par signup karein (GitHub se login)
2. **New** → **Blueprint**
3. GitHub repo select karein: `topfx75/ajkmart-v2`
4. Render automatically `render.yaml` padh kar API server set up karega
5. Deploy shuru hone se pehle yeh **Environment Variables** add karein:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon.tech wali connection string |
| `ADMIN_SECRET` | Koi bhi strong password (jaise: `meri-secret-key-123`) |
| `ALLOWED_ORIGINS` | `https://ajkmart-admin.vercel.app,https://ajkmart-vendor.vercel.app,https://ajkmart-rider.vercel.app` |

6. **Deploy** click karein
7. Deploy hone ke baad URL milegi — jaise: `https://ajkmart-api.onrender.com`
8. Yeh URL save kar lein — Vercel mein use hogi

---

## Step 3: Frontend — Vercel (Admin + Vendor + Rider)

### Admin Panel:

1. [vercel.com](https://vercel.com) → **Add New Project**
2. `ajkmart-v2` repo import karein
3. **Root Directory** → `artifacts/admin` select karein
4. Framework: **Vite** (auto detect hoga)
5. Environment Variables add karein:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://ajkmart-api.onrender.com/api` |
| `VITE_API_BASE_URL` | `https://ajkmart-api.onrender.com` |

6. **Deploy** karein

---

### Vendor App:

1. Vercel → **Add New Project** (same repo, new project)
2. **Root Directory** → `artifacts/vendor-app`
3. Same environment variables add karein
4. **Deploy**

---

### Rider App:

1. Vercel → **Add New Project** (same repo, new project)
2. **Root Directory** → `artifacts/rider-app`
3. Same environment variables add karein
4. **Deploy**

---

## Step 4: Database Migration Run Karein

Render dashboard mein API Server service open karein:
- **Shell** tab click karein
- Yeh command chalayein:
```bash
pnpm --filter @workspace/db run migrate
```

---

## Final URLs (example):

| App | URL |
|-----|-----|
| API Server | `https://ajkmart-api.onrender.com` |
| Admin Panel | `https://ajkmart-admin.vercel.app` |
| Vendor App | `https://ajkmart-vendor.vercel.app` |
| Rider App | `https://ajkmart-rider.vercel.app` |

---

## Note: Render Free Tier

Render ka free tier 15 minute inactivity ke baad **sleep** ho jata hai.
Pehli request pe 30-50 second lag sakte hain (cold start).

Isko fix karne ke liye UptimeRobot (free) se har 10 minute mein ping karwa sakte hain:
- [uptimerobot.com](https://uptimerobot.com) → New Monitor → `https://ajkmart-api.onrender.com/api/health`
