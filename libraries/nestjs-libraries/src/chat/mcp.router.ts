import type { INestApplication } from '@nestjs/common';
import { json, Router, Request, Response, NextFunction } from 'express';
import { MCP_MAX_BODY_BYTES } from './mcp.request.limits';

export function mountMcpRouter(app: Pick<INestApplication, 'use'>): Router {
  const router = Router();
  const parseJson = json({ limit: MCP_MAX_BODY_BYTES });
  // Nest detects an already-installed global JSON parser by function name.
  // Passing the scoped jsonParser directly would disable JSON/raw-body
  // parsing for other routes, including login and Stripe. Keep the wrapper.
  app.use('/mcp', function mcpJsonParser(req: Request, res: Response, next: NextFunction) {
    return parseJson(req, res, next);
  }, router);
  return router;
}
