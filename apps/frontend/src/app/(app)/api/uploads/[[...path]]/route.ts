import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { Readable } from 'stream';
import { verifyAbsolutePath } from '@gitroom/nestjs-libraries/upload/path.confinement';
// @ts-ignore
import mime from 'mime';
export const GET = async (
  request: NextRequest,
  context: {
    params: Promise<{
      path?: string[];
    }>;
  }
) => {
  const { path } = await context.params;
  const uploadRoot = process.env.UPLOAD_DIRECTORY;
  // Decide at request time: a secret-free Docker build must not bake the
  // build machine's storage mode into its routes manifest.
  if ((process.env.STORAGE_PROVIDER || 'local') !== 'local' || !uploadRoot || !path?.length) {
    return new Response(null, { status: 404 });
  }
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const confined = await verifyAbsolutePath(resolve(uploadRoot, ...path), uploadRoot);
    if (confined.ok === false) return new Response(null, { status: 404 });
    file = await fs.open(confined.absolutePath, 'r');
    const stats = await file.stat();
    if (!stats.isFile()) { await file.close(); return new Response(null, { status: 404 }); }
    // The stream owns the descriptor and closes it on end/cancellation.
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, {
      headers: {
        'Content-Type': mime.getType(confined.absolutePath) || 'application/octet-stream',
        'Content-Length': stats.size.toString(),
        'Last-Modified': stats.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    await file?.close();
    return new Response(null, { status: 404 });
  }
};
