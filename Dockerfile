# ── Frontend (Next.js) ───────────────────────────────────────
FROM node:18-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

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

# Build args – Next.js inlines NEXT_PUBLIC_* at build time
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

# Prisma generate before build
RUN npx prisma generate
RUN npm run build

# 3️⃣ Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 nextjs

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
