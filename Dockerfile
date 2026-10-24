# Asobi : site + serveur dans une seule image, sans dépendance npm.
FROM node:24-alpine

WORKDIR /app
COPY index.html ./
COPY assets ./assets
COPY data/test-games.json ./data/test-games.json
COPY scripts/lib ./scripts/lib
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/scripts ./server/scripts

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8095 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8095/api/health > /dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
