# Runtime image for a generated AGNTDEV bot. BOT_TOKEN is injected at RUNTIME as
# a secret — never baked into an image layer.
FROM node:20-slim AS build
WORKDIR /app
# Toolchain for native addons (e.g. better-sqlite3) when prebuild-install finds
# no prebuilt binary. Lives in the build stage only — pruned from the final image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# Drop dev deps in place; compiled native addons are kept for the run stage.
RUN npm prune --omit=dev

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
