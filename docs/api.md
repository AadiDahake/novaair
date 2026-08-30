# NovaAir API

Route handlers are thin HTTP shells over the seat primitives and seat-party compositions in
`lib/seats/index.ts`. The client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat module

### Primitives

| Primitive | Job |
| --- | --- |
| `getSeatMap(flightId)` | The whole cabin: every row, every seat, and its state now. |
| `getAvailableSeats(flightId)` | The ids of every seat a passenger could take now. |
| `getPassengerRestrictions(passengerId)` | What one passenger may and may not do. |
| `calculateSeatPrice(flightId, seatId)` | What one seat costs, in cents. |
| `assignSeat(passengerId, seatId)` | Move one passenger to one seat. Atomic and idempotent. |
| `getReservation(code, lastName)` | Find one booking. |
| `getReservationByCode(code)` | Read a booking when the code is already trusted. |

`assignSeat` remains the single-passenger primitive. Calling it twice with the same passenger and
seat succeeds both times and changes nothing the second time.

### Seat-party compositions

| Composition | Job |
| --- | --- |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank valid blocks for the listed passengers. |
| `findSeatsForParty(flightId, reservationCode)` | Find and rank valid blocks for every passenger on a reservation. |
| `assignSeatsForParty(flightId, assignments)` | Atomically move a party using passenger and seat pairs. |
| `assignSeatsForParty(flightId, passengerIds, seatIds)` | Atomically match passengers and seats by array position. |
| `assignSeatsForParty(flightId, reservationCode, seatIds)` | Atomically match reservation passengers and seats by array position. |

A seat-party option has this shape:

```json
{
  "seatIds": ["21A", "21B", "21C"],
  "seats": ["21A", "21B", "21C"],
  "totalPriceCents": 0
}
```

`seats` is an alias of `seatIds`. `totalPriceCents` is the sum of `calculateSeatPrice` for every
seat in the block.

`findSeatsForParty` returns only blocks that:

- contain exactly one seat for each passenger;
- are in one row;
- use consecutive columns on one side of the aisle;
- contain only seats that are currently available;
- do not contain a booked seat, a seat held for accessible seating, or a seat held by somebody
  outside the party;
- keep children out of exit rows;
- include an adult from the same party when a passenger must sit with an adult.

The options are ordered by lowest total extra cost first. Options with the same price are ordered
by seat id. An unknown flight, invalid reservation, empty party, duplicate passenger, unknown
passenger, or party that cannot satisfy the adult rule produces an empty option list.

`assignSeatsForParty` validates the complete party before writing any assignment. Passenger ids and
seat ids must be non-empty and unique, the counts must match, and the target seats must form one
consecutive block in one row on one side of the aisle. Every seat must be available or already held
by the passenger assigned to it, and all passenger restrictions still apply.

A successful party assignment has this shape:

```json
{
  "ok": true,
  "assignments": [
    {
      "ok": true,
      "passengerId": "PAX-1",
      "seatId": "21A",
      "previousSeatId": "12A",
      "priceCents": 0
    },
    {
      "ok": true,
      "passengerId": "PAX-2",
      "seatId": "21B",
      "previousSeatId": "18C",
      "priceCents": 0
    },
    {
      "ok": true,
      "passengerId": "PAX-3",
      "seatId": "21C",
      "previousSeatId": "24F",
      "priceCents": 0
    }
  ],
  "seatIds": ["21A", "21B", "21C"],
  "seats": ["21A", "21B", "21C"],
  "totalPriceCents": 0
}
```

If an assignment loses a race after validation, completed moves are rolled back in reverse order.
The complete party lands in the new block or every passenger keeps their previous assignment.

A failed composition result carries a stable reason and a customer-readable message:

| `reason` | When |
| --- | --- |
| `invalid_party` | Travelers and seats cannot be matched, a value is empty, or an id is duplicated. |
| `flight_not_found` | The flight does not exist. |
| `passenger_not_found` | One or more passengers do not exist. |
| `seat_not_found` | One or more seats are not on the aircraft. |
| `seat_booked` | Another passenger holds a requested seat. |
| `seat_blocked` | A requested seat is held for accessible seating. |
| `adult_required` | A passenger who must sit with an adult has no eligible adult in the party. |
| `exit_row_child` | A child was assigned an exit-row seat. |
| `seats_not_together` | The seats do not form one consecutive same-side block. |

## Routes

### GET `/api/seats/{flightId}`

The seat map.

```json
{
  "flightId": "NA214",
  "cabinName": "Economy Class",
  "rowCount": 30,
  "columns": ["A", "B", "C", "D", "E", "F"],
  "aisleAfter": "C",
  "rows": [
    {
      "row": 21,
      "isExitRow": false,
      "isExtraLegroom": false,
      "left": [
        {
          "id": "21A",
          "row": 21,
          "column": "A",
          "baseState": "available",
          "isExitRow": false,
          "isExtraLegroom": false,
          "priceCents": 0,
          "state": "available",
          "occupantPassengerId": null
        }
      ],
      "right": []
    }
  ]
}
```

`baseState` is the seat itself: `available`, `booked` or `blocked`.
`state` is what the map shows after assignments are applied: `available`, `booked`, `blocked` or
`occupied`.

`404 { "error": "flight_not_found" }` when the flight does not exist.

### GET `/api/seats/{flightId}/available`

