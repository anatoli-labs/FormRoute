const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 10;
const BUCKET_SIZE_MS = 60 * 1000;

export async function checkRateLimit(ip, env) {
  const now = Date.now();
  const currentBucket = Math.floor(now / BUCKET_SIZE_MS);
  const bucketsInWindow = Math.ceil(WINDOW_MS / BUCKET_SIZE_MS);

  const keys = [];
  for (let i = 0; i < bucketsInWindow; i++) {
    keys.push(`rl:${ip}:${currentBucket - i}`);
  }

  const counts = await Promise.all(
    keys.map(key => env.RATE_LIMIT.get(key).then(v => parseInt(v) || 0))
  );
  const totalCount = counts.reduce((sum, c) => sum + c, 0);

  if (totalCount >= MAX_REQUESTS) {
    return {
      limited: true,
      remaining: 0,
      retryAfter: Math.ceil(WINDOW_MS / 1000)
    };
  }

  const currentKey = `rl:${ip}:${currentBucket}`;
  const currentCount = counts[0] || 0;
  await env.RATE_LIMIT.put(currentKey, String(currentCount + 1), {
    expirationTtl: Math.ceil(WINDOW_MS / 1000) + 60
  });

  return {
    limited: false,
    remaining: MAX_REQUESTS - totalCount - 1
  };
}
