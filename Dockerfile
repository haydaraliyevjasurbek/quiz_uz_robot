FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App sources
COPY . .

ENV NODE_ENV=production

# Optional: webhook/health server can listen on PORT
EXPOSE 3000

CMD ["node", "index.js"]
