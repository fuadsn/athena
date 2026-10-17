FROM node:24-bookworm-slim AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx next build apps/web --webpack
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "apps/runtime/src/main.ts"]
