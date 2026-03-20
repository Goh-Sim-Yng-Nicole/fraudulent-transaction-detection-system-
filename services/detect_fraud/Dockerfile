FROM node:20-alpine

WORKDIR /app

COPY services/detect_fraud/package.json ./package.json
RUN npm install --omit=dev

COPY services/detect_fraud/src ./src

ENV PORT=8008
EXPOSE 8008

CMD ["node", "src/index.js"]
