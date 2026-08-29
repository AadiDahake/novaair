import posthog from 'posthog-js'

/**
 * PostHog starts here.
 *
 * Next.js runs this file on the client before the app hydrates, which is the pattern the PostHog
 * wizard produces for Next.js 15.3 and later. Starting before hydration means the first pageview
 * and the start of the session recording are not lost.
 *
 * It starts only when NEXT_PUBLIC_POSTHOG_KEY is set. With no key nothing is sent and no request
 * leaves the browser, so `npm run dev` and the end-to-end run are silent by default.
 *
 * The explicit events NovaAir sends sit on top of this. They are declared in
 * `lib/analytics/events.ts` and written down in `docs/analytics.md`.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    defaults: '2026-05-30',
    // The demo needs the replay and the raw click stream, not only the explicit events.
    autocapture: true,
    disable_session_recording: false,
    session_recording: { maskAllInputs: false },
    person_profiles: 'always',
  })
}
