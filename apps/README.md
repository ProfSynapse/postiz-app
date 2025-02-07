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

Each service has its own Dockerfile with optimized build caching. Here's how to deploy each service:

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

## Build Caching

Each service uses BuildKit cache mounts with proper sharing locks:

Frontend:
```dockerfile
RUN --mount=type=cache,target=/app/.next/cache,id=frontend-cache,sharing=locked \
    --mount=type=cache,target=/app/node_modules/.cache,id=npm-cache,sharing=locked \
    --mount=type=cache,target=/app/.build-cache,id=tsbuildinfo-cache,sharing=locked \
    npm run build
```

Backend/Workers/Cron:
```dockerfile
RUN --mount=type=cache,target=/app/node_modules/.cache,id=npm-cache,sharing=locked \
    --mount=type=cache,target=/app/.build-cache,id=tsbuildinfo-cache,sharing=locked \
    npm run build
```

Cache IDs:
- frontend-cache: Next.js build cache (frontend only)
- npm-cache: NPM module cache
- tsbuildinfo-cache: TypeScript/build output cache

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
2. Build caches use sharing=locked to prevent concurrent access issues
3. Cache IDs are consistent across services for shared caches
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

## Cache Mount Notes

- Cache mounts use BuildKit's cache feature
- sharing=locked prevents concurrent cache access issues
- Cache IDs are simple and descriptive
- Cache directories are created before build
- Caches persist between builds for faster rebuilds
- Frontend has an additional Next.js-specific cache
