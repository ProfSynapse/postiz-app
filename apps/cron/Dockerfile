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
RUN mkdir -p node_modules/.cache .build-cache

# Build with proper cache mounts
RUN --mount=type=cache,id=npm-cache,target=/app/node_modules/.cache \
    --mount=type=cache,id=build-cache,target=/app/.build-cache \
    npm run build

EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
