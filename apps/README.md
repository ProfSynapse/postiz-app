# Postiz App Monorepo

This is a reorganized monorepo structure optimized for Railway deployment.

## Structure

```
apps/
├── shared/           # Shared libraries and dependencies
├── frontend/         # Next.js frontend application
├── backend/         # NestJS backend API
├── workers/         # Background workers
└── cron/           # Scheduled tasks
```

## Railway Deployment

Each service uses a multi-stage Docker build with a build script to handle shared dependencies. Here's how to deploy each service:

### Frontend Service
```bash
# Root Directory: /apps/frontend
Build Command: ./build.sh    # For Railway (Linux)
Start Command: npm run start:prod
Port: 6000
Environment Variables:
  - NODE_ENV=production
  - PORT=6000
```

### Backend Service
```bash
# Root Directory: /apps/backend
Build Command: ./build.sh    # For Railway (Linux)
Start Command: npm run start:prod
Port: 8080
Environment Variables:
  - NODE_ENV=production
  - PORT=8080
```

### Workers Service
```bash
# Root Directory: /apps/workers
Build Command: ./build.sh    # For Railway (Linux)
Start Command: npm run start:prod
Port: 4000
Environment Variables:
  - NODE_ENV=production
  - PORT=4000
```

### Cron Service
```bash
# Root Directory: /apps/cron
Build Command: ./build.sh    # For Railway (Linux)
Start Command: npm run start:prod
Port: 5000
Environment Variables:
  - NODE_ENV=production
  - PORT=5000
```

## Build Process

Each service uses a build script and multi-stage Docker build:

1. Build Scripts:

For Railway (Linux):
```bash
#!/bin/bash
# Copy shared libraries
cp -r ../shared ./shared

# Build Docker image
docker build -t postiz-service .

# Clean up
rm -rf ./shared
```

For Local Development (Windows):
```batch
@echo off
echo Copying shared libraries...
xcopy /E /I /Y ..\shared shared

echo Building Docker image...
docker build -t postiz-service .

echo Cleaning up...
rmdir /S /Q shared
```

2. Multi-Stage Dockerfile:
```dockerfile
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
```

Benefits:
- Proper handling of shared dependencies
- Clean Docker build context
- Smaller production images
- Better layer caching

## Development

1. Install dependencies:
```bash
cd apps
npm install
```

2. Build all services:

On Windows:
```batch
cd frontend && build.bat && cd ..
cd backend && build.bat && cd ..
cd workers && build.bat && cd ..
cd cron && build.bat && cd ..
```

On Linux:
```bash
cd frontend && ./build.sh && cd ..
cd backend && ./build.sh && cd ..
cd workers && ./build.sh && cd ..
cd cron && ./build.sh && cd ..
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
2. Build scripts handle shared dependencies
3. Multi-stage builds keep images small
4. Environment variables are set at runtime

## Railway Configuration

1. Connect your repository to Railway
2. Create a new service for each component
3. Set the Root Directory to the appropriate service folder
4. Use build.sh as the build command (Railway runs on Linux)
5. Set the required environment variables
6. Deploy!

The separation of services allows for:
- Independent scaling
- Isolated deployments
- Service-specific monitoring
- Separate logging

## Build Process Notes

- Build scripts handle shared code copying
- Multi-stage builds optimize image size
- Each stage serves a specific purpose
- Production images only contain necessary files
- Proper cleanup after builds
- Windows (.bat) and Linux (.sh) scripts provided for cross-platform development
