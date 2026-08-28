FROM node:22-bookworm-slim AS web
WORKDIR /build
ARG BUILD_SHA=local-development
ENV BUILD_SHA=$BUILD_SHA
COPY package.json package-lock.json tsconfig.json vite.config.ts ./
COPY frontend ./frontend
RUN npm ci && npm run build

FROM rust:1.88-bookworm AS server
WORKDIR /build
ARG BUILD_SHA=local-development
ENV BUILD_SHA=$BUILD_SHA
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 --home-dir /app checkin && mkdir -p /app/data && chown -R checkin:checkin /app
WORKDIR /app
COPY --from=server /build/target/release/privacy-class-checkin /app/server
COPY --from=web /build/dist /app/dist
USER 10001
EXPOSE 8080
VOLUME ["/app/data"]
ENTRYPOINT ["/app/server"]
