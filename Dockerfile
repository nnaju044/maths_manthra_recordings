# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create uploads directory
RUN mkdir -p public/uploads

EXPOSE 3000

CMD ["node", "server.js"]
