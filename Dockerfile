# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build-only placeholders: no real service is contacted during compilation.
ENV DATABASE_URL=postgresql://shotlin:build-only@db:5432/shotlin
ENV AUTH_SECRET=build-only-secret-that-is-at-least-32-characters
ENV WHATSAPP_AUTH_MASTER_KEY=YnVpbGQtb25seS1tYXN0ZXIta2V5LTMyLWJ5dGVzISE=
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/next.config.ts /app/drizzle.config.ts /app/tsconfig.json /app/next-env.d.ts ./
EXPOSE 3000
CMD ["npm", "run", "start"]
