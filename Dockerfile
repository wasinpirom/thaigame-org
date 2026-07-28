FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/app/storage
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node views ./views
COPY --chown=node:node public ./public
RUN mkdir -p /app/storage/uploads && chown -R node:node /app/storage
USER node
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","src/server.js"]
