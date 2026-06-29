# ─────────────────────────────────────────────────────────────────────
# Chalo Khelne API — production image
# Node 22 (matches local v22.20). Multi-stage: install prod deps in a
# builder, copy into a slim runtime that runs as non-root.
#
# Runtime config is ALL via environment (no secrets baked in):
#   MONGO_URI         MongoDB Atlas connection string
#   JWT_SECRET        >=32 char access-token secret
#   REDIS_URL         optional — enables multi-instance sockets/rate-limit
#   WEB_ALLOWED_ORIGINS, EMAIL_*, RAZORPAY_*, FIREBASE_*, CLOUDINARY_* ...
#   UPLOADS_DIR       point at a MOUNTED volume so uploads survive restarts
#   PORT              defaults to 3003
#
# Build:  docker build -t chalo-khelne-api .
# Run:    docker run --env-file .env -p 3003:3003 \
#                 -v chalo_uploads:/data/uploads -e UPLOADS_DIR=/data/uploads \
#                 chalo-khelne-api
# ─────────────────────────────────────────────────────────────────────

# ---- Stage 1: dependencies (prod only) ----
FROM node:22-alpine AS deps
WORKDIR /app
# Copy only manifests first so this layer is cached unless deps change.
COPY package.json package-lock.json* ./
# --omit=dev keeps devDeps (jest, mongodb-memory-server, nodemon) OUT of the image.
# --ignore-scripts avoids running any postinstall in the build (none needed here).
RUN npm ci --omit=dev --ignore-scripts

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini = proper PID 1 (forwards signals, reaps zombies) so PM2-less container
# shutdowns are clean. dumb-init is an alternative; tini ships in alpine repos.
RUN apk add --no-cache tini

# Bring in the resolved node_modules, then the app source.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Persisted uploads live on a mounted volume; create the default mountpoint and
# hand ownership to the unprivileged `node` user that ships with the base image.
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads /app
USER node

EXPOSE 3003

# Liveness/readiness — hits the readiness probe defined in app.js (/healthz
# returns 200 only when Mongo is connected). Uses Node's built-in global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3003)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as entrypoint; run the server directly (PM2 is for bare-metal/VM — in a
# container the orchestrator handles restarts/replicas).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
