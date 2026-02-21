# ── Frontend (Next.js) ───────────────────────────────────────
FROM node:18-alpine AS base

# 1️⃣ Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2️⃣ Build the Next.js app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma generate before build
RUN npx prisma generate
RUN npm run build

# 3️⃣ Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy built assets (.next-dev is the configured distDir)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next-dev ./.next-dev
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000

CMD ["npm", "start"]
