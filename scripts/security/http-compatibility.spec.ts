import 'reflect-metadata';
import { Body, Controller, Module, Post, Req, UploadedFile, UseInterceptors, UseFilters } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import axios from 'axios';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalStorage } from '../../libraries/nestjs-libraries/src/upload/local.storage';
import { isMcpInputWithinLimits } from '../../libraries/nestjs-libraries/src/chat/mcp.request.limits';
import { MulterExceptionFilter, POSTIZ_MULTIPART_LIMITS } from '../../libraries/nestjs-libraries/src/upload/multer.exception.filter';
import { mountMcpRouter } from '../../libraries/nestjs-libraries/src/chat/mcp.router';

let storage: LocalStorage;
@Controller()
@UseFilters(new MulterExceptionFilter())
class UploadFixture {
  @Post('/json-echo')
  echo(@Body() body: any, @Req() req: any) {
    return { body, raw: req.rawBody?.toString() };
  }

  @Post('/upload-small-limit')
  @UseInterceptors(FileInterceptor('file', { limits: { ...POSTIZ_MULTIPART_LIMITS, fileSize: 64 } }))
  uploadSmall(@UploadedFile() file: Express.Multer.File) {
    return storage.uploadFile(file);
  }

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file', { limits: POSTIZ_MULTIPART_LIMITS }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return storage.uploadFile(file);
  }
}
@Module({ controllers: [UploadFixture] })
class FixtureModule {}

describe('patched outbound and multipart HTTP interfaces (real local sockets)', () => {
  let app: any;
  let server: ReturnType<typeof createServer>;
  let sink: ReturnType<typeof createServer>;
  let base: string;
  let upload: string;
  let directory: string;
  let png: Buffer;
  const oldFrontend = process.env.FRONTEND_URL;
  const oldProxy = axios.defaults.proxy;
  beforeAll(async () => {
    axios.defaults.proxy = false;
    directory = await mkdtemp(path.join(tmpdir(), 'postiz-http-'));
    process.env.FRONTEND_URL = 'http://fixture.invalid';
    storage = new LocalStorage(directory);
    png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#669933' } }).png().toBuffer();
    sink = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }));
    });
    await new Promise<void>(r => sink.listen(0, '127.0.0.1', r));
    server = createServer((req, res) => {
      if (req.url === '/redirect-origin') { res.writeHead(302, { location: `http://127.0.0.1:${(sink.address() as any).port}/` }); res.end(); return; }
      if (req.url === '/redirect') { res.writeHead(302, { location: '/image' }); res.end(); return; }
      if (req.url === '/image') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
      if (req.url === '/missing') { res.writeHead(404); res.end(); return; }
      const parts: Buffer[] = [];
      req.on('data', b => parts.push(b));
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: Buffer.concat(parts).toString(), header: req.headers['x-fixture'] })); });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    app = await NestFactory.create(FixtureModule, { logger: false, rawBody: true });
    const mcpRouter = mountMcpRouter(app);
    mcpRouter.post('/:id', (req, res) => { res.json({ body: req.body }); });
    await app.listen(0, '127.0.0.1');
    upload = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>(r => server?.close(() => r()));
    await new Promise<void>(r => sink?.close(() => r()));
    await rm(directory, { recursive: true, force: true });
    if (oldFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = oldFrontend;
    axios.defaults.proxy = oldProxy;
  });

  it('sends JSON and retains headers, streams and HTTP status errors with Axios', async () => {
    const result = await axios.post(base, { offline: true }, { headers: { 'x-fixture': 'retained' }, proxy: false });
    expect(JSON.parse(result.data.data)).toEqual({ offline: true });
    expect(result.data.header).toBe('retained');
    const stream = await axios.get(base + '/image', { responseType: 'stream', proxy: false });
    const chunks: Buffer[] = [];
    for await (const chunk of stream.data) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(png);
    await expect(axios.get(base + '/missing', { proxy: false })).rejects.toMatchObject({ response: { status: 404 } });
  });

  it('retains normal JSON and raw-body parsing after mounting the MCP parser', async () => {
    const result = await axios.post(upload + '/json-echo', { fixture: true });
    expect(result.data).toEqual({ body: { fixture: true }, raw: '{"fixture":true}' });
  });

  it('parses MCP JSON with its own byte ceiling through the early router', async () => {
    const good = await axios.post(upload + '/mcp/fixture', { fixture: true });
    expect(good.data).toEqual({ body: { fixture: true } });
    const large = await fetch(upload + '/mcp/fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(102401) }) });
    expect(large.status).toBe(413);
  });

  it('downloads redirected media through the actual LocalStorage Axios path', async () => {
    const publicUrl = await storage.uploadSimple(base + '/redirect');
    const bytes = await readFile(path.join(directory, new URL(publicUrl).pathname.replace('/uploads/', '')));
    expect(bytes).toEqual(png);
    expect((await sharp(bytes).metadata()).width).toBe(3);
  });

  it('enforces the Axios fetch adapter response limit over real HTTP', async () => {
    await expect(axios.get(base + '/image', { adapter: 'fetch', maxContentLength: 8 })).rejects.toThrow();
  });

  it('strips credentials when following a redirect to another origin', async () => {
    const result = await axios.get(base + '/redirect-origin', { headers: { Authorization: 'Bearer fixture-only', Cookie: 'fixture=one' }, proxy: false });
    expect(result.data).toEqual({ auth: null, cookie: null });
  });

  it('uploads real multipart bytes through Nest FileInterceptor and local storage', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
    const result = await axios.post(upload + '/upload', form, { proxy: false });
    expect(result.status).toBe(201);
    expect(result.data.originalname).toBe('fixture.png');
    const bytes = await readFile(path.join(directory, new URL(result.data.path).pathname.replace('/uploads/', '')));
    expect(bytes).toEqual(png);
  });

  it('rejects oversized multipart field indexes without losing the HTTP listener', async () => {
    const form = new FormData();
    form.append('field[4294967295]', 'one');
    form.append('field[]', 'two');
    const result = await fetch(upload + '/upload', { method: 'POST', body: form });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'LIMIT_FIELD_ARRAY_INDEX' });
    const good = new FormData();
    good.append('file', new Blob([new Uint8Array(png)]), 'after.png');
    expect((await fetch(upload + '/upload', { method: 'POST', body: good })).status).toBe(201);
  });

  it('handles truncated multipart bodies through the actual parser', async () => {
    const result = await fetch(upload + '/upload', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=fixture' },
      body: '--fixture\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\ntruncated',
    });
    expect(result.status).toBe(400);
  });

  it('bounds multipart metadata nesting before field expansion', async () => {
    const form = new FormData();
    form.append('x' + '[a]'.repeat(33), 'bounded');
    const result = await fetch(upload + '/upload', { method: 'POST', body: form });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'LIMIT_FIELD_NESTING' });
  });

  it('enforces a streaming file-size limit before local storage is invoked', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(65)]), 'too-large.bin');
    expect((await fetch(upload + '/upload-small-limit', { method: 'POST', body: form })).status).toBe(413);
  });
});

it('bounds MCP object keys, arrays and nesting before Mastra validation', () => {
  expect(isMcpInputWithinLimits({ params: { arguments: { text: 'fixture' } } })).toBe(true);
  expect(isMcpInputWithinLimits({ params: { arguments: Array(10_001).fill(0) } })).toBe(false);
  let nested: any = {};
  for (let i = 0; i < 66; i++) nested = { next: nested };
  expect(isMcpInputWithinLimits(nested)).toBe(false);
});
