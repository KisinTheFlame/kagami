FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY packages/shared ./packages/shared

RUN pnpm --filter @kagami/shared build
RUN pnpm --filter @kagami/server build
RUN pnpm --filter @kagami/server deploy --prod --legacy /prod/server

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV="production"

COPY --from=build /prod/server ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
