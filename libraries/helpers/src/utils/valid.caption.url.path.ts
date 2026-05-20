// libraries/helpers/src/utils/valid.caption.url.path.ts
//
// Caption-specific extension validator. Sibling to valid.url.path.ts —
// accepts only .srt and .vtt. Used by CaptionMediaDto.path; do NOT add
// to ValidUrlExtension (that would silently widen MediaDto + UploadDto).

import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

@ValidatorConstraint({ name: 'checkValidCaptionExtension', async: false })
export class ValidCaptionUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, _args: ValidationArguments) {
    if (typeof text !== 'string' || text.length === 0) return false;
    // M11: Use URL.pathname when the input is a full URL so query strings,
    // fragments, and presigned signatures don't poison the extension check.
    // Fall back to a manual split for relative paths or malformed URLs.
    let path: string;
    try {
      path = new URL(text).pathname;
    } catch {
      path = text.split('#')[0].split('?')[0];
    }
    const lower = path.toLowerCase();
    return lower.endsWith('.srt') || lower.endsWith('.vtt');
  }

  defaultMessage(_args: ValidationArguments) {
    return 'Caption file must have a valid extension: .srt or .vtt';
  }
}
