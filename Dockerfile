# syntax=docker/dockerfile:1
# Builds the API image and the static web app from one checkout.
#   docker build -t hamtning-api .                                    the API (default target)
#   docker build --target web-dist --output type=local,dest=out .     the web app, as plain files
# deploy/docker/deploy.sh does both. The Turnstile site key is public but baked into the web
# build, so it is a build argument: --build-arg VITE_TURNSTILE_SITE_KEY=...

FROM node:26-slim AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /app
# Dependencies first, so editing source doesn't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN pnpm build
# The API bundle plus only its production dependencies (better-sqlite3 ships prebuilt binaries).
RUN pnpm --filter @hamtning/api deploy --prod /out/api

# Files get this owner when exported to a folder, so the deploy user can replace them later.
FROM scratch AS web-dist
ARG WEB_UID=0
ARG WEB_GID=0
COPY --from=build --chown=${WEB_UID}:${WEB_GID} /app/apps/web/dist/ /

FROM node:26-slim AS api
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/app.db
WORKDIR /app
COPY --from=build --chown=node:node /out/api/package.json ./
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
COPY --from=build --chown=node:node /out/api/drizzle ./drizzle
# Admin scripts (employee, orphaned-photos) run inside the container with tsx; see deploy/docker/README.md.
COPY --from=build --chown=node:node /out/api/src ./src
COPY --from=build --chown=node:node /out/api/scripts ./scripts
COPY --from=build --chown=node:node /out/api/tsconfig.json ./
RUN npm install -g tsx@4 && mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
