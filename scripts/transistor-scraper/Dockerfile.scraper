# Build context: repository root
# Railway config: Dockerfile path = scripts/transistor-scraper/Dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

# Install scraper dependencies
COPY scripts/transistor-scraper/package.json scripts/transistor-scraper/package-lock.json ./
RUN npm ci --omit=dev

# Generate Prisma Client from portal schema
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
RUN npx prisma generate

# Copy scraper source
COPY scripts/transistor-scraper/*.ts ./

CMD ["npx", "tsx", "index.ts"]
