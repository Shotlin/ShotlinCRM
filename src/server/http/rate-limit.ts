import { getPublisher } from '../realtime';

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const redis = getPublisher();
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const redisKey = `shotlin:rate:${key}:${bucket}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSeconds);
  return count <= limit;
}
