import type { Mastra } from '@mastra/core/mastra';
import { Injectable } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class MastraService {
  static mastra: Mastra;
  constructor(private _loadToolsService: LoadToolsService) {}
  async mastra() {
    if (!MastraService.mastra) {
      const [{ Mastra }, { ConsoleLogger }, { getMastraStore }] =
        await Promise.all([
          import('@mastra/core/mastra'),
          import('@mastra/core/logger'),
          import('@gitroom/nestjs-libraries/chat/mastra.store'),
        ]);

      MastraService.mastra = new Mastra({
        storage: getMastraStore(),
        agents: {
          postiz: await this._loadToolsService.agent(),
        },
        logger: new ConsoleLogger({
          level: 'info',
        }),
      });
    }

    return MastraService.mastra;
  }
}
