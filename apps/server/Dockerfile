# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY packages/shared ./packages/shared

RUN pnpm --filter @kagami/shared build
RUN pnpm --filter @kagami/server build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm --filter @kagami/server deploy --prod --legacy /prod/server
RUN cd /prod/server && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV="production"
ENV TZ="Asia/Shanghai"

RUN apk add --no-cache tzdata \
  && ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
  && echo "${TZ}" > /etc/timezone

COPY --from=build --chown=node:node /prod/server ./

USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
