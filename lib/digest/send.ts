/**
 * Resend wrapper with lazy initialization.
 *
 * Mirrors the Proxy pattern used by `db/client.ts`: Next.js evaluates route
 * handler modules at build time ("Collecting page data"), where runtime-only
 * env vars (RESEND_API_KEY) aren't injected. A top-level `new Resend(...)`
 * would crash every build that imports this file.
 *
 * The exported `getResend()` defers instantiation until the first send call,
 * which only happens at request time.
 */
import { Resend } from "resend";

let cached: Resend | null = null;

export function getResend(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  cached = new Resend(key);
  return cached;
}

/**
 * Resolve the sender address from env.
 *
 * If DIGEST_SENDER_DOMAIN is set, use `digest@<domain>`. Otherwise fall back
 * to Resend's verified test sender `delivered@resend.dev` and log a warning.
 * Never hardcode the user's actual sender domain — must come from env.
 */
export function resolveFromAddress(name = "SF Events"): {
  from: string;
  isFallback: boolean;
} {
  const domain = process.env.DIGEST_SENDER_DOMAIN?.trim();
  if (domain && domain.length > 0) {
    return { from: `${name} <digest@${domain}>`, isFallback: false };
  }
  console.warn(
    "[digest] DIGEST_SENDER_DOMAIN not set; falling back to delivered@resend.dev. " +
      "Set DIGEST_SENDER_DOMAIN in env once your sender domain is verified in Resend.",
  );
  return {
    from: `${name} <delivered@resend.dev>`,
    isFallback: true,
  };
}

/** Test-only: reset the cached Resend client (e.g., between vitest cases). */
export function __resetResendCache(): void {
  cached = null;
}
