FROM node:20-alpine AS builder

WORKDIR /app

COPY services/detect_fraud/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY services/detect_fraud/src ./src

FROM node:20-alpine

RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

ENV NODE_ENV=production \
    PORT=8008

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/src ./src

USER nodejs

EXPOSE 8008

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8008/health/ready', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
