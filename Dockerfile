FROM node:24-slim AS build

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json tsconfig.base.json tsconfig.json tsconfig.tools.json ./
COPY packages/model/package.json packages/model/tsconfig.json packages/model/
COPY packages/formula/package.json packages/formula/tsconfig.json packages/formula/
COPY packages/formatting/package.json packages/formatting/tsconfig.json packages/formatting/
COPY packages/data/package.json packages/data/tsconfig.json packages/data/
COPY packages/interop/package.json packages/interop/tsconfig.json packages/interop/
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/

RUN npm ci --ignore-scripts

# Copy all source code
COPY packages/ packages/
COPY apps/ apps/
COPY scripts/ scripts/

# Build TypeScript and Vite
RUN npx tsc -b --pretty false
RUN npx vite build --config apps/web/vite.config.ts

# --- Production stage ---
FROM node:24-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

# Copy package manifests and install production deps only
COPY package.json package-lock.json ./
COPY packages/model/package.json packages/model/
COPY packages/formula/package.json packages/formula/
COPY packages/formatting/package.json packages/formatting/
COPY packages/data/package.json packages/data/
COPY packages/interop/package.json packages/interop/
COPY apps/server/package.json apps/server/

RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=build /app/packages/model/dist packages/model/dist
COPY --from=build /app/packages/formula/dist packages/formula/dist
COPY --from=build /app/packages/formatting/dist packages/formatting/dist
COPY --from=build /app/packages/data/dist packages/data/dist
COPY --from=build /app/packages/interop/dist packages/interop/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV STATIC_DIR=/app/apps/web/dist

VOLUME /data
EXPOSE 3001

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
