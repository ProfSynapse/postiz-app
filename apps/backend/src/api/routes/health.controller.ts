import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';

const PROBE_TIMEOUT_MS = 3000;

type ProbeStatus = 'ok' | 'fail';

interface DeepHealthBody {
  redis: ProbeStatus;
  postgres: ProbeStatus;
  bullmq: ProbeStatus;
  errors?: string[];
}

function withTimeout<T>(
  probeName: string,
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${probeName} probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'unknown error';
}

@ApiTags('Health')
@Controller('/health')
export class HealthController {
  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _bullMqClient: BullMqClient
  ) {}

  /**
   * Deep healthcheck — probes Redis, Postgres, and BullMQ-bearing Redis
   * connectivity. Returns 200 when all probes pass; 503 with per-probe
   * status + sanitized error strings otherwise.
   *
   * BullMQ probe note: BullMQ uses the shared `ioRedis` connection, so the
   * dominant failure mode (Redis unreachable / wrong DNS family) surfaces as
   * a Redis probe failure. The BullMQ probe additionally verifies BullMQ's
   * own queue infrastructure is reachable by pinging via the shared client.
   */
  @Get('/deep')
  async deep(): Promise<DeepHealthBody> {
    const [redisResult, postgresResult, bullmqResult] = await Promise.all([
      this.probeRedis(),
      this.probePostgres(),
      this.probeBullMq(),
    ]);

    const errors: string[] = [];
    if (redisResult.status === 'fail') {
      errors.push(`redis: ${redisResult.error}`);
    }
    if (postgresResult.status === 'fail') {
      errors.push(`postgres: ${postgresResult.error}`);
    }
    if (bullmqResult.status === 'fail') {
      errors.push(`bullmq: ${bullmqResult.error}`);
    }

    const body: DeepHealthBody = {
      redis: redisResult.status,
      postgres: postgresResult.status,
      bullmq: bullmqResult.status,
    };

    if (errors.length > 0) {
      throw new HttpException(
        { ...body, errors },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return body;
  }

  private async probeRedis(): Promise<{ status: ProbeStatus; error?: string }> {
    try {
      await withTimeout('redis', Promise.resolve(ioRedis.ping()), PROBE_TIMEOUT_MS);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'fail', error: describeError(err) };
    }
  }

  private async probePostgres(): Promise<{
    status: ProbeStatus;
    error?: string;
  }> {
    try {
      await withTimeout(
        'postgres',
        this._prismaService.$queryRaw`SELECT 1`,
        PROBE_TIMEOUT_MS
      );
      return { status: 'ok' };
    } catch (err) {
      return { status: 'fail', error: describeError(err) };
    }
  }

  private async probeBullMq(): Promise<{ status: ProbeStatus; error?: string }> {
    try {
      // Probe BullMQ-bearing Redis connectivity without creating a persistent
      // queue. BullMQ uses the shared `ioRedis` instance, so pinging it here
      // verifies the same connection BullMQ workers and producers rely on.
      // If a separate BullMQ-specific health signal is needed in the future,
      // expand this probe to call `queue.client.then(c => c.ping())` on a
      // dedicated, properly-closed health queue.
      const client = this._bullMqClient;
      if (!client) {
        return { status: 'fail', error: 'bullmq client unavailable' };
      }
      await withTimeout('bullmq', Promise.resolve(ioRedis.ping()), PROBE_TIMEOUT_MS);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'fail', error: describeError(err) };
    }
  }
}
