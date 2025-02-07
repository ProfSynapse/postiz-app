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

### For each service:

1. Frontend Service:
```bash
# Root Directory: /apps/frontend
Build Command: npm install && npm run build
Start Command: npm run start:prod
Port: 6000
```

2. Backend Service:
```bash
# Root Directory: /apps/backend
Build Command: npm install && npm run build
Start Command: npm run start:prod
Port: 8080
```

3. Workers Service:
```bash
# Root Directory: /apps/workers
Build Command: npm install && npm run build
Start Command: npm run start:prod
Port: 4000
```

4. Cron Service:
```bash
# Root Directory: /apps/cron
Build Command: npm install && npm run build
Start Command: npm run start:prod
Port: 5000
```

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
