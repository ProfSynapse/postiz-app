# Base stage
FROM node:20.17-alpine3.19 AS base
WORKDIR /app

# Builder stage
FROM base AS builder
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
RUN npm install
COPY . .
RUN npm run build

# Final stage
FROM base
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV PORT=6000
ENV NODE_ENV=production

EXPOSE 6000

CMD ["npm", "run", "start:prod"]
