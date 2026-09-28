FROM node:20-alpine

WORKDIR /app

# Install Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p public/uploads

ENV PUPPETEER_SKIP_DOWNLOAD=true

CMD ["npm","start"]