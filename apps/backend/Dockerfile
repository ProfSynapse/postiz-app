FROM node:20.17-alpine3.19

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json ./
COPY ../shared/package.json ../shared/
RUN npm install

# Copy source code
COPY . .
COPY ../shared ../shared

# Build with cache mount
RUN --mount=type=cache,id=npm-cache npm run build

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
