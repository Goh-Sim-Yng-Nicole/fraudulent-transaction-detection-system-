FROM node:20-alpine

WORKDIR /app

COPY services/transaction/package.json ./package.json
RUN npm install --omit=dev

COPY services/transaction/src ./src

ENV PORT=8000
EXPOSE 8000

CMD ["node", "src/index.js"]
