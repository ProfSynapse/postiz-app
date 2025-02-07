# Postiz App Monorepo

This is a reorganized monorepo structure optimized for Railway deployment.

## Structure

```
apps/
├── shared/           # Shared libraries and dependencies
├── frontend/         # Next.js frontend application
├── backend/          # NestJS backend API
├── workers/          # Background workers
└── cron/            # Scheduled tasks
```

## Railway Deployment

Each service uses a multi-stage Docker build for optimal production images. Here's how to deploy each service:

### Frontend Service
```bash
# Root Directory: /apps/frontend
Build Command: docker build -t postiz-frontend .
Start Command: npm run start:prod
Port: 6000
Environment Variables:
  - NODE_ENV=production
  - PORT=6000
```

### Backend Service
```bash
# Root Directory: /apps/backend
Build Command: docker build -t postiz-backend .
Start Command: npm run start:prod
Port: 8080
Environment Variables:
  - NODE_ENV=production
  - PORT=8080
```

### Workers Service
```bash
# Root Directory: /apps/workers
Build Command: docker build -t postiz-workers .
Start Command: npm run start:prod
Port: 4000
Environment Variables:
  - NODE_ENV=production
  - PORT=4000
```

### Cron Service
```bash
# Root Directory: /apps/cron
Build Command: docker build -t postiz-cron .
Start Command: npm run start:prod
Port: 5000
Environment Variables:
  - NODE_ENV=production
  - PORT=5000
```

## Multi-Stage Build Process

Each service uses a three-stage Docker build:

1. Base Stage:
```dockerfile
FROM node:20.17-alpine3.19 AS base
WORKDIR /app
```

2. Builder Stage:
```dockerfile
FROM base AS builder
COPY package.json package-lock.json ./
COPY ../shared/package.json ../shared/
RUN npm install
COPY . .
COPY ../shared ../shared
RUN npm run build
```

3. Final Stage:
```dockerfile
FROM base
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
```

Benefits:
- Smaller production images
- Better layer caching
- Clean separation of build and runtime
- No build artifacts in final image

## Development

1. Install dependencies:
```bash
cd apps
npm install
```

2. Build all services:
```bash
npm run build:all
```

3. Start individual services:
```bash
npm run start:prod:frontend
npm run start:prod:backend
npm run start:prod:workers
npm run start:prod:cron
```

## Shared Code

The `shared` directory contains common code used across services:
- helpers
- nestjs-libraries
- plugins
- react-shared-libraries

Each service automatically includes these shared dependencies through npm workspaces.

## Docker Build Tips

1. Each service has its own .dockerignore to optimize builds
2. Multi-stage builds keep final images small
3. Shared code is properly copied and built
4. Environment variables are set at runtime

## Railway Configuration

1. Connect your repository to Railway
2. Create a new service for each component
3. Set the Root Directory to the appropriate service folder
4. Use the Docker build configuration
5. Set the required environment variables
6. Deploy!

The separation of services allows for:
- Independent scaling
- Isolated deployments
- Service-specific monitoring
- Separate logging

## Build Process Notes

- Build happens in isolated builder stage
- Only necessary files are copied to final image
- Node modules are copied from builder stage
- Production-only environment variables
- Proper handling of shared dependencies
