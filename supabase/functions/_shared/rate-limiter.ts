/**
 * Simple in-memory sliding window rate limiter for Deno edge functions.
 * Uses IP + path as key. Resets per-isolate (acceptable for edge).
 */

const store = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  windowMs: number;   // Time window in ms
  maxRequests: number; // Max requests per window
}

export const RATE_LIMITS = {
  auth: { windowMs: 60_000, maxRequests: 10 },       // 10 req/min for login/register
  payment: { windowMs: 60_000, maxRequests: 5 },      // 5 req/min for payments
  api: { windowMs: 60_000, maxRequests: 60 },          // 60 req/min for general API
  webhook: { windowMs: 60_000, maxRequests: 100 },     // 100 req/min for webhooks
} as const;

export function checkRateLimit(req: Request, config: RateLimitConfig): { allowed: boolean; remaining: number; resetAt: number } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const path = new URL(req.url).pathname;
  const key = `${ip}:${path}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

export function rateLimitHeaders(result: { remaining: number; resetAt: number }): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

export function rateLimitResponse(result: { resetAt: number }, corsHeaders: Record<string, string>): Response {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({ error: 'Too many requests', retryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    }
  );
}
