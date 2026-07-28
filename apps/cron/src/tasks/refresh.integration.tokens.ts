import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

const DEFAULT_CRON = '0 * * * *';

@Injectable()
export class RefreshIntegrationTokens {
  private readonly logger = new Logger(RefreshIntegrationTokens.name);

  constructor(private readonly _integrationService: IntegrationService) {}

  @Cron(process.env.INTEGRATION_REFRESH_CRON || DEFAULT_CRON)
  async handleCron(): Promise<void> {
    try {
      await this._integrationService.refreshTokens();
    } catch (err) {
      this.logger.error({
        evt: 'integration-token-refresh.failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
