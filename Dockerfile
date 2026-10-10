# ColorProMoney - single container: Next.js UI + Express API + WebSockets + game engine.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY next.config.mjs tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
USER node
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
