# NovaAir API

Every route handler is a thin shell over a domain operation in `lib/seats/index.ts`. The client
calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat domain operations

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

### Seat-party compositions

| Composition | Job |
| --- | --- |
| `findSeatsForParty(flightId, passengerIds)` | Find valid adjacent seat blocks for a party, ranked by total extra cost. |
| `assignSeatsForParty(...)` | Move every passenger in a party into one valid block as one all-or-nothing operation. |

`findSeatsForParty` composes the seat map, availability, passenger restrictions and seat prices.
Each returned block:

- contains one seat for each requested passenger;
- is in one row and uses consecutive columns on one side of the aisle;
- excludes booked seats and seats held for accessible seating;
- excludes seats held by passengers outside the requested party;
- obeys exit-row and child seating restrictions;
- includes the sum of the extra seat prices; and
- is ordered after any cheaper valid block.

Seats already held by a requested passenger may be included in a result.

A block has this shape:

```json
{
  "seatIds": ["21A", "21B", "21C"],
  "seats": ["21A", "21B", "21C"],
  "row": 21,
  "totalPriceCents": 0,
  "priceCents": 0,
  "additionalCostCents": 0,
  "extraCostCents": 0
}
```

`seats` is an alias for `seatIds`. `priceCents`, `additionalCostCents` and `extraCostCents` are
aliases for `totalPriceCents`.

`assignSeatsForParty` accepts passenger and seat lists, assignment pairs, or a request object. A
flight id may be supplied explicitly or resolved from the passengers' booking. Supported forms
include:

```ts
assignSeatsForParty(passengerIds, seatIds)
assignSeatsForParty(flightId, passengerIds, seatIds)
assignSeatsForParty(flightId, assignments)
assignSeatsForParty(assignments)
assignSeatsForParty(request)
```

An assignment pair has `passengerId` and `seatId`. The target seats must form one valid block with
one seat for each passenger. Every target is validated before writing. If any move fails,
completed moves are rolled back and every passenger keeps the seat they had before the operation.

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
`state` is what the map shows, after the booking's own seats are applied: `available`, `booked`,
`blocked` or `occupied`.

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

### GET `/api/seats/{flightId}/party`

Find valid adjacent blocks for a travel party. Supply each passenger as a repeated `passengerId`
query parameter:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

`passengerIds` is also accepted, and a comma-separated value may be used.

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "blocks": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "seats": ["21A", "21B", "21C"],
      "row": 21,
      "totalPriceCents": 0,
      "priceCents": 0,
      "additionalCostCents": 0,
      "extraCostCents": 0
    }
  ]
}
```

`blocks` is ranked by `extraCostCents`, cheapest first. `totalPriceCents`, `priceCents` and
`additionalCostCents` contain the same value. An empty array means no valid block is currently
available.

`400 { "error": "invalid_passengers" }` when no passengers are supplied, an id is repeated, or a
passenger cannot be found.

### POST `/api/seats/{flightId}/party`

Move a party into one adjacent block. The operation applies every assignment or leaves every
passenger in their previous seat.

Request with parallel lists:

```json
{
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "seatIds": ["21A", "21B", "21C"]
}
```

Assignment pairs are also accepted:

```json
{
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ]
}
```

Response `200`:

```json
{
  "ok": true,
  "flightId": "NA214",
  "seatIds": ["21A", "21B", "21C"],
  "totalPriceCents": 0,
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
  "results": [
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
  ]
}
```

`results` is an alias for `assignments`.

Failures include `ok: false`, matching `error` and `reason` values, and a customer-readable
`message`:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not valid JSON. |
| 400 | `invalid_passengers` | Passenger ids are missing, repeated, unknown, on different bookings, or not on this flight. |
| 422 | `invalid_seat_block` | Seat ids are missing, invalid, on different rows, cross the aisle, violate passenger restrictions, or do not match the party size. |
| 409 | `seat_unavailable` | A target is booked, blocked, or held by somebody outside the party. |
| 409 | `assignment_failed` | The complete party move could not be applied. |

An `assignment_failed` response may include the failed single-seat result as `cause`.

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

Move one passenger to one seat. One passenger is moved for each call. Use
`POST /api/seats/{flightId}/party` when a whole party must move together.

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
