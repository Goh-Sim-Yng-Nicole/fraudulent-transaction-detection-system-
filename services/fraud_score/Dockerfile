FROM node:20-slim AS builder

WORKDIR /app

COPY services/fraud_score/package.json services/fraud_score/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY services/fraud_score/src ./src
COPY services/fraud_score/data ./data
COPY services/fraud_score/models ./models
COPY services/fraud_score/scripts ./scripts

FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nodejs

ENV NODE_ENV=production \
    PORT=8001

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/src ./src
COPY --from=builder --chown=nodejs:nodejs /app/data ./data
COPY --from=builder --chown=nodejs:nodejs /app/models ./models
COPY --from=builder --chown=nodejs:nodejs /app/scripts ./scripts

USER nodejs

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8001/api/v1/health/ready', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
