# AJKMart — Complete VPS Deployment Guide
# Replit jaisa professional environment — Zero Errors

---

## Zaroorat (Requirements)

- Ubuntu 22.04 VPS (DigitalOcean / Vultr / Hetzner / Contabo)
- Minimum: 1 CPU, 1GB RAM, 20GB Storage
- Ek domain name (jaise: ajkmart.com)
- Root access

---

## Part 1: Server Setup

### Step 1 — Server Update
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget nano ufw build-essential
```

### Step 2 — Node.js 22 Install
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # v22.x dikhna chahiye
npm -v     # version dikhni chahiye
```

### Step 3 — pnpm Install
```bash
npm install -g pnpm
pnpm -v    # version confirm karein
```

### Step 4 — PM2 Install (Process Manager)
```bash
npm install -g pm2
```

---

## Part 2: Database Setup

### Step 5 — PostgreSQL Install
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Step 6 — Database aur User Banana
```bash
sudo -u postgres psql
```
PostgreSQL prompt mein yeh chalao:
```sql
CREATE DATABASE ajkmart;
CREATE USER ajkmart WITH PASSWORD 'StrongPass123!';
GRANT ALL PRIVILEGES ON DATABASE ajkmart TO ajkmart;
ALTER DATABASE ajkmart OWNER TO ajkmart;
\q
```

### Step 7 — Connection Test
```bash
psql postgresql://ajkmart:StrongPass123!@localhost:5432/ajkmart -c "SELECT version();"
# Version dikhni chahiye — matlab connection theek hai
```

---

## Part 3: Project Setup

### Step 8 — Project Clone
```bash
cd /var/www
git clone https://github.com/topfx75/ajkmart-v2.git
cd ajkmart-v2
```

### Step 9 — Environment Variables
```bash
cp .env.example .env
nano .env
```

`.env` mein yeh values set karein:

```env
# Database
DATABASE_URL=postgresql://ajkmart:StrongPass123!@localhost:5432/ajkmart

# API Server
PORT=3000
NODE_ENV=production
ADMIN_SECRET=apna-koi-bhi-strong-secret-yahan-likhein

# Frontend Origins (apna domain)
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Frontend ke liye API URL
VITE_API_URL=https://yourdomain.com/api
VITE_API_BASE_URL=https://yourdomain.com
```

Nano mein save karne ke liye: `Ctrl+X` → `Y` → `Enter`

### Step 10 — Dependencies Install
```bash
pnpm install
```

### Step 11 — Sab Apps Build Karo
```bash
# Shared libraries
pnpm run typecheck:libs || true

# API Server
pnpm --filter @workspace/api-server run build

# Admin Panel
pnpm --filter @workspace/admin run build

# Vendor App
pnpm --filter @workspace/vendor-app run build

# Rider App
pnpm --filter @workspace/rider-app run build
```

### Step 12 — Database Migration
```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
pnpm --filter @workspace/db run migrate
```

---

## Part 4: API Server Chalana (PM2)

### Step 13 — PM2 se API Server Start
```bash
pm2 start "node --enable-source-maps /var/www/ajkmart-v2/artifacts/api-server/dist/index.mjs" \
  --name ajkmart-api \
  --env production

# Status check
pm2 status

# Logs dekhne ke liye
pm2 logs ajkmart-api
```

### Step 14 — PM2 Auto-Start (Server restart ke baad bhi chale)
```bash
pm2 startup
# Jo command milegi woh run karein (sudo ke saath)
pm2 save
```

---

## Part 5: Nginx Setup (Web Server + Reverse Proxy)

### Step 15 — Nginx Install
```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Step 16 — Nginx Config Banana
```bash
sudo nano /etc/nginx/sites-available/ajkmart
```

Poora yeh paste karein (yourdomain.com apne domain se replace karein):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";

    # API Server (Backend)
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Socket.io (Real-time)
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Admin Panel
    location /admin {
        alias /var/www/ajkmart-v2/artifacts/admin/dist;
        try_files $uri $uri/ /admin/index.html;
        expires 1d;
        add_header Cache-Control "public";
    }

    # Vendor App
    location /vendor {
        alias /var/www/ajkmart-v2/artifacts/vendor-app/dist;
        try_files $uri $uri/ /vendor/index.html;
        expires 1d;
        add_header Cache-Control "public";
    }

    # Rider App
    location /rider {
        alias /var/www/ajkmart-v2/artifacts/rider-app/dist;
        try_files $uri $uri/ /rider/index.html;
        expires 1d;
        add_header Cache-Control "public";
    }

    # Root → Admin redirect
    location = / {
        return 301 /admin;
    }

    # File upload size
    client_max_body_size 50M;
}
```

### Step 17 — Nginx Enable aur Test
```bash
sudo ln -s /etc/nginx/sites-available/ajkmart /etc/nginx/sites-enabled/
sudo nginx -t        # "test is successful" dikhna chahiye
sudo systemctl restart nginx
```

---

## Part 6: SSL Certificate (Free HTTPS)

### Step 18 — Certbot Install
```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Step 19 — SSL Certificate Lena
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

- Email daalein
- Terms accept karein (A)
- Auto-redirect select karein (2)

### Step 20 — Auto-Renewal Test
```bash
sudo certbot renew --dry-run
# "Congratulations" dikhna chahiye
```

---

## Part 7: Firewall Setup

### Step 21 — Firewall Rules
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## Part 8: Final Check

### Step 22 — Sab Services Status
```bash
pm2 status                    # API Server running
sudo systemctl status nginx   # Nginx running
sudo systemctl status postgresql  # Database running
```

### Step 23 — API Health Check
```bash
curl https://yourdomain.com/api/health
# {"status":"ok"} dikhna chahiye
```

---

## Final URLs

| App | URL |
|-----|-----|
| Admin Panel | `https://yourdomain.com/admin` |
| Vendor App | `https://yourdomain.com/vendor` |
| Rider App | `https://yourdomain.com/rider` |
| API Server | `https://yourdomain.com/api` |

---

## Update Script (Future Updates ke liye)

Har baar code update karne ke liye:
```bash
cd /var/www/ajkmart-v2
git pull
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/admin run build
pnpm --filter @workspace/vendor-app run build
pnpm --filter @workspace/rider-app run build
pm2 restart ajkmart-api
echo "Update complete!"
```

Ya `update.sh` script bana lo:
```bash
nano /var/www/ajkmart-v2/update.sh
# Upar wala code paste karo
chmod +x /var/www/ajkmart-v2/update.sh

# Future mein sirf yeh chalao:
bash /var/www/ajkmart-v2/update.sh
```

---

## Troubleshooting

**API nahi chal raha:**
```bash
pm2 logs ajkmart-api --lines 50
```

**Nginx error:**
```bash
sudo nginx -t
sudo journalctl -u nginx -n 50
```

**Database connect nahi:**
```bash
psql postgresql://ajkmart:StrongPass123!@localhost:5432/ajkmart -c "SELECT 1;"
```

**Port already in use:**
```bash
sudo lsof -ti:3000 | xargs kill -9
pm2 restart ajkmart-api
```

**Permissions error:**
```bash
sudo chown -R $USER:$USER /var/www/ajkmart-v2
```
