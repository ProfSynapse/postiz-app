// libraries/nestjs-libraries/src/dtos/media/caption.media.dto.ts
//
// Sibling DTO to MediaDto for SRT/VTT caption attachments on YouTube posts.
// Identical shape to MediaDto; the only difference is the extension validator
// stacked on `path` (ValidCaptionUrlExtension instead of ValidUrlExtension).
//
// Shared ValidUrlPath is reused for domain-restriction (security check when
// RESTRICT_UPLOAD_DOMAINS env is set) — do not redefine it here.

import { IsDefined, IsString, IsUrl, ValidateIf, Validate } from 'class-validator';
import { ValidUrlPath } from '@gitroom/helpers/utils/valid.url.path';
import { ValidCaptionUrlExtension } from '@gitroom/helpers/utils/valid.caption.url.path';

export class CaptionMediaDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  @Validate(ValidUrlPath)
  @Validate(ValidCaptionUrlExtension)
  path: string;

  @ValidateIf((o) => o.alt)
  @IsString()
  alt?: string;

  @ValidateIf((o) => o.thumbnail)
  @IsUrl()
  thumbnail?: string;
}
