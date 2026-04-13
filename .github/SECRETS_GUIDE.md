# GitHub Secrets Setup Guide
# AJKMart CI/CD ke liye

## Ye secrets GitHub par add karein:
## GitHub Repo → Settings → Secrets and variables → Actions → New repository secret

| Secret Name         | Value Kahan se milega                          | Example                                      |
|---------------------|------------------------------------------------|----------------------------------------------|
| `SSH_HOST`          | Apne VPS ka IP ya domain                      | `123.456.789.0` ya `api.yourdomain.com`      |
| `SSH_USERNAME`      | Server ka SSH user                             | `ubuntu` ya `root`                           |
| `SSH_PRIVATE_KEY`   | SSH private key (poori content)               | `-----BEGIN OPENSSH PRIVATE KEY-----...`     |
| `SSH_PORT`          | SSH port (default 22)                          | `22`                                         |
| `DATABASE_URL`      | PostgreSQL connection string                   | `postgresql://user:pass@host:5432/ajkmart`   |
| `ADMIN_SECRET`      | Admin API secret                               | `openssl rand -hex 32` se generate karein    |
| `ALLOWED_ORIGINS`   | Frontend URLs (comma separated)               | `https://admin.yourdomain.com`               |
| `VITE_API_URL`      | API URL for frontend                           | `https://api.yourdomain.com/api`             |
| `VITE_API_BASE_URL` | API base URL                                   | `https://api.yourdomain.com`                 |
| `EXPO_PUBLIC_DOMAIN`| Mobile app ka server domain                   | `https://api.yourdomain.com`                 |

---

## SSH Key Banana (agar nahi hai):

```bash
# Apne local PC par:
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/ajkmart_deploy

# Public key server par copy karein:
ssh-copy-id -i ~/.ssh/ajkmart_deploy.pub username@your-server-ip

# Private key GitHub Secret mein paste karein:
cat ~/.ssh/ajkmart_deploy
```

---

## First Time Server Setup:

```bash
# Server par ek baar manually:
sudo apt update && sudo apt install -y nodejs npm nginx
npm install -g pnpm pm2
sudo mkdir -p /opt/ajkmart
sudo chown $USER:$USER /opt/ajkmart
```

---

## Workflow Kaise Kaam Karta Hai:

```
Code Push to main
       ↓
  [CI Workflow]
  - pnpm install
  - typecheck
  - build all apps
       ↓
  [Deploy Workflow]
  - builds upload to server via SSH
  - .env file create
  - DB migrations run
  - PM2 se API restart
       ↓
  App Live!
```

## Manual Deploy (bina push ke):
GitHub → Actions → "Deploy to Server" → Run workflow → Run workflow
