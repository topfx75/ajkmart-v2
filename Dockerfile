# ============================================================
#  AJKMart - Multi-stage Dockerfile
# ============================================================

# Base image with Node.js + pnpm
FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all package.json files first (for layer caching)
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/auth-utils/package.json ./lib/auth-utils/
COPY lib/i18n/package.json ./lib/i18n/
COPY lib/phone-utils/package.json ./lib/phone-utils/
COPY lib/service-constants/package.json ./lib/service-constants/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/admin/package.json ./artifacts/admin/
COPY artifacts/vendor-app/package.json ./artifacts/vendor-app/
COPY artifacts/rider-app/package.json ./artifacts/rider-app/

RUN pnpm install --frozen-lockfile

# Copy full source
COPY . .

# Build shared libs
RUN pnpm run typecheck:libs || true

# ============================================================
#  API Server Target
# ============================================================
FROM base AS api-builder
RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine AS api
RUN npm install -g pnpm
WORKDIR /app
COPY --from=api-builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=api-builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/lib ./lib
COPY --from=api-builder /app/package.json ./
COPY --from=api-builder /app/pnpm-workspace.yaml ./
EXPOSE 3000
CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]

# ============================================================
#  Admin Panel Target
# ============================================================
FROM base AS admin-builder
ARG VITE_API_URL
ARG VITE_API_BASE_URL
RUN pnpm --filter @workspace/admin run build

FROM nginx:alpine AS admin
COPY --from=admin-builder /app/artifacts/admin/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ============================================================
#  Vendor App Target
# ============================================================
FROM base AS vendor-builder
ARG VITE_API_URL
ARG VITE_API_BASE_URL
RUN pnpm --filter @workspace/vendor-app run build

FROM nginx:alpine AS vendor
COPY --from=vendor-builder /app/artifacts/vendor-app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# ============================================================
#  Rider App Target
# ============================================================
FROM base AS rider-builder
ARG VITE_API_URL
ARG VITE_API_BASE_URL
RUN pnpm --filter @workspace/rider-app run build

FROM nginx:alpine AS rider
COPY --from=rider-builder /app/artifacts/rider-app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
