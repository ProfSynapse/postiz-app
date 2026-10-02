import { timer } from '@gitroom/helpers/utils/timer';
import { concurrency } from '@gitroom/helpers/utils/concurrency.service';
import { Integration } from '@prisma/client';

export class RefreshToken {
  constructor(
    public identifier: string,
    public json: string,
    public body: BodyInit,
    public message = ''
  ) {}
}
export class BadBody {
  constructor(
    public identifier: string,
    public json: string,
    public body: BodyInit,
    public message = ''
  ) {}
}

export class NotEnoughScopes {
  constructor(public message = 'Not enough scopes') {}
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  public handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return undefined;
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    const value = await concurrency<any>(
      this.identifier,
      this.maxConcurrentJob,
      async () => {
        try {
          return await func();
        } catch (err) {
          // Never log/store a raw provider error: it may contain OAuth headers.
          let serialized = '{}';
          try {
            serialized = JSON.stringify(err) || '{}';
          } catch {}
          const handle = this.handleErrors(serialized);
          const status = Number(
            (err as any)?.response?.status || (err as any)?.code
          );
          return {
            err: true,
            ...(handle || {
              type: 'bad-body',
              value: `${this.identifier} request failed${
                Number.isInteger(status) && status >= 100 && status <= 599
                  ? ` (HTTP ${status})`
                  : ''
              }.`,
            }),
          };
        }
      },
      ignoreConcurrency
    );

    if (value?.err) {
      const ErrorType = value.type === 'refresh-token' ? RefreshToken : BadBody;
      throw new ErrorType(
        this.identifier,
        '{}',
        {} as any,
        value.value || `${this.identifier} request failed.`
      );
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false
  ): Promise<Response> {
    const request = await concurrency(
      this.identifier,
      this.maxConcurrentJob,
      () => fetch(url, options),
      ignoreConcurrency
    );

    if (request.status === 200 || request.status === 201) {
      return request;
    }

    if (totalRetries > 2) {
      throw new BadBody(identifier, '{}', options.body || '{}');
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    if (
      request.status === 429 ||
      request.status === 500 ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await timer(5000);
      return this.fetch(url, options, identifier, totalRetries + 1, ignoreConcurrency);
    }

    const handleError = this.handleErrors(json || '{}');

    if (handleError?.type === 'retry') {
      await timer(5000);
      return this.fetch(url, options, identifier, totalRetries + 1, ignoreConcurrency);
    }

    if (
      request.status === 401 &&
      (handleError?.type === 'refresh-token' || !handleError)
    ) {
      throw new RefreshToken(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new BadBody(
      identifier,
      json,
      options.body!,
      handleError?.value || ''
    );
  }

  checkScopes(required: string[], got: string | string[]) {
    if (Array.isArray(got)) {
      if (!required.every((scope) => got.includes(scope))) {
        throw new NotEnoughScopes();
      }

      return true;
    }

    const newGot = decodeURIComponent(got);

    const splitType = newGot.indexOf(',') > -1 ? ',' : ' ';
    const gotArray = newGot.split(splitType);
    if (!required.every((scope) => gotArray.includes(scope))) {
      throw new NotEnoughScopes();
    }

    return true;
  }
}
