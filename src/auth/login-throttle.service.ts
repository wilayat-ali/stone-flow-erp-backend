import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Bucket = { failures: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTIFIER = 5;
const MAX_FAILURES_PER_IP = 30;

// In-memory failed-login counter, per identifier and per IP. Single instance
// only; move to Redis/DB before running several API replicas.
@Injectable()
export class LoginThrottleService {
  private readonly buckets = new Map<string, Bucket>();

  assertAllowed(identifierKey: string, ip: string): void {
    if (
      this.failures(`id:${identifierKey}`) >= MAX_FAILURES_PER_IDENTIFIER ||
      this.failures(`ip:${ip}`) >= MAX_FAILURES_PER_IP
    ) {
      throw new HttpException(
        { status: HttpStatus.TOO_MANY_REQUESTS, message: 'tooManyAttempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(identifierKey: string, ip: string): void {
    this.increment(`id:${identifierKey}`);
    this.increment(`ip:${ip}`);
  }

  reset(identifierKey: string): void {
    this.buckets.delete(`id:${identifierKey}`);
  }

  private failures(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    if (bucket.resetAt <= Date.now()) {
      this.buckets.delete(key);
      return 0;
    }
    return bucket.failures;
  }

  private increment(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.sweep(now);
      this.buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
      return;
    }

    bucket.failures += 1;
  }

  private sweep(now: number): void {
    if (this.buckets.size < 5000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
