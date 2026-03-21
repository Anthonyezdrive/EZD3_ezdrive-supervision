import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry() {
  if (!SENTRY_DSN) {
    console.log("[Sentry] No DSN configured — monitoring disabled");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE, // "development" | "production"
    release: `ezdrive-supervision@${import.meta.env.VITE_APP_VERSION ?? "2.0.0"}`,

    // Performance monitoring
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,

    // Session replay for error reproduction
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,

    // Only send errors in production by default
    enabled: import.meta.env.PROD || !!SENTRY_DSN,

    // Filter out noisy errors
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection",
      "Network request failed",
      "Load failed",
      "Failed to fetch",
      "AbortError",
      "ChunkLoadError",
    ],

    beforeSend(event) {
      // Don't send in dev
      if (import.meta.env.DEV) return null;
      // Strip PII from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (b.category === "xhr" || b.category === "fetch") {
            // Remove auth tokens from URLs
            if (b.data?.url) {
              b.data.url = (b.data.url as string).replace(/token=[^&]+/g, "token=***");
            }
          }
          return b;
        });
      }
      return event;
    },
  });
}

// Error boundary wrapper for React
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// Manual error reporting
export function captureError(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, { extra: context });
}

// Set user context after login
export function setSentryUser(user: { id: string; email?: string; role?: string }) {
  Sentry.setUser(user);
}

// Clear user on logout
export function clearSentryUser() {
  Sentry.setUser(null);
}

export { Sentry };
