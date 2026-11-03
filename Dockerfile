# 班级工作台镜像。云端部署见 deploy/DEPLOY.md
# 单实例运行：数据在 SQLite 里（/app/data），不要开多个副本。

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG DEBIAN_MIRROR=
# better-sqlite3 优先下载预编译包；下载失败（例如网络慢）时会现场编译，需要这些工具。只装在构建阶段，不进最终镜像
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN --mount=type=cache,id=banji-corepack,target=/root/.cache/node/corepack \
    COREPACK_NPM_REGISTRY="$NPM_REGISTRY" npm_config_nodedir=/usr/local \
    pnpm install --frozen-lockfile --registry="$NPM_REGISTRY"
COPY . .
RUN --mount=type=cache,id=banji-corepack,target=/root/.cache/node/corepack \
    pnpm build && pnpm prune --prod

FROM base
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/app/data/app.db \
    BACKUP_DIR=/app/data/backups
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/bin ./bin
COPY package.json tsconfig.json ./
# 容器里可以直接运行 banji，例如 docker compose exec app banji brief
RUN ln -s /app/bin/banji /usr/local/bin/banji
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
