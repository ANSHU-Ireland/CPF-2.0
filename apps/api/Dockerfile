# @cpf/api production image (multi-stage, non-root, tini as PID 1).
#
# Build context MUST be the repository root — npm workspaces need the full
# monorepo layout (package-lock.json + every workspace's package.json) to
# resolve the "@cpf/assessment-framework" / "@cpf/identity" workspace deps.
#
#   docker build -f apps/api/Dockerfile -t cpf-api .
#
# This image cannot be built/run locally in this environment (no Docker
# engine available) — correctness is proven by the "container-smoke" job in
# .github/workflows/ci.yml, which builds, boots it against a real Postgres
# service, and curls /health. Fix forward if that job goes red.

FROM node:22-slim AS base
WORKDIR /app

# ---- deps: full install (incl. devDependencies) needed to compile TS ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/assessment-framework/package.json packages/assessment-framework/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- build: compile only the workspaces the API needs at runtime ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/assessment-framework packages/assessment-framework
COPY packages/identity packages/identity
COPY apps/api apps/api
RUN npm run build -w @cpf/assessment-framework -w @cpf/identity -w @cpf/api

# ---- prod-deps: fresh, production-only node_modules matching the lockfile ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/assessment-framework/package.json packages/assessment-framework/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

# ---- runtime: minimal, non-root, tini as PID 1 ----
FROM node:22-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system cpf \
  && useradd --system --gid cpf --home-dir /app --shell /usr/sbin/nologin cpf

WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000

COPY --from=prod-deps --chown=cpf:cpf /app/node_modules ./node_modules
COPY --from=prod-deps --chown=cpf:cpf /app/package.json ./package.json
COPY --from=build --chown=cpf:cpf /app/packages/assessment-framework/package.json ./packages/assessment-framework/package.json
COPY --from=build --chown=cpf:cpf /app/packages/assessment-framework/dist ./packages/assessment-framework/dist
COPY --from=build --chown=cpf:cpf /app/packages/assessment-framework/data ./packages/assessment-framework/data
COPY --from=build --chown=cpf:cpf /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build --chown=cpf:cpf /app/packages/identity/dist ./packages/identity/dist
COPY --from=build --chown=cpf:cpf /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=cpf:cpf /app/apps/api/dist ./apps/api/dist

USER cpf
EXPOSE 4000

# Uses Node's built-in fetch instead of installing curl, to keep the image lean.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
