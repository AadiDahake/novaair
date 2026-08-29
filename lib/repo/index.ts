import { MemorySeatRepository } from './memory'
import { SupabaseSeatRepository } from './supabase'
import type { SeatRepository } from './types'

let cached: SeatRepository | null = null

/**
 * Pick the store from the environment.
 * Supabase is used when both its URL and its service role key are present. Otherwise the site runs
 * on the in-memory store, so `npm run dev` and the tests work with no credentials and no network.
 * The service role key is server-only. It must never reach the browser.
 */
export function getRepository(): SeatRepository {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  cached = url && serviceRoleKey
    ? new SupabaseSeatRepository(url, serviceRoleKey)
    : new MemorySeatRepository()
  return cached
}

/** Test helper. Drops the cached instance so the next call re-reads the environment. */
export function resetRepositoryCache(): void {
  cached = null
}

export type { SeatRepository } from './types'
