'use client'

import posthog from 'posthog-js'
import type { NovaAirEventMap, NovaAirEventName } from './events'

let started = false

/**
 * Start PostHog, but only when a project key is set. With no key the site runs normally and sends
 * nothing, which is what `npm run dev` and the end-to-end tests need.
 */
export function startAnalytics(): void {
  if (started || typeof window === 'undefined') return
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: false,
    session_recording: { maskAllInputs: false },
  })
  started = true
}

export function analyticsIsOn(): boolean {
  return started
}

/** Send one event from the contract in `lib/analytics/events.ts`. */
export function capture<Name extends NovaAirEventName>(
  name: Name,
  properties: NovaAirEventMap[Name],
): void {
  if (typeof window === 'undefined') return
  if (!started) return
  posthog.capture(name, properties)
}
