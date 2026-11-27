# syntax = docker/dockerfile:1

# ---------------------------------------------------------------------------
# Global Business OS — backend Bun (serve o SPA + /api/* na MESMA origem).
# Build: docker build -t gbos .
# Run:   docker run -p 8787:8787 --env-file .env gbos
# ---------------------------------------------------------------------------

# 1) Build do frontend (Vite)
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

# 2) Runtime (backend Bun serve dist/ + /api/*)
FROM oven/bun:1 AS runtime
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production || bun install
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
# O backend importa de ../src/lib (motor contábil compartilhado).
COPY tsconfig.json ./

ENV PORT=8787
# Volume persistente para o SQLite.
VOLUME ["/data"]
EXPOSE 8787

CMD ["bun", "run", "server/index.ts"]
