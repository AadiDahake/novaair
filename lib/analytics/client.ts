'use client'

import posthog from 'posthog-js'
import type { NovaAirEventMap, NovaAirEventName } from './events'

/**
 * PostHog is started in `instrumentation-client.ts`, before the app hydrates.
 * This module only sends the explicit events of the contract in `./events.ts`.
 */

/** True when a PostHog project key is set, so PostHog is running. */
export function analyticsIsOn(): boolean {
  return typeof window !== 'undefined' && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY)
}

/** Send one event from the contract. It does nothing when PostHog is not running. */
export function capture<Name extends NovaAirEventName>(
  name: Name,
  properties: NovaAirEventMap[Name],
): void {
  if (!analyticsIsOn()) return
  posthog.capture(name, properties)
}
