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
RUN --mount=type=cache,id=next-cache npm run build

EXPOSE 6000

ENV PORT=6000
ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
