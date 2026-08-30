#!/usr/bin/env node
/**
 * Put the demo back to its starting state: the availability pattern from the seed function, and
 * the party on 12A, 18C and 24F.
 *
 * With Supabase configured it rewrites the rows directly. Without it, the store lives inside the
 * running dev server, so it asks that server to reset itself.
 */
import process from 'node:process'
import { createClient } from './lib/db.mjs'
import { resetInPostgres, resetOverHttp, startingSeatsLine } from './lib/demo-reset.mjs'
import { loadEnv } from './lib/env.mjs'

loadEnv()

const connectionString = process.env.SUPABASE_DB_URL

if (!connectionString) {
  const baseUrl = process.env.NOVAAIR_BASE_URL ?? 'http://localhost:3000'
  if (!(await resetOverHttp(baseUrl))) {
    console.error(
      `No SUPABASE_DB_URL, and the site at ${baseUrl} did not answer. ` +
        'Start the site with `npm run dev`, or set SUPABASE_DB_URL. See .env.example.',
    )
    process.exit(1)
  }
  console.log(`reset the in-memory demo at ${baseUrl}`)
  process.exit(0)
}

const client = createClient(connectionString)
await client.connect()
try {
  await resetInPostgres(client)
  console.log(`demo reset: ${startingSeatsLine()}`)
} finally {
  await client.end()
}
