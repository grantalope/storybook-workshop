# Storybook Workshop demo — Fly.io (adapter-node)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* .npmrc* ./
# install all deps (devDeps needed for the build)
RUN pnpm install --no-frozen-lockfile
COPY . .
# Demo has no Stripe; $env/static/public needs the key defined (empty is fine — checkout is dev/disabled).
ENV PUBLIC_STRIPE_PUBLISHABLE_KEY=""
RUN pnpm exec svelte-kit sync && pnpm run build && pnpm prune --prod

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN corepack enable
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "build"]
