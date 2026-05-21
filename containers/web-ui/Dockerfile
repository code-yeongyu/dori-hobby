FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY containers/web-ui/package.json ./
RUN bun install --frozen-lockfile || bun install
COPY containers/web-ui/ .
RUN bun run build:client
RUN bun build src/server/index.ts --outdir dist-server --target bun --format esm

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 3001
CMD ["bun", "run", "src/server/index.ts"]
