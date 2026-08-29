'use client'

import { useEffect } from 'react'
import { startAnalytics } from './client'

/** Starts PostHog once, on the client, after the first render. */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    startAnalytics()
  }, [])
  return <>{children}</>
}
