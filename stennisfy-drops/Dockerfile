# TEN-294 stennisfy-drops. Build context = this directory:
#   cd stennisfy-drops && flyctl deploy --config fly.toml
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs status.mjs supabase-ca-2021.crt ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
