# Voryn Connect API — production image.
# Multi-stage: install + build with dev deps, then run a slim runtime image.

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app

# System deps: openssl for Prisma engines.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install workspace deps. The API is an npm-workspaces package, so copy the
# root manifest + the api manifest, then install just what the API needs.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace apps/api --include-workspace-root

# Copy source and build.
COPY apps/api apps/api
RUN npm run prisma:generate --workspace apps/api \
  && npm run build --workspace apps/api

# ---- runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Production node_modules only.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace apps/api --include-workspace-root --omit=dev

# Built app + Prisma schema/migrations + generated client.
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma node_modules/@prisma

# Uploads live on a mounted volume in production (see docker-compose / host config).
RUN mkdir -p apps/api/uploads
VOLUME ["/app/apps/api/uploads"]

WORKDIR /app/apps/api
EXPOSE 4100

# Apply migrations, then start. Fails fast if env is misconfigured (see config/env.ts).
# tsconfig rootDir is the workspace root, so the entry is dist/src/server.js.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
