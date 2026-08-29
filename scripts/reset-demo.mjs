#!/usr/bin/env node
/**
 * Put the demo back to its starting state: the availability pattern from the seed function, and
 * the party on 12A, 18C and 24F.
 *
 * With Supabase configured it rewrites the rows directly. Without it, the store lives inside the
 * running dev server, so it asks that server to reset itself.
 */
import process from 'node:process'
import pg from 'pg'
import { loadEnv } from './lib/env.mjs'

loadEnv()

const { createSeatDefinitions } = await import('../lib/seats/seed.ts')
const { DEMO_FLIGHT, DEMO_PASSENGERS } = await import('../lib/seats/demo-data.ts')

const connectionString = process.env.SUPABASE_DB_URL

if (!connectionString) {
  const baseUrl = process.env.NOVAAIR_BASE_URL ?? 'http://localhost:3000'
  const response = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' }).catch(() => null)
  if (!response || !response.ok) {
    console.error(
      `No SUPABASE_DB_URL, and the site at ${baseUrl} did not answer. ` +
        'Start the site with `npm run dev`, or set SUPABASE_DB_URL. See .env.example.',
    )
    process.exit(1)
  }
  console.log(`reset the in-memory demo at ${baseUrl}`)
  process.exit(0)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query('begin')
  await client.query('delete from seat_assignment where flight_id = $1', [DEMO_FLIGHT.id])

  for (const seat of createSeatDefinitions()) {
    await client.query(
      'update seat set base_state = $1 where flight_id = $2 and id = $3',
      [seat.baseState, DEMO_FLIGHT.id, seat.id],
    )
  }

  for (const passenger of DEMO_PASSENGERS) {
    if (!passenger.seatId) continue
    await client.query(
      'insert into seat_assignment (flight_id, seat_id, passenger_id) values ($1,$2,$3)',
      [DEMO_FLIGHT.id, passenger.seatId, passenger.id],
    )
  }

  await client.query('commit')
  console.log(
    'demo reset: ' + DEMO_PASSENGERS.map((p) => `${p.firstName} ${p.seatId}`).join(', '),
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
