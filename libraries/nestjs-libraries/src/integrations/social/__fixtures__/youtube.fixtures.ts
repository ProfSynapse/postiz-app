// libraries/nestjs-libraries/src/integrations/social/__fixtures__/youtube.fixtures.ts
//
// Test fixtures for the YouTube richer-metadata feature. Consumed by Phase 1
// DTO specs and Phase 2 provider specs (see plan §5). Inline templates keep
// fixtures self-contained — no filesystem reads needed.

import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';

export function validMediaDto(overrides: Partial<MediaDto> = {}): MediaDto {
  return {
    id: 'media-1',
    path: 'https://cdn.example.com/uploads/video.mp4',
    ...overrides,
  } as MediaDto;
}

export function validCaptionMediaDto(
  overrides: Partial<CaptionMediaDto> = {}
): CaptionMediaDto {
  return {
    id: 'caption-1',
    path: 'https://cdn.example.com/uploads/captions.srt',
    ...overrides,
  } as CaptionMediaDto;
}

export function validYoutubeSettings(
  overrides: Partial<YoutubeSettingsDto> = {}
): YoutubeSettingsDto {
  return {
    title: 'Sample video title',
    type: 'private',
    selfDeclaredMadeForKids: 'no',
    tags: [],
    ...overrides,
  } as YoutubeSettingsDto;
}

// ~145-byte SRT template per preparer Q4. Two cues, well-formed.
export const sampleSRT = `1
00:00:00,000 --> 00:00:02,000
Hello, world.

2
00:00:02,000 --> 00:00:04,000
This is a caption.
`;

// ~132-byte VTT template per preparer Q4. WEBVTT magic header, two cues.
export const sampleVTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello, world.

00:00:02.000 --> 00:00:04.000
This is a caption.
`;

// Minimal gaxios-shaped success envelope. Generic over the data payload so the
// same helper serves videos.insert, thumbnails.set, captions.insert mocks.
export function gaxiosOkResponse<T>(data: T) {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {},
    request: {},
  };
}
