# Base stage
FROM node:20.17-alpine3.19 AS base
WORKDIR /app/cron

# Builder stage
FROM base AS builder
# Copy workspace files first
COPY apps/package.json ../
COPY apps/shared ../shared
COPY apps/cron/package.json ./

# Install dependencies
WORKDIR /app
RUN npm install

# Copy service source and build
WORKDIR /app/cron
COPY apps/cron .
RUN npm run build

# Final stage
FROM base
COPY --from=builder /app/cron/dist ./dist
COPY --from=builder /app/cron/package.json .
COPY --from=builder /app/cron/node_modules ./node_modules
COPY --from=builder /app/node_modules ../node_modules

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
