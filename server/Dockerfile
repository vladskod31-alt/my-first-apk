FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY web/lib/core.mjs web/lib/crypto.mjs web/lib/phone-api.mjs web/lib/cloud-crypto.mjs ./web/lib/
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV PORT=3000 ACCOUNT_DB=/data/accounts.sqlite CLOUD_DB=/data/cloud.sqlite
EXPOSE 3000
CMD ["node", "server/index.mjs"]
