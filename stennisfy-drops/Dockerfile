# TEN-294 stennisfy-drops. Build context = this directory:
#   flyctl deploy --config stennisfy-drops/fly.toml stennisfy-drops
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs supabase-ca-2021.crt ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
