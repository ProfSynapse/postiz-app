import { INestApplication } from '@nestjs/common';
import { Request, Response, Router, RequestHandler } from 'express';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { MCPServer } from '@mastra/mcp';
import { randomUUID } from 'crypto';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { runWithContext } from './async.storage';
import { isMcpInputWithinLimits, MCP_MAX_BODY_BYTES } from './mcp.request.limits';
export const startMcp = async (app: INestApplication, router?: Router) => {
  const mastraService = app.get(MastraService, { strict: false });
  const organizationService = app.get(OrganizationService, { strict: false });

  const mastra = await mastraService.mastra();
  const agent = mastra.getAgent('postiz');
  const tools = await agent.getTools();

  const server = new MCPServer({
    name: 'Postiz MCP',
    version: '1.0.0',
    tools,
    agents: { postiz: agent },
  });

  const handler = async (req: Request, res: Response) => {
      // @ts-ignore
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }

      // @ts-ignore
      req.auth = await organizationService.getOrgByApiKey(req.params.id);
      // @ts-ignore
      if (!req.auth) {
        res.status(400).send('Invalid API Key');
        return ;
      }

      // Nest has already parsed JSON with its bounded body parser. Do not
      // let the adapter fall back to reading an unbounded, unparsed stream.
      if (req.method === 'POST' && (!req.is('application/json') || req.body === undefined)) {
        res.status(415).send('MCP requests require application/json');
        return;
      }

      if (!isMcpInputWithinLimits(req.body)) {
        res.status(413).send('MCP request input exceeds validation limits');
        return;
      }

      const url = new URL(
        `/mcp/${req.params.id}`,
        process.env.NEXT_PUBLIC_BACKEND_URL
      );

      // @ts-ignore
      await runWithContext({ requestId: req.params.id, auth: req.auth }, async () => {
        await server.startHTTP({
          url,
          httpPath: url.pathname,
          options: {
            maxRequestBodySize: MCP_MAX_BODY_BYTES,
            sessionIdGenerator: () => {
              return randomUUID();
            },
          },
          req,
          res,
        });
      });
  };
  const middleware: RequestHandler = (req, res, next) => {
    void handler(req, res).catch(next);
  };
  if (router) router.use('/:id', middleware);
  else app.use('/mcp/:id', middleware);
};
