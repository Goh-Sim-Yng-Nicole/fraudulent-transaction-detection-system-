FROM node:20-slim

WORKDIR /app

COPY services/fraud_score/package.json services/fraud_score/package-lock.json* ./
RUN npm install --omit=dev

COPY services/fraud_score/src ./src
COPY services/fraud_score/data ./data
COPY services/fraud_score/models ./models
COPY services/fraud_score/scripts ./scripts

ENV PORT=8001
EXPOSE 8001

CMD ["node", "src/server.js"]
