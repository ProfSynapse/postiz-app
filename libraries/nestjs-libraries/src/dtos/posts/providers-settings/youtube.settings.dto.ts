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
// captionsLanguage, captions. OpenAPI documentation is auto-generated from the
// class-validator decorators by NestJS SwaggerModule introspection — no
// @ApiProperty annotations are needed (and importing @nestjs/swagger here
// pulls @nestjs/microservices into the frontend webpack bundle via the
// runtime `dto: YoutubeSettingsDto` reference on the frontend side).

// reflect-metadata is required by class-transformer's @Type() decorator below
// (was previously satisfied transitively via @nestjs/swagger's dependency
// chain; that chain was removed because it dragged @nestjs/microservices into
// the frontend webpack bundle).
import 'reflect-metadata';
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
// Note: IsISO8601 is retained on `publishAt` (YouTube accepts full datetime there).
// recordingDate uses @Matches(/^\d{4}-\d{2}-\d{2}$/) instead per M10.
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';
import { Type } from 'class-transformer';

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
  @MaxLength(10)
  @Matches(/^\d+$/, {
    message:
      'categoryId must be a numeric string (see YouTube videoCategories.list).',
  })
  @IsOptional()
  categoryId?: string;

  @IsISO8601()
  @IsOptional()
  publishAt?: string;

  @IsString()
  @MaxLength(35)
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, {
    message:
      'defaultLanguage must be a BCP-47 tag (e.g., "en", "en-US", "zh-Hant").',
  })
  @IsOptional()
  defaultLanguage?: string;

  // M10: YouTube recordingDetails.recordingDate is date-only (RFC 3339 full-date).
  // A datetime form is silently accepted by @IsISO8601 but rejected by the YouTube
  // API, so we stack @IsISO8601 (semantic validity) with @Matches (date-only
  // format). Order matters: @IsISO8601 runs alongside @Matches; both must pass.
  @IsString()
  @IsISO8601()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message:
      'recordingDate must be a date-only ISO 8601 string (YYYY-MM-DD); YouTube rejects datetimes.',
  })
  @IsOptional()
  recordingDate?: string;

  // M1: captionsLanguage is meaningful only when a caption file is attached.
  // Standalone use was previously accepted as a silent no-op; the @ValidateIf
  // gate makes it explicit. When captions.path is absent, the field is ignored
  // (the entire chain short-circuits).
  @ValidateIf((o) => o.captions?.path)
  @IsString()
  @MaxLength(35)
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, {
    message: 'captionsLanguage must be a BCP-47 tag.',
  })
  @IsOptional()
  captionsLanguage?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CaptionMediaDto)
  captions?: CaptionMediaDto;
}
