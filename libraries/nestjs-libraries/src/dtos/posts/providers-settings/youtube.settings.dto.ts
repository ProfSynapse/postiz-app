// libraries/nestjs-libraries/src/dtos/posts/providers-settings/youtube.settings.dto.ts
//
// Settings payload for the YouTube provider. The existing 5 fields (title, type,
// selfDeclaredMadeForKids, thumbnail, tags) remain validated exactly as before;
// the cross-field overlay `@ValidateIf((o) => o.publishAt) @IsIn(['private'])`
// is stacked on `type` per synthesis decision S3 — when publishAt is set the
// caller MUST set type='private' or validation rejects with a clear message.
//
// Six new optional fields appended after `tags` enrich the YouTube payload via
// the public API: categoryId, publishAt, defaultLanguage, recordingDate,
// captionsLanguage, captions. Only these new fields carry @ApiProperty
// annotations — the existing fields are NOT retrofitted per plan §4.1.

import {
  IsArray,
  IsDefined,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class YoutubeTagsSettings {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

export class YoutubeSettingsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @IsDefined()
  title: string;

  @ValidateIf((o) => o.publishAt)
  @IsIn(['private'], {
    message:
      'When publishAt is set, type must be "private" — YouTube requires this.',
  })
  @IsIn(['public', 'private', 'unlisted'])
  @IsDefined()
  type: string;

  @IsIn(['yes', 'no'])
  @IsOptional()
  selfDeclaredMadeForKids: 'no' | 'yes';

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  thumbnail?: MediaDto;

  @IsArray()
  @IsOptional()
  @ValidateNested()
  @Type(() => YoutubeTagsSettings)
  tags: YoutubeTagsSettings[];

  @IsString()
  @Matches(/^\d+$/, {
    message:
      'categoryId must be a numeric string (see YouTube videoCategories.list).',
  })
  @IsOptional()
  @ApiProperty({
    required: false,
    description:
      'YouTube category ID (numeric string). E.g., "22" for People & Blogs.',
    example: '22',
  })
  categoryId?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({
    required: false,
    description:
      'ISO 8601 timestamp. Requires type="private". Forwarded to YouTube status.publishAt.',
    example: '2026-06-15T14:00:00.000Z',
  })
  publishAt?: string;

  @IsString()
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, {
    message:
      'defaultLanguage must be a BCP-47 tag (e.g., "en", "en-US", "zh-Hant").',
  })
  @IsOptional()
  @ApiProperty({
    required: false,
    description: 'BCP-47 language tag for video title/description.',
    example: 'en',
  })
  defaultLanguage?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({
    required: false,
    description:
      'ISO 8601 date the video was recorded. Forwarded to YouTube recordingDetails.recordingDate.',
    example: '2026-05-15',
  })
  recordingDate?: string;

  @IsString()
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, {
    message: 'captionsLanguage must be a BCP-47 tag.',
  })
  @IsOptional()
  @ApiProperty({
    required: false,
    description:
      'BCP-47 language tag for the caption track. Defaults to "en" when captions is set.',
    example: 'en',
  })
  captionsLanguage?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CaptionMediaDto)
  @ApiProperty({
    required: false,
    description:
      'Optional SRT or VTT caption file to attach after the video uploads.',
    type: () => CaptionMediaDto,
  })
  captions?: CaptionMediaDto;
}
