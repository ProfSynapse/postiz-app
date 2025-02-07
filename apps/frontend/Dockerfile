# Base stage
FROM node:20.17-alpine3.19 AS base
WORKDIR /app/frontend

# Builder stage
FROM base AS builder
# Copy workspace files first
COPY apps/package.json ../
COPY apps/shared ../shared
COPY apps/frontend/package.json ./

# Install dependencies
WORKDIR /app
RUN npm install

# Copy service source and build
WORKDIR /app/frontend
COPY apps/frontend .
RUN npm run build

# Final stage
FROM base
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/package.json .
COPY --from=builder /app/frontend/node_modules ./node_modules
COPY --from=builder /app/node_modules ../node_modules

ENV PORT=6000
ENV NODE_ENV=production

EXPOSE 6000

CMD ["npm", "run", "start:prod"]
