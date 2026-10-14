// Turns provider failures into one readable sentence for notification emails.
// Providers answer with JSON, HTML error pages (LinkedIn's 502 page) or
// nothing at all, and BadBody usually carries the body but an empty message.

const MAX_REASON_LENGTH = 300;
const NO_DETAILS = 'The platform returned an error without details.';

const squash = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// BadBody (integrations/social.abstract) is recognized by shape: importing it
// pulls in the Redis-backed concurrency limiter at module load.
type BadBodyLike = { identifier: string; json: unknown; message?: string };
const isBadBody = (err: unknown): err is BadBodyLike =>
  !!err &&
  typeof err === 'object' &&
  'identifier' in err &&
  'json' in err;

const truncate = (text: string) =>
  text.length > MAX_REASON_LENGTH
    ? `${text.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`
    : text;

export function describeProviderResponse(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text === '{}') {
    return '';
  }

  if (text.startsWith('<')) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const detail = text.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    return [title, detail]
      .map((part) => (part ? squash(part) : ''))
      .filter(Boolean)
      .join(': ');
  }

  try {
    const parsed = JSON.parse(text);
    const message =
      parsed?.message ??
      parsed?.error?.message ??
      parsed?.error_description ??
      (typeof parsed?.error === 'string' ? parsed.error : undefined) ??
      parsed?.detail;
    const code = parsed?.status ?? parsed?.serviceErrorCode ?? parsed?.code;
    if (message) {
      return code ? `${message} (${code})` : String(message);
    }
  } catch {
    // Not JSON; fall through to plain text.
  }
  return squash(text);
}

/** A readable reason for an error thrown while publishing. */
export function describePublishError(err: unknown): string {
  let reason = '';
  if (isBadBody(err)) {
    reason = err.message || describeProviderResponse(err.json);
  } else if (err instanceof Error) {
    reason = err.message;
  } else if (typeof err === 'string') {
    reason = describeStoredError(err);
  }
  return truncate(squash(reason) || NO_DETAILS);
}

/** A readable reason from a Post.error value written by changeState. */
export function describeStoredError(stored: string | null | undefined): string {
  if (!stored) {
    return NO_DETAILS;
  }
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      const reason =
        (typeof parsed.message === 'string' && parsed.message) ||
        describeProviderResponse(parsed.json) ||
        (typeof parsed.cause === 'string' && parsed.cause);
      return truncate(squash(reason || '') || NO_DETAILS);
    }
  } catch {
    // Stored as plain text.
  }
  return truncate(describeProviderResponse(stored) || NO_DETAILS);
}
