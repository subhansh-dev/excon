# ---- build: vite client + tsc server ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

# ---- runtime: node + static client, Postgres via DATABASE_URL ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/dist-server ./dist-server
COPY scenarios ./scenarios
EXPOSE 2567
CMD ["node", "dist-server/server/index.js"]
