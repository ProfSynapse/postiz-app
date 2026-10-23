import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';

// Multipart text fields are only small metadata (for example preventSave).
// Multer 2.5 supports the depth/index controls; the remaining controls retain
// its documented field byte limits while bounding the number of fields.
export const POSTIZ_MULTIPART_LIMITS = {
  files: 1,
  // Match the existing validator's largest supported (video) size, while
  // enforcing a ceiling during parsing rather than after buffering the file.
  fileSize: 1024 * 1024 * 1024,
  fieldNameSize: 100,
  fieldSize: 1024 * 1024,
  fields: 32,
  fieldNestingDepth: 32,
  fieldArrayIndexLimit: 1024,
};

// Nest 10 only translates the older Multer messages. Multer 2 adds safe
// rejections for invalid field names, nesting and oversized array indices.
// Keep those input errors out of the generic 500 path, without reflecting
// attacker-supplied field names or file names into the response.
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      message: 'Invalid multipart upload',
      code: error.code,
    });
  }
}
