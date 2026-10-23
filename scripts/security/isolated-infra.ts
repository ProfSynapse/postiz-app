// Explicit opt-in only. Run against the disposable Docker fixture network;
// this script never reads .env and rejects any other database/Redis host.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { AuthService } from '../../libraries/helpers/src/auth/auth.service';

async function main() {
  assert.equal(process.env.POSTIZ_ISOLATED_FIXTURE, '1');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'postiz-r2-pg');
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/postiz_fixture');
  assert.equal(new URL(process.env.REDIS_URL!).hostname, 'postiz-r2-redis');
  assert.equal(new URL(process.env.REDIS_URL!).pathname, '/0');
  const phase = process.argv[2];
  assert.ok(['seed', 'consume'].includes(phase));
  const { PrismaService } = await import('../../libraries/nestjs-libraries/src/database/prisma/prisma.service');
  const { ioRedis } = await import('../../libraries/nestjs-libraries/src/redis/redis.service');
  const { BullMqClient } = await import('../../libraries/nestjs-libraries/src/bull-mq-transport-new/client');
  const { BullMqServer } = await import('../../libraries/nestjs-libraries/src/bull-mq-transport-new/strategy');
  const { HealthController } = await import('../../apps/backend/src/api/routes/health.controller');
  const { acquirePostPublishLock, releasePostPublishLock, isPostPublishing } = await import('../../libraries/nestjs-libraries/src/database/prisma/posts/post.publish.lock');
  const { isWorkerAlive } = await import('../../libraries/nestjs-libraries/src/bull-mq-transport-new/worker.heartbeat');
  const prisma = new PrismaService();
  const producer = new BullMqClient();
  const post = producer.getQueue('post');
  const cron = producer.getQueue('cron');
  producer.queues.set('post', post);
  producer.queues.set('cron', cron);
  const inventory = async () => ({
    post: (await post.getJobs(['waiting', 'paused', 'delayed'])).map(j => ({ id: j.id, timestamp: j.timestamp, delay: j.delay })).sort((a, b) => a.id!.localeCompare(b.id!)),
    delayedScores: await ioRedis.zrange('bull:post:delayed', 0, -1, 'WITHSCORES'),
    paused: { post: await post.isPaused(), cron: await cron.isPaused() },
    schedulers: (await cron.getJobSchedulers()).map(s => ({ id: s.key, every: s.every, next: s.next })),
  });
  let server: InstanceType<typeof BullMqServer> | undefined;
  try {
    await prisma.onModuleInit();
    const hash = AuthService.hashPassword('dummy-local-password');
    assert.ok(AuthService.comparePassword('dummy-local-password', hash));
    assert.ok(!AuthService.comparePassword('wrong', hash));
    if (phase === 'seed') {
      await prisma.organization.create({ data: { id: 'fixture-org', name: 'Disposable fixture', apiKey: 'fixture-api-key' } });
      await prisma.user.create({ data: { id: 'fixture-user', email: 'fixture@example.invalid', providerName: 'LOCAL', timezone: 0, password: hash, organizations: { create: { organizationId: 'fixture-org', role: 'ADMIN' } } } });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: 'fixture-user' }, include: { organizations: true } });
      assert.equal(user.organizations.length, 1);
      assert.ok(AuthService.comparePassword('dummy-local-password', user.password!));
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.media.create({ data: { name: 'rolled-back', path: '/fixture', organizationId: 'fixture-org' } });
        throw new Error('intentional rollback');
      }), /intentional rollback/);
      assert.equal(await prisma.media.count(), 0);
      const token = await acquirePostPublishLock('fixture-post');
      assert.ok(token);
      assert.equal(await acquirePostPublishLock('fixture-post'), null);
      await releasePostPublishLock('fixture-post', 'wrong-owner');
      assert.ok(await isPostPublishing('fixture-post'));
      await releasePostPublishLock('fixture-post', token!);
      assert.ok(!(await isPostPublishing('fixture-post')));
      await producer.dispatchEvent({ pattern: 'post', data: { id: 'fixture-wait', options: {}, payload: { id: 'fixture-wait' } } });
      await producer.dispatchEvent({ pattern: 'post', data: { id: 'fixture-wait', options: {}, payload: { id: 'fixture-wait' } } });
      await producer.dispatchEvent({ pattern: 'post', data: { id: 'fixture-delay', options: { delay: 3600000 }, payload: { id: 'fixture-delay' } } });
      await producer.dispatchEvent({ pattern: 'cron', data: { id: 'fixture-repeat', options: { every: 3600000, immediately: true }, payload: { id: 'fixture-repeat' } } });
      assert.equal(await post.getWaitingCount(), 1);
      assert.equal(await post.getDelayedCount(), 1);
      assert.equal((await cron.getJobSchedulers()).length, 1);
      assert.equal(post.toKey('wait'), 'bull:post:wait');
      assert.equal(ioRedis.options.db, 0);
      await post.pause();
      await cron.pause();
      assert.equal(await post.getActiveCount(), 0);
      await writeFile('/receipts/queue-before-restart.json', JSON.stringify(await inventory(), null, 2));
      console.log(JSON.stringify({ phase, prisma: 'real create/read/relation/rollback passed', bcrypt: 'real DB hash roundtrip passed', redisLocks: 'NX and owner-only release passed', duplicateWhilePending: 'deduplicated', waitingBeforePause: 1, delayed: 1, schedulers: 1, queuesPaused: true, prefix: 'bull', db: 0 }));
    } else {
      const beforeRestart = JSON.parse(await readFile('/receipts/queue-before-restart.json', 'utf8'));
      assert.deepEqual(await inventory(), beforeRestart);
      assert.equal(await prisma.user.count(), 1);
      server = new BullMqServer();
      let releaseActive: () => void;
      const activeGate = new Promise<void>(resolve => { releaseActive = resolve; });
      let gated = false;
      const consume = async (payload: { id: string }) => {
        if (payload.id === 'fixture-wait' && !gated) { gated = true; await activeGate; }
        // Real DB side effect, no providers or production controller loaded.
        await prisma.media.create({ data: { name: payload.id, path: '/dummy-fixture', organizationId: 'fixture-org' } });
      };
      server.addHandler('post', consume, true);
      server.addHandler('cron', consume, true);
      server.listen(() => {});
      for (const worker of server.workers) worker.concurrency = 1;
      const until = async (check: () => Promise<boolean>) => {
        for (let i = 0; i < 200; i++) { if (await check()) return; await pause(100); }
        throw new Error('Fixture timed out');
      };
      await until(async () => (await isWorkerAlive()) === true);
      assert.equal(await prisma.media.count(), 0);
      assert.ok(await post.isPaused());
      assert.ok(await cron.isPaused());
      await post.resume();
      await cron.resume();
      await until(async () => (await post.getActiveCount()) === 1);
      await post.pause();
      assert.equal(await post.getActiveCount(), 1); // pause does not stop active work
      // Recurring post/plug handlers emit their current ID before returning.
      // BullMQ does not create a future successor while that ID is active.
      await producer.dispatchEvent({ pattern: 'post', data: { id: 'fixture-wait', options: { delay: 3600000 }, payload: { id: 'fixture-wait' } } });
      assert.equal(await post.getDelayedCount(), 1); // only fixture-delay
      releaseActive!();
      await until(async () => (await post.getActiveCount()) === 0);
      assert.equal(await post.getJob('fixture-wait'), undefined);
      assert.ok(await post.isPaused());
      await post.resume();
      await (await post.getJob('fixture-delay'))!.promote();
      await until(async () => (await prisma.media.count()) === 3);
      const health = new HealthController(prisma, producer);
      assert.deepEqual(await health.deep(), { redis: 'ok', postgres: 'ok', bullmq: 'ok', workers: 'ok' });
      await until(async () => !(await post.getJob('fixture-wait')));
      // Completion removes the ID: it is NOT an eternal idempotency key.
      await producer.dispatchEvent({ pattern: 'post', data: { id: 'fixture-wait', options: {}, payload: { id: 'fixture-wait' } } });
      await until(async () => (await prisma.media.count({ where: { name: 'fixture-wait' } })) === 2);
      assert.equal((await cron.getJobSchedulers()).length, 1);
      assert.ok(Number((await cron.getJobSchedulers())[0].next) > Number(beforeRestart.schedulers[0].next));
      console.log(JSON.stringify({ phase, restartInventory: 'exact IDs/timestamps/delayed scores/pause flags/scheduler preserved by RDB', handlers: 'real BullMqServer + producer + Prisma; 2 workers at concurrency1', activeDrain: 'global pause allowed active job to finish; active0 observed before resume', activeSameIdSuccessor: 'deduplicated; no future job retained after completion', deepHealth: 'all four probes passed', repeatRecreatedNext: true, replayAfterCompletion: 'same job ID consumed twice; not exactly-once' }));
    }
  } finally {
    if (server) {
      await Promise.all(server.workers.map(w => w.close()));
      server.close();
    }
    await Promise.all([post.close(), cron.close()]);
    await ioRedis.quit();
    await prisma.onModuleDestroy();
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
