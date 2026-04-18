FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Pin yt-dlp and deno versions for reproducible builds
ENV YT_DLP_VERSION=2026.03.17
ENV DENO_VERSION=v2.7.12
RUN apk add --no-cache ffmpeg python3 curl unzip && \
    wget -q "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip && \
    unzip -q /tmp/deno.zip -d /usr/local/bin && \
    chmod a+rx /usr/local/bin/deno && \
    rm /tmp/deno.zip && \
    apk del curl unzip

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy migration files and runner script (pg is already in standalone output)
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

USER nextjs

ENV PORT=${PORT:-3000}
ENV HOSTNAME="0.0.0.0"

# Run pending migrations then start the server
CMD node scripts/migrate.mjs && node server.js
