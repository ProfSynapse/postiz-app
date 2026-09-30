/** Public detail projection. Never serialize database objects or raw JSON. */
export interface PublicMediaDto {
  id: string;
  name: string;
  type: string;
  url: string | null;
  thumbnail: string | null;
  alt: string | null;
}

export interface PublicPostSettingsDto {
  __type: string;
  post_as_images_carousel?: boolean;
  title?: string;
  type?: string;
  selfDeclaredMadeForKids?: string;
  tags?: { value: string; label: string }[];
  thumbnail?: PublicMediaDto;
  captions?: PublicMediaDto;
  categoryId?: string;
  publishAt?: string;
  defaultLanguage?: string;
  recordingDate?: string;
  captionsLanguage?: string;
}

export interface PublicPostItemDto {
  id: string;
  parentPostId: string | null;
  state: string;
  publishDate: Date;
  content: string;
  title: string | null;
  description: string | null;
  releaseURL: string | null;
  image: PublicMediaDto[];
  mediaComplete: boolean;
  settings: PublicPostSettingsDto;
  settingsComplete: boolean;
}

export interface PublicPostDetailsDto {
  id: string;
  group: string;
  integration: { id: string; name: string; providerIdentifier: string };
  posts: PublicPostItemDto[];
  threadComplete: boolean;
}

export interface PublicMediaRow {
  id: string;
  name: string;
  type: string;
  path: string;
  thumbnail: string | null;
  alt: string | null;
}

export function parseStoredJson(
  value: string | null,
  fallback: unknown
): unknown {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mediaReferences(image: unknown, settings: unknown): unknown[] {
  return [
    ...(Array.isArray(image) ? image : []),
    ...(isRecord(settings) ? [settings.thumbnail, settings.captions] : []),
  ].filter(isRecord);
}

export function mediaReferenceKeys(references: unknown[]) {
  const ids: string[] = [];
  const paths: string[] = [];
  for (const reference of references) {
    if (!isRecord(reference)) continue;
    if (typeof reference.id === 'string' && reference.id)
      ids.push(reference.id);
    // Never fall back to a supplied path when the id is foreign/deleted.
    else if (typeof reference.path === 'string') paths.push(reference.path);
  }
  return { ids: [...new Set(ids)], paths: [...new Set(paths)] };
}

/** Public HTTP URLs or known legacy upload paths, never filesystem paths.
 * Omit credential/query-bearing URLs rather than pretending a stripped URL
 * proves the exact attachment. No fetch, filesystem access, or writes. */
export function publicMediaUrl(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  let candidate = path;
  if (
    /^\/\d{4}\/\d{2}\/\d{2}\//.test(path) &&
    !path.includes('..') &&
    !path.includes('\\')
  ) {
    const directory =
      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY || 'uploads';
    if (!/^[a-zA-Z0-9/_-]+$/.test(directory)) return null;
    candidate = `${(process.env.FRONTEND_URL || '').replace(
      /\/$/,
      ''
    )}/${directory.replace(/^\/+|\/+$/g, '')}${path}`;
  }
  try {
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolvePublicMedia(
  reference: unknown,
  rows: PublicMediaRow[]
): PublicMediaDto | undefined {
  if (!isRecord(reference)) return undefined;
  const row =
    typeof reference.id === 'string' && reference.id
      ? rows.find((entry) => entry.id === reference.id)
      : rows.find((entry) => entry.path === reference.path);
  if (!row) return undefined;
  const rowUrl = publicMediaUrl(row.path);
  // A stored id/path mismatch must not be reported as the exact scheduled
  // attachment. Do not expose the unverified path or repair the record.
  const url =
    reference.path !== undefined &&
    reference.path !== row.path &&
    publicMediaUrl(reference.path) !== rowUrl
      ? null
      : rowUrl;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url,
    thumbnail: publicMediaUrl(reference.thumbnail ?? row.thumbnail),
    alt: typeof reference.alt === 'string' ? reference.alt : row.alt,
  };
}

export function projectPublicSettings(
  provider: string,
  raw: unknown,
  rows: PublicMediaRow[]
) {
  const settings: PublicPostSettingsDto = { __type: provider };
  if (!isRecord(raw)) return { settings, complete: false };
  const linkedin = provider === 'linkedin' || provider === 'linkedin-page';
  const youtube = provider === 'youtube';
  const strings = youtube
    ? ([
        'title',
        'type',
        'selfDeclaredMadeForKids',
        'categoryId',
        'publishAt',
        'defaultLanguage',
        'recordingDate',
        'captionsLanguage',
      ] as const)
    : [];
  const allowed = new Set<string>([
    '__type',
    ...(linkedin ? ['post_as_images_carousel'] : []),
    ...strings,
    ...(youtube ? ['tags', 'thumbnail', 'captions'] : []),
  ]);
  let complete =
    (linkedin || youtube) && Object.keys(raw).every((key) => allowed.has(key));
  if (raw.__type !== undefined && raw.__type !== provider) complete = false;
  if (linkedin && raw.post_as_images_carousel !== undefined) {
    if (typeof raw.post_as_images_carousel === 'boolean')
      settings.post_as_images_carousel = raw.post_as_images_carousel;
    else complete = false;
  }
  for (const key of strings) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'string') settings[key] = raw[key] as string;
    else complete = false;
  }
  if (youtube && raw.tags !== undefined) {
    settings.tags = [];
    if (!Array.isArray(raw.tags)) complete = false;
    else
      for (const tag of raw.tags) {
        if (
          isRecord(tag) &&
          typeof tag.value === 'string' &&
          typeof tag.label === 'string'
        ) {
          settings.tags.push({ value: tag.value, label: tag.label });
          if (Object.keys(tag).some((key) => !['value', 'label'].includes(key)))
            complete = false;
        } else complete = false;
      }
  }
  if (youtube)
    for (const key of ['thumbnail', 'captions'] as const) {
      if (raw[key] === undefined) continue;
      const media = resolvePublicMedia(raw[key], rows);
      if (media) settings[key] = media;
      if (!media || !media.url) complete = false;
    }
  return { settings, complete };
}
