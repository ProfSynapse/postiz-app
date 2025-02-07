FROM node:20.17-alpine3.19

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json ./
COPY ../shared/package.json ../shared/
RUN npm install

# Copy source code
COPY . .
COPY ../shared ../shared

# Create cache directories
RUN mkdir -p .next/cache node_modules/.cache .build-cache

# Build with proper cache mounts
RUN --mount=type=cache,target=/app/.next/cache,id=frontend-cache,sharing=locked \
    --mount=type=cache,target=/app/node_modules/.cache,id=npm-cache,sharing=locked \
    --mount=type=cache,target=/app/.build-cache,id=tsbuildinfo-cache,sharing=locked \
    npm run build

EXPOSE 6000

ENV PORT=6000
ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
