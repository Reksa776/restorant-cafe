# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# `next build` imports route modules while collecting route metadata. It needs
# a syntactically valid URL for Prisma client construction, but never uses this
# build-only value at runtime; Compose injects the real DATABASE_URL then.
ENV DATABASE_URL="mysql://prisma_build:prisma_build@127.0.0.1:9/prisma_build"

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Migration runner
#
# Kept separate from the web image so Compose can apply the checked-in Prisma
# migrations once, before either long-running process starts.  It deliberately
# uses `db:deploy` (rather than raw `prisma migrate deploy`) so the repository's
# fail-closed migration-order preflight is always enforced.
FROM deps AS migrate
WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tools ./tools

CMD ["npm", "run", "db:deploy"]

# Stage 3: Runner — Next.js App
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.package-lock.json ./node_modules/.package-lock.json

# Create directory for WhatsApp sessions
RUN mkdir -p /app/whatsapp-session && chown nextjs:nodejs /app/whatsapp-session

# Writable runtime directory for product image uploads (mounted as a volume).
# Deliberately NOT under public/: Next.js indexes public/ at boot, so runtime
# files must live here and are served by the /uploads/products/... route from
# disk on every request.
RUN mkdir -p /app/uploads/products && chown nextjs:nodejs /app/uploads

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
