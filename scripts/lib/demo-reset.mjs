/**
 * Put the demo booking back on 12A, 18C and 24F.
 *
 * Two stores need two ways in. The in-memory store lives inside the running server, so only that
 * server can reset it, which is what `POST /api/demo/reset` is for. The Supabase store is a
 * database, so the reset writes to it directly. Callers say where the site is and where the
 * database is, and this module picks the one that can answer.
 */
import { DEMO_FLIGHT, DEMO_PASSENGERS } from '../../lib/seats/demo-data.ts'
import { createSeatDefinitions } from '../../lib/seats/seed.ts'

/**
 * Ask a running site to reset its in-memory store.
 * Returns false when the site answers that it is not on the in-memory store, so the caller can
 * fall back to the database.
 */
export async function resetOverHttp(baseUrl) {
  const response = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' }).catch(() => null)
  return Boolean(response?.ok)
}

/**
 * Put the booking back in Postgres.
 *
 * `seatStates` also rewrites every seat's base state from the seed function. The site never
 * changes a base state, so a session generator does not need that pass and skips it.
 */
export async function resetInPostgres(client, { seatStates = true } = {}) {
  await client.query('begin')
  try {
    await client.query('delete from seat_assignment where flight_id = $1', [DEMO_FLIGHT.id])

    if (seatStates) {
      for (const seat of createSeatDefinitions()) {
        await client.query('update seat set base_state = $1 where flight_id = $2 and id = $3', [
          seat.baseState,
          DEMO_FLIGHT.id,
          seat.id,
        ])
      }
    }

    for (const passenger of DEMO_PASSENGERS) {
      if (!passenger.seatId) continue
      await client.query(
        'insert into seat_assignment (flight_id, seat_id, passenger_id) values ($1,$2,$3)',
        [DEMO_FLIGHT.id, passenger.seatId, passenger.id],
      )
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/** The starting seats, as one line for a log. */
export function startingSeatsLine() {
  return DEMO_PASSENGERS.map((passenger) => `${passenger.firstName} ${passenger.seatId}`).join(', ')
}