```json
{ "flightId": "NA214", "seats": ["1A", "1C", "2A", "21A", "21B", "21C"] }
```

### GET `/api/seats/{flightId}/price?seat=21A`

```json
{ "flightId": "NA214", "seat": "21A", "priceCents": 0 }
```

`400 { "error": "seat_query_required" }` with no `seat`.
`404 { "error": "seat_not_found" }` when the seat is not on the aircraft.

### GET `/api/seats/{flightId}/party?reservationCode=NVA7K2`

Find ranked blocks for every passenger on the reservation.

Response `200`:

```json
{
  "flightId": "NA214",
  "options": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "seats": ["21A", "21B", "21C"],
      "totalPriceCents": 0
    },
    {
      "seatIds": ["2D", "2E", "2F"],
      "seats": ["2D", "2E", "2F"],
      "totalPriceCents": 13500
    }
  ]
}
```

The cheapest valid block is first. An empty `options` array means no available block satisfies the
party size and passenger restrictions.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `reservation_code_required` | The query has no reservation code. |
| 404 | `reservation_not_found` | The reservation does not exist or belongs to another flight. |

### POST `/api/seats/{flightId}/party`

Automatically assign every passenger on a reservation to one valid block. Seat ids are matched to
the reservation passengers in their stored order.

Request:

```json
{
  "reservationCode": "NVA7K2",
  "seatIds": ["21A", "21B", "21C"]
}
```

Response `200`:

```json
{
  "ok": true,
  "assignments": [
    {
      "ok": true,
      "passengerId": "PAX-1",
      "seatId": "21A",
      "previousSeatId": "12A",
      "priceCents": 0
    },
    {
      "ok": true,
      "passengerId": "PAX-2",
      "seatId": "21B",
      "previousSeatId": "18C",
      "priceCents": 0
    },
    {
      "ok": true,
      "passengerId": "PAX-3",
      "seatId": "21C",
      "previousSeatId": "24F",
      "priceCents": 0
    }
  ],
  "seatIds": ["21A", "21B", "21C"],
  "seats": ["21A", "21B", "21C"],
  "totalPriceCents": 0
}
```

Failures carry an `error` reason and, for domain validation failures, a `message` written for a
customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `reservationCode_and_seatIds_required` | The body is missing a reservation code or a non-empty string array of seat ids. |
| 400 | `invalid_party` | The number of travelers and seats does not match or an id is invalid or duplicated. |
| 404 | `reservation_not_found` | The reservation does not exist or belongs to another flight. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | One or more passengers do not exist. |
| 404 | `seat_not_found` | One or more seats are not on the aircraft. |
| 409 | `seat_booked` | Another passenger holds a requested seat. |
| 409 | `seat_blocked` | A requested seat is held for accessible seating. |
| 422 | `adult_required` | A passenger who must sit with an adult has no eligible adult in the party. |
| 422 | `exit_row_child` | A child was assigned an exit-row seat. |
| 422 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |

The apply is all or nothing. If any assignment cannot be completed, every passenger keeps their
previous seat.

### GET `/api/passengers/{passengerId}/restrictions`

```json
{
  "passengerId": "PAX-2",
  "type": "child",
  "age": 9,
  "canUseExitRow": false,
  "mustSitWithAdult": true
}
```

`404 { "error": "passenger_not_found" }`.

### POST `/api/assignments`

Move one passenger to one seat. One passenger is moved for each call. Use the party route to move a
reservation into one block in a single atomic action.

Request:

```json
{ "passengerId": "PAX-1", "seatId": "21A" }
```

Response `200`:

```json
{
  "ok": true,
  "passengerId": "PAX-1",
  "seatId": "21A",
  "previousSeatId": "12A",
  "priceCents": 0
}
```

Failures carry a reason and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passengerId_and_seatId_required` | The body is missing a field. |
| 404 | `passenger_not_found` | No such passenger. |
| 404 | `seat_not_found` | The seat is not on the aircraft. |
| 409 | `seat_booked` | Another passenger already holds the seat. |
| 409 | `seat_blocked` | The seat is held for accessible seating. |
| 422 | `exit_row_child` | The passenger is a child and the seat is in an exit row. |

Calling it twice with the same passenger and seat succeeds both times and changes nothing the
second time.

### POST `/api/reservations/lookup`

Request:

```json
{ "code": "NVA7K2", "lastName": "Musk" }
```

Response `200` is the reservation with its flight and its passengers. `404
{ "error": "reservation_not_found" }` when the code or the name is wrong. The code and the name
ignore case and outer spaces.

### GET `/api/health`

```json
{ "ok": true, "store": "memory", "analytics": false, "widget": false }
```

`store` is `memory` or `supabase`.

### POST `/api/demo/reset`

Puts the booking back to 12A, 18C and 24F and restores the seed availability. It works only on the
in-memory store, because that store lives inside the running server. On Supabase, run
`npm run db:reset-demo`, which writes to the database directly.

`409 { "error": "not_supported" }` on the Supabase store.

## Storage

`lib/repo/types.ts` is the storage contract. Two stores satisfy it:

- `SupabaseSeatRepository` reads and writes Postgres through `@supabase/supabase-js` with the
  service role, on the server only. Assignment goes through the `assign_seat` SQL function, so it
  is one statement and cannot race.
- `MemorySeatRepository` holds the same data in the process, seeded by the same seed function.

The store is picked in `lib/repo/index.ts`: Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are both set, otherwise memory.
