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
    const path = text?.split?.('?')?.[0];
    return (
      !!path?.endsWith('.srt') ||
      !!path?.endsWith('.vtt')
    );
  }

  defaultMessage(_args: ValidationArguments) {
    return 'Caption file must have a valid extension: .srt or .vtt';
  }
}
