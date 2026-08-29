#!/usr/bin/env node
/**
 * Fill a fresh Supabase database with the demo flight, its seats, the reservation, the passengers
 * and their starting seats.
 *
 * The seat pattern comes from `lib/seats/seed.ts`, the same function the in-memory store uses, so
 * both stores show the identical cabin.
 *
 * Run it with `npm run db:seed`, which loads the TypeScript modules through tsx.
 */
import process from 'node:process'
import pg from 'pg'
import { loadEnv } from './lib/env.mjs'

loadEnv()

const { createSeatDefinitions } = await import('../lib/seats/seed.ts')
const { DEMO_FLIGHT, DEMO_PASSENGERS, DEMO_RESERVATION } = await import('../lib/seats/demo-data.ts')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set. See .env.example.')
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query('begin')

  await client.query(
    `insert into flight (id, flight_number, origin_code, origin_city, destination_code,
                         destination_city, departure_date, departure_time, arrival_time,
                         duration_minutes, aircraft, cabin_name, row_count, fare_usd)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do update set
       flight_number = excluded.flight_number,
       departure_date = excluded.departure_date,
       row_count = excluded.row_count,
       fare_usd = excluded.fare_usd`,
    [
      DEMO_FLIGHT.id,
      DEMO_FLIGHT.flightNumber,
      DEMO_FLIGHT.originCode,
      DEMO_FLIGHT.originCity,
      DEMO_FLIGHT.destinationCode,
      DEMO_FLIGHT.destinationCity,
      DEMO_FLIGHT.departureDate,
      DEMO_FLIGHT.departureTime,
      DEMO_FLIGHT.arrivalTime,
      DEMO_FLIGHT.durationMinutes,
      DEMO_FLIGHT.aircraft,
      DEMO_FLIGHT.cabinName,
      DEMO_FLIGHT.rowCount,
      DEMO_FLIGHT.fareUsd,
    ],
  )

  const seats = createSeatDefinitions()
  await client.query('delete from seat_assignment where flight_id = $1', [DEMO_FLIGHT.id])
  await client.query('delete from seat where flight_id = $1', [DEMO_FLIGHT.id])

  const values = []
  const params = []
  seats.forEach((seat, index) => {
    const base = index * 8
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`,
    )
    params.push(
      DEMO_FLIGHT.id,
      seat.id,
      seat.row,
      seat.column,
      seat.baseState,
      seat.isExitRow,
      seat.isExtraLegroom,
      seat.priceCents,
    )
  })
  await client.query(
    `insert into seat (flight_id, id, seat_row, seat_column, base_state, is_exit_row,
                       is_extra_legroom, price_cents)
     values ${values.join(',')}`,
    params,
  )

  await client.query(
    `insert into reservation (code, last_name, flight_id, booked_on, fare_brand, total_paid_usd)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (code) do update set
       last_name = excluded.last_name,
       flight_id = excluded.flight_id,
       booked_on = excluded.booked_on,
       fare_brand = excluded.fare_brand,
       total_paid_usd = excluded.total_paid_usd`,
    [
      DEMO_RESERVATION.code,
      DEMO_RESERVATION.lastName,
      DEMO_FLIGHT.id,
      DEMO_RESERVATION.bookedOn,
      DEMO_RESERVATION.fareBrand,
      DEMO_RESERVATION.totalPaidUsd,
    ],
  )

  for (const passenger of DEMO_PASSENGERS) {
    await client.query(
      `insert into passenger (id, reservation_code, passenger_index, first_name, last_name,
                              passenger_type, age)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set
         passenger_index = excluded.passenger_index,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         passenger_type = excluded.passenger_type,
         age = excluded.age`,
      [
        passenger.id,
        passenger.reservationCode,
        passenger.index,
        passenger.firstName,
        passenger.lastName,
        passenger.type,
        passenger.age,
      ],
    )
    if (passenger.seatId) {
      await client.query(
        `insert into seat_assignment (flight_id, seat_id, passenger_id) values ($1,$2,$3)`,
        [DEMO_FLIGHT.id, passenger.seatId, passenger.id],
      )
    }
  }

  await client.query('commit')
  console.log(`seeded flight ${DEMO_FLIGHT.id} with ${seats.length} seats`)
  console.log(
    `reservation ${DEMO_RESERVATION.code} for ${DEMO_RESERVATION.lastName}: ` +
      DEMO_PASSENGERS.map((p) => `${p.firstName} ${p.seatId}`).join(', '),
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
