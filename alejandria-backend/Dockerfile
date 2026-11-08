FROM golang:1.26-bookworm AS build
WORKDIR /app
COPY alejandria-backend/go.mod alejandria-backend/go.sum ./
RUN go mod download
COPY alejandria-backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/admin ./cmd/admin && \
    CGO_ENABLED=0 GOBIN=/out go install github.com/jackc/tern/v2@v2.4.1

FROM debian:bookworm-slim
RUN useradd --uid 10001 --no-create-home app
WORKDIR /app
COPY --from=build /out/api /out/admin /out/tern /app/
COPY alejandria-backend/internal/database/migrations/ /app/migrations/
ENV TERN_MIGRATIONS=/app/migrations
USER 10001
EXPOSE 8080
ENTRYPOINT ["/app/api"]
