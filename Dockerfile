# 1. Base Image (Node.js ka latest version)
FROM node:22-slim

# 2. pnpm install karne ke liye
RUN npm install -g pnpm

# 3. Container ke andar folder banana
WORKDIR /app

# 4. Files copy karna
COPY . .

# 5. Saari dependencies install karna
RUN pnpm install

# 6. Backend ko build karna
RUN pnpm --filter @workspace/api-server run build

# 7. Environment Variables (optional, defaults)
ENV PORT=10000

# 8. Port expose karna
EXPOSE 10000

# 9. App start karne ki command
CMD ["node", "artifacts/api-server/dist/index.mjs"]
