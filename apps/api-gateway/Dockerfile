ARG NODE_IMAGE=node:24.21.0-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian13@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97
FROM ${NODE_IMAGE} AS builder
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN corepack enable && corepack prepare --activate && pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/*" --sequential run build && pnpm --filter @carwash/api-gateway run build
RUN pnpm --filter @carwash/api-gateway --prod deploy --legacy /deploy
FROM ${RUNTIME_IMAGE} AS runner
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
COPY --from=builder --chown=1000:1000 /deploy /app
USER 1000:1000
ENTRYPOINT []
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
