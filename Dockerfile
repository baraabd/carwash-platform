# One Dockerfile, parameterised by SERVICE, for all ten services.
#
# Keeping it single means the ten images cannot drift apart in how they install,
# build, drop privileges or shut down. The service-specific parts are its own
# workspace package, its own Prisma schema and its own generated client - never a
# shared database layer.
#
# The base image tag is passed in so the acceptance run pins exactly the image it
# resolved and recorded a digest for, rather than whatever `latest` means today.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/base-nossl-debian13@sha256:8c563c1fb5e120606f0d85733049775faed6192e2bd2223ef283a5393eec22b9

# ---------------------------------------------------------------- builder ----
FROM ${NODE_IMAGE} AS builder
ARG SERVICE
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# Manifests first so a dependency-free source change reuses the install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

# corepack activates exactly the pnpm version pinned in package.json.
RUN corepack enable && corepack prepare --activate

# --frozen-lockfile: the build fails rather than silently resolving something
# the lockfile does not describe.
RUN pnpm install --frozen-lockfile

# Shared technical packages must exist before the service that imports them.
RUN pnpm --filter "./packages/*" --sequential run build

# `generate` needs no database; the connection string arrives at runtime.
RUN pnpm --filter "@carwash/${SERVICE}" run generate \
 && pnpm --filter "@carwash/${SERVICE}" run build

# A self-contained production tree: application code plus production
# dependencies only, with test and build tooling left behind.
RUN pnpm --filter "@carwash/${SERVICE}" --prod deploy --legacy /deploy

# ----------------------------------------------------------------- runner ----
FROM ${RUNTIME_IMAGE} AS runner
ARG SERVICE
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}
# Bind to the container interface; the loopback default is for a developer
# machine, and publishing a port is still an explicit decision of the operator.
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
# The distroless base-nossl runtime intentionally omits libstdc++/libgcc.
# Node is built in the pinned Debian builder and needs only these C++ ABI libraries at runtime.
COPY --from=builder /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
COPY --from=builder /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1
COPY --from=builder --chown=1000:1000 /deploy /app

# A numeric unprivileged identity avoids assuming users from the builder image.
# Only the exact pinned Node binary and production dependency tree are copied.
USER 1000:1000
ENTRYPOINT []

EXPOSE 3000

# Liveness only. Readiness is a different question with a different answer, and
# for a foundation shell that answer is deliberately 503.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# No shell wrapper: the Node process is PID 1 and receives SIGTERM directly, so
# the graceful-shutdown path in main.ts actually runs.
CMD ["node", "dist/main.js"]
