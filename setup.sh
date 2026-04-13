#!/bin/bash
# ============================================================
#  AJKMart - One-Click Setup Script
#  Works on: Ubuntu 20.04+, Debian, macOS
#  Usage: bash setup.sh
# ============================================================

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

echo ""
echo -e "${BOLD}${CYAN}============================================${NC}"
echo -e "${BOLD}${CYAN}   AJKMart - Automated Setup Script${NC}"
echo -e "${BOLD}${CYAN}============================================${NC}"
echo ""

# ------------------------------------------------------------
# Step 1: Check/Install Node.js
# ------------------------------------------------------------
echo -e "${BOLD}[1/6] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Node.js not found. Installing Node.js 20...${NC}"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install node@20
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  NODE_VER=$(node -v)
  echo -e "${GREEN}Node.js found: $NODE_VER${NC}"
fi

# ------------------------------------------------------------
# Step 2: Check/Install pnpm
# ------------------------------------------------------------
echo -e "${BOLD}[2/6] Checking pnpm...${NC}"
if ! command -v pnpm &> /dev/null; then
  echo -e "${YELLOW}pnpm not found. Installing pnpm...${NC}"
  npm install -g pnpm
else
  echo -e "${GREEN}pnpm found: $(pnpm -v)${NC}"
fi

# ------------------------------------------------------------
# Step 3: Setup .env file
# ------------------------------------------------------------
echo ""
echo -e "${BOLD}[3/6] Setting up environment variables...${NC}"

if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${GREEN}.env file created from template.${NC}"
else
  echo -e "${YELLOW}.env file already exists. Skipping...${NC}"
fi

echo ""
echo -e "${BOLD}${CYAN}============================================${NC}"
echo -e "${BOLD}  Please configure your .env file now${NC}"
echo -e "${BOLD}${CYAN}============================================${NC}"
echo ""
echo -e "Required settings:"
echo -e "  ${BOLD}DATABASE_URL${NC}  - Your PostgreSQL connection string"
echo -e "  ${BOLD}ADMIN_SECRET${NC}  - A strong secret key for admin access"
echo -e ""

read -p "$(echo -e ${BOLD})Have you configured .env with your DATABASE_URL? (y/n): $(echo -e ${NC})" CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo ""
  echo -e "${YELLOW}Please edit the .env file first:${NC}"
  echo -e "  nano .env"
  echo ""
  echo -e "Then re-run this script: ${BOLD}bash setup.sh${NC}"
  exit 0
fi

# Load .env
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Validate DATABASE_URL
if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" == "postgresql://postgres:yourpassword@localhost:5432/ajkmart" ]; then
  echo -e "${RED}ERROR: DATABASE_URL is not set or still has the default value.${NC}"
  echo -e "Please edit .env and set a real DATABASE_URL."
  exit 1
fi

echo -e "${GREEN}Environment variables loaded successfully.${NC}"

# ------------------------------------------------------------
# Step 4: Install dependencies
# ------------------------------------------------------------
echo ""
echo -e "${BOLD}[4/6] Installing dependencies (this may take a few minutes)...${NC}"
pnpm install
echo -e "${GREEN}Dependencies installed.${NC}"

# ------------------------------------------------------------
# Step 5: Build all apps
# ------------------------------------------------------------
echo ""
echo -e "${BOLD}[5/6] Building all applications...${NC}"
pnpm run -r --if-present build
echo -e "${GREEN}Build complete.${NC}"

# ------------------------------------------------------------
# Step 6: Run database migrations
# ------------------------------------------------------------
echo ""
echo -e "${BOLD}[6/6] Running database migrations...${NC}"
pnpm --filter @workspace/db run migrate
echo -e "${GREEN}Database migrations complete.${NC}"

# ------------------------------------------------------------
# Done!
# ------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}============================================${NC}"
echo -e "${BOLD}${GREEN}   AJKMart Setup Complete!${NC}"
echo -e "${BOLD}${GREEN}============================================${NC}"
echo ""
echo -e "Start the application:"
echo -e "  ${BOLD}pnpm --filter @workspace/api-server run start${NC}  (API Server)"
echo -e ""
echo -e "Or use Docker Compose for everything:"
echo -e "  ${BOLD}docker compose up -d${NC}"
echo ""
