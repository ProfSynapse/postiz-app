# Base stage
FROM node:20.17-alpine3.19 AS base
WORKDIR /app/workers

# Builder stage
FROM base AS builder
# Copy workspace files first
COPY apps/package.json ../
COPY apps/shared ../shared
COPY apps/workers/package.json ./

# Install dependencies
WORKDIR /app
RUN npm install

# Copy service source and build
WORKDIR /app/workers
COPY apps/workers .
RUN npm run build

# Final stage
FROM base
COPY --from=builder /app/workers/dist ./dist
COPY --from=builder /app/workers/package.json .
COPY --from=builder /app/workers/node_modules ./node_modules
COPY --from=builder /app/node_modules ../node_modules

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
