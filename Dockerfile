# syntax=docker/dockerfile:1
FROM golang:1.25-bookworm AS api-build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/careerquest .

FROM node:22-bookworm-slim AS web-build
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1 API_PORT=8080
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 API_PORT=8080 DATA_DIR=/app/data DATASET_DIR=/app \
    AGENT_PROVIDER=off EXAM_AI_PROVIDER=off ALLOW_EXTERNAL_AI=false
COPY --from=api-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=api-build /out/careerquest ./backend/careerquest
COPY --from=web-build --chown=node:node /app/frontend/.next ./frontend/.next
COPY --from=web-build /app/frontend/node_modules ./frontend/node_modules
COPY --from=web-build /app/frontend/public ./frontend/public
COPY --from=web-build /app/frontend/package.json /app/frontend/next.config.ts ./frontend/
COPY scripts/start-production.mjs ./scripts/start-production.mjs
COPY employees.json events.json skills.json activity_history.csv ./
COPY third_party/ ./third_party/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
