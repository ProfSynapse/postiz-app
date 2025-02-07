# Base stage
FROM node:20.17-alpine3.19 AS base
WORKDIR /app/backend

# Builder stage
FROM base AS builder
# Copy workspace files first
COPY package.json ../
COPY shared ../shared
COPY backend/package.json ./

# Install dependencies
WORKDIR /app
RUN npm install

# Copy service source and build
WORKDIR /app/backend
COPY backend .
RUN npm run build

# Final stage
FROM base
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json .
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/node_modules ../node_modules

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "run", "start:prod"]
