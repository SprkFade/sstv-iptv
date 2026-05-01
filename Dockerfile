FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/SprkFade/sstv-iptv"
LABEL org.opencontainers.image.description="Mobile-first IPTV M3U and XMLTV PWA TV guide"
LABEL org.opencontainers.image.licenses="MIT"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /app/data /app/cache
EXPOSE 3025
CMD ["npm", "run", "start", "-w", "server"]
