import {
  describeProviderResponse,
  describePublishError,
  describeStoredError,
} from './publish.error.describe';

// Same shape as BadBody in integrations/social.abstract.
class BadBody {
  constructor(
    public identifier: string,
    public json: string,
    public body: unknown,
    public message = ''
  ) {}
}

// The page LinkedIn returned on 2026-10-14 when a video upload chunk failed.
const LINKEDIN_502 = `
<html><head>
<meta http-equiv="content-type" content="text/html;charset=utf-8">
<title>502 Server Error</title>
</head>
<body text=#000000 bgcolor=#ffffff>
<h1>Error: Server Error</h1>
<h2>The server encountered a temporary error and could not complete your request.<p>Please try again in 30 seconds.</h2>
<h2></h2>
</body></html>
`;

describe('describePublishError', () => {
  it('reads the title and detail from an HTML error page', () => {
    const err = new BadBody('linkedin', LINKEDIN_502, {} as any, '');

    expect(describePublishError(err)).toBe(
      '502 Server Error: The server encountered a temporary error and could not complete your request. Please try again in 30 seconds.'
    );
  });

  it('prefers an explicit BadBody message', () => {
    const err = new BadBody(
      'linkedin',
      '{}',
      {} as any,
      'Reconnect the channel before retrying.'
    );

    expect(describePublishError(err)).toBe(
      'Reconnect the channel before retrying.'
    );
  });

  it('reads message and code from a JSON provider response', () => {
    const json = JSON.stringify({
      message: 'Duplicate post detected',
      status: 422,
    });

    expect(
      describePublishError(new BadBody('linkedin', json, {} as any, ''))
    ).toBe('Duplicate post detected (422)');
  });

  it('uses the message of ordinary errors', () => {
    expect(
      describePublishError(
        new Error('LinkedIn video was not ready after 5 minutes; no post was created')
      )
    ).toBe('LinkedIn video was not ready after 5 minutes; no post was created');
  });

  it('falls back when there are no details', () => {
    expect(describePublishError(new BadBody('x', '{}', {} as any, ''))).toBe(
      'The platform returned an error without details.'
    );
  });

  it('keeps reasons short enough for an email', () => {
    const reason = describePublishError(new Error('x'.repeat(1000)));

    expect(reason.length).toBeLessThanOrEqual(300);
    expect(reason.endsWith('…')).toBe(true);
  });
});

describe('describeStoredError', () => {
  it('reads a BadBody serialized by changeState', () => {
    const stored = JSON.stringify(
      new BadBody('linkedin', LINKEDIN_502, {} as any, '')
    );

    expect(describeStoredError(stored)).toMatch(/^502 Server Error: /);
  });

  it('reads a checkpoint error object', () => {
    const stored = JSON.stringify({
      message: 'Main LinkedIn post published; comment was not completed.',
    });

    expect(describeStoredError(stored)).toBe(
      'Main LinkedIn post published; comment was not completed.'
    );
  });

  it('handles missing values', () => {
    expect(describeStoredError(null)).toBe(
      'The platform returned an error without details.'
    );
  });
});

describe('describeProviderResponse', () => {
  it('ignores empty bodies', () => {
    expect(describeProviderResponse('{}')).toBe('');
    expect(describeProviderResponse(undefined)).toBe('');
  });
});
