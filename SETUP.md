# AJKMart - Setup Guide

## Quick Start (Kisi bhi Server par)

### Option 1: Simple Setup (Recommended)

**Step 1: Project download karein**
```bash
git clone https://github.com/topfx75/ajk-mart-super-app.git
cd ajk-mart-super-app
```

**Step 2: Setup script chalayein**
```bash
bash setup.sh
```

Script khud se:
- Node.js install karega (agar nahi hai)
- pnpm install karega
- `.env` file banayega
- Dependencies install karega
- Database migrate karega

---

### Option 2: Docker (Sabse Asan)

Agar Docker installed hai toh sirf 2 commands:

```bash
# 1. .env file banayein
cp .env.example .env
# (nano .env se DATABASE_URL edit karein)

# 2. Sab kuch start karein
docker compose up -d
```

Phir open karein:
- **Admin Panel:** http://localhost:5173
- **API Server:** http://localhost:3000
- **Vendor App:** http://localhost:5174
- **Rider App:** http://localhost:5175

---

### Option 3: Google Project IDX

[![Open in IDX](https://cdn.idx.dev/btn/open_dark_32.svg)](https://idx.google.com/import?url=https://github.com/topfx75/ajk-mart-super-app)

IDX automatically:
- Environment setup karega
- `pnpm install` chalayega
- Apps start karega

---

## Environment Variables (.env)

Sirf in variables zaroor set karein:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/ajkmart` |
| `ADMIN_SECRET` | Admin API secret key | `openssl rand -hex 32` se generate karein |
| `VITE_API_URL` | Frontend ke liye API URL | `https://api.yourdomain.com/api` |
| `EXPO_PUBLIC_DOMAIN` | Mobile app ke liye server | `https://api.yourdomain.com` |

---

## Database Connection String Format

```
postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE_NAME
```

### Cloud Database Examples:

**Supabase:**
```
postgresql://postgres.xxxxx:yourpassword@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

**Neon.tech:**
```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/ajkmart?sslmode=require
```

**Railway:**
```
postgresql://postgres:randompassword@containers-us-west-xxx.railway.app:5432/railway
```

**Local PostgreSQL:**
```
postgresql://postgres:yourpassword@localhost:5432/ajkmart
```

---

## Production Deployment

### VPS (Ubuntu/Debian)

```bash
# Server setup
sudo apt update && sudo apt install -y git curl

# Project clone
git clone https://github.com/topfx75/ajk-mart-super-app.git
cd ajk-mart-super-app

# Setup
bash setup.sh

# Production mein start karein (PM2 se)
npm install -g pm2
pm2 start "pnpm --filter @workspace/api-server run start" --name ajkmart-api
pm2 startup
pm2 save
```

### Vercel / Netlify (Frontend only)

Admin Panel ke liye:
- Build command: `pnpm --filter @workspace/admin run build`
- Output directory: `artifacts/admin/dist`
- Environment: `VITE_API_URL=https://your-api-server.com/api`

---

## Secrets Copy Karna (Ek server se dosre par)

Apne purane server se secrets export karein:
```bash
cat .env
```

Naey server par paste karein:
```bash
nano .env
# (paste karein aur save karein: Ctrl+X, Y, Enter)
```

---

## Troubleshooting

**Database connect nahi ho raha:**
```bash
# Test connection
psql "$DATABASE_URL" -c "SELECT version();"
```

**Port already in use:**
```bash
sudo lsof -ti:3000 | xargs kill -9
```

**Dependencies error:**
```bash
rm -rf node_modules
pnpm install
```
