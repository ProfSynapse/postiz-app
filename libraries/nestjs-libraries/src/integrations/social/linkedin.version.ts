// libraries/nestjs-libraries/src/integrations/social/linkedin.version.ts
//
// Self-healing LinkedIn-Version header source. LinkedIn retires API versions
// (YYYYMM) on a rolling basis; on HTTP 426 NONEXISTENT_VERSION we walk back
// month-by-month until a working version is found, then cache it in module
// scope for subsequent requests. Cache is process-lifetime only; restart
// reseeds from process.env.LINKEDIN_VERSION_OVERRIDE or DEFAULT_LINKEDIN_VERSION.

const DEFAULT_LINKEDIN_VERSION = '202601';
const MAX_FALLBACK_ATTEMPTS = 24;
const NONEXISTENT_VERSION_SIGNAL = 'NONEXISTENT_VERSION';

let workingVersion: string =
  process.env.LINKEDIN_VERSION_OVERRIDE || DEFAULT_LINKEDIN_VERSION;

export function getLinkedInVersion(): string {
  return workingVersion;
}

function noteVersionAccepted(version: string): void {
  if (process.env.LINKEDIN_VERSION_OVERRIDE) {
    return;
  }
  if (version !== workingVersion) {
    console.log(
      `[linkedin] LinkedIn-Version cache updated: ${version} (was ${workingVersion})`
    );
    workingVersion = version;
  }
}

function nextOlderVersion(current: string): string | null {
  if (!/^\d{6}$/.test(current)) {
    return null;
  }
  const year = parseInt(current.slice(0, 4), 10);
  const month = parseInt(current.slice(4, 6), 10);
  if (month === 1) {
    return `${(year - 1).toString().padStart(4, '0')}12`;
  }
  return `${year.toString().padStart(4, '0')}${(month - 1)
    .toString()
    .padStart(2, '0')}`;
}

function isNonexistentVersionError(error: unknown): boolean {
  if (!error) return false;
  const haystacks: string[] = [];
  if (typeof error === 'string') haystacks.push(error);
  if (error instanceof Error && error.message) haystacks.push(error.message);
  const anyErr = error as Record<string, unknown>;
  if (typeof anyErr.json === 'string') haystacks.push(anyErr.json);
  if (typeof anyErr.message === 'string') haystacks.push(anyErr.message);
  if (typeof anyErr.value === 'string') haystacks.push(anyErr.value);
  return haystacks.some((s) => s.includes(NONEXISTENT_VERSION_SIGNAL));
}

function replaceHeaderVersion(
  init: RequestInit | undefined,
  newVersion: string
): RequestInit {
  const next: RequestInit = { ...(init || {}) };
  const headers = new Headers(init?.headers || undefined);
  headers.set('LinkedIn-Version', newVersion);
  next.headers = Object.fromEntries(headers.entries());
  return next;
}

/**
 * Wraps a LinkedIn API call so that HTTP 426 NONEXISTENT_VERSION triggers
 * a retry with the next-older YYYYMM. The thunk receives the version string
 * it must use for the LinkedIn-Version header on each attempt.
 */
export async function linkedInRetryOn426<T>(
  attempt: (version: string) => Promise<T>
): Promise<T> {
  let currentVersion = workingVersion;
  for (let i = 0; i <= MAX_FALLBACK_ATTEMPTS; i += 1) {
    try {
      const result = await attempt(currentVersion);
      noteVersionAccepted(currentVersion);
      return result;
    } catch (err) {
      if (!isNonexistentVersionError(err)) {
        throw err;
      }
      const older = nextOlderVersion(currentVersion);
      if (!older || i === MAX_FALLBACK_ATTEMPTS) {
        console.warn(
          `[linkedin] LinkedIn-Version fallback exhausted after ${i + 1} attempts starting from ${workingVersion}`
        );
        throw err;
      }
      console.warn(
        `[linkedin] LinkedIn-Version ${currentVersion} rejected with ${NONEXISTENT_VERSION_SIGNAL}, trying ${older}`
      );
      currentVersion = older;
    }
  }
  throw new Error('linkedInRetryOn426: unreachable');
}

/**
 * Convenience wrapper for raw `fetch()` callsites. Issues the request, and
 * if the response is HTTP 426 (or the body contains NONEXISTENT_VERSION),
 * retries with the next older version. Returns the final Response (the
 * caller is responsible for further status checking on non-426 errors).
 */
export async function linkedInFetchWithFallback(
  url: string,
  init: RequestInit,
  buildInit: (version: string) => RequestInit
): Promise<Response> {
  return linkedInRetryOn426(async (version) => {
    const response = await fetch(url, buildInit(version));
    if (response.status === 426) {
      let body = '';
      try {
        body = await response.clone().text();
      } catch {
        body = '';
      }
      throw Object.assign(new Error('LinkedIn 426 NONEXISTENT_VERSION'), {
        json: body || `{"code":"${NONEXISTENT_VERSION_SIGNAL}"}`,
        status: 426,
      });
    }
    return response;
  });
}
