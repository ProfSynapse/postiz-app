import { IUploadProvider } from './upload.interface';
import { mkdirSync, promises as fsp, writeFileSync } from 'fs';
// @ts-ignore
import mime from 'mime';
import { extname } from 'path';
import axios from 'axios';
import { verifyAbsolutePath } from './path.confinement';
import { PathConfinementError } from './path.confinement.error';

export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  async uploadSimple(path: string) {
    const loadImage = await axios.get(path, { responseType: 'arraybuffer' });
    const contentType =
      loadImage?.headers?.['content-type'] ||
      loadImage?.headers?.['Content-Type'];
    const findExtension = mime.getExtension(String(contentType))!;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filePath = `${dir}/${randomName}.${findExtension}`;
    const publicPath = `${innerPath}/${randomName}.${findExtension}`;
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, loadImage.data);

    return process.env.FRONTEND_URL + '/uploads' + publicPath;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const innerPath = `/${year}/${month}/${day}`;
      const dir = `${this.uploadDirectory}${innerPath}`;
      mkdirSync(dir, { recursive: true });

      const randomName = Array(32)
        .fill(null)
        .map(() => Math.round(Math.random() * 16).toString(16))
        .join('');

      const filePath = `${dir}/${randomName}${extname(file.originalname)}`;
      const publicPath = `${innerPath}/${randomName}${extname(
        file.originalname
      )}`;

      // Logic to save the file to the filesystem goes here
      writeFileSync(filePath, file.buffer);

      return {
        filename: `${randomName}${extname(file.originalname)}`,
        path: process.env.FRONTEND_URL + '/uploads' + publicPath,
        mimetype: file.mimetype,
        originalname: file.originalname,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  /**
   * Defense-in-depth gate (SD1) for all filesystem deletions.
   *
   * Re-asserts path confinement against the configured `uploadDirectory`
   * even when callers (such as the media-janitor) have already pre-flighted
   * via MediaPathResolver. This ensures that ANY future caller of
   * `removeFile` - including paths that bypass the resolver - is protected.
   *
   * Throws `PathConfinementError` with a typed `reason` on rejection. ENOENT
   * from the actual unlink propagates as-is so callers can treat it as
   * idempotent success.
   *
   * See: docs/architecture/media-janitor.md §5
   *      docs/plans/media-janitor-plan.md §Path-confinement contract Layer 2
   */
  async removeFile(filePath: string): Promise<void> {
    const result = await verifyAbsolutePath(filePath, this.uploadDirectory);
    if (!result.ok) {
      throw new PathConfinementError(result.reason, filePath);
    }
    await fsp.unlink(result.absolutePath);
  }
}
