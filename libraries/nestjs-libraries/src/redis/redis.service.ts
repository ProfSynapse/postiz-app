import { Redis } from 'ioredis';

// Create a mock Redis implementation for testing environments
class MockRedis {
  private data: Map<string, any> = new Map();

  async get(key: string) {
    return this.data.get(key);
  }

  async set(key: string, value: any) {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    this.data.delete(key);
    return 1;
  }

  // Add other Redis methods as needed for your tests
}

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
export const ioRedis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
      // Dual-stack DNS lookup (IPv4 + IPv6). REQUIRED for Railway private
      // networking — *.railway.internal hosts are IPv6-only (AAAA records).
      // ioredis defaults to family:4 which yields ETIMEDOUT on Railway and
      // silently stalls BullMQ workers/cron. Do NOT remove without verifying
      // the deploy target resolves Redis hostnames via IPv4.
      family: 0,
    })
  : (new MockRedis() as unknown as Redis); // Type cast to Redis to maintain interface compatibility
