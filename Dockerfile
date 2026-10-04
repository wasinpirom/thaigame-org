FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/app/storage
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev && npm cache clean --force \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
