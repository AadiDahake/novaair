# NovaAir API

Every route handler is a thin shell over an operation exported from `lib/seats/index.ts`. The
client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat domain exports

`lib/seats/index.ts` exports seven single-purpose primitives and two seat-party compositions.

| Export | Job |
| --- | --- |
| `getSeatMap(flightId)` | The whole cabin: every row, every seat, and its state now. |
| `getAvailableSeats(flightId)` | The ids of every seat a passenger could take now. |
| `getPassengerRestrictions(passengerId)` | What one passenger may and may not do. |
| `calculateSeatPrice(flightId, seatId)` | What one seat costs, in cents. |
| `assignSeat(passengerId, seatId)` | Move one passenger to one seat. Atomic and idempotent. |
| `getReservation(code, lastName)` | Find one booking. |
| `getReservationByCode(code)` | Read a booking when the code is already trusted. |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank available adjacent seat blocks for a party. |
| `assignSeatsForParty(flightId, assignments)` | Move a party into an adjacent block as one atomic operation. |

The seat-party operations compose the existing primitives. They do not read or write around the
seat domain rules.

### `findSeatsForParty`

Canonical call:

```ts
findSeatsForParty(flightId, passengerIds)
```

An object form is also accepted:

```ts
findSeatsForParty({ flightId, passengerIds })
```

The result is an array of blocks:

```json
[
  {
    "row": 21,
    "seatIds": ["21A", "21B", "21C"],
    "extraCostCents": 0,
    "totalPriceCents": 0
  },
  {
    "row": 2,
    "seatIds": ["2A", "2B", "2C"],
    "extraCostCents": 13500,
    "totalPriceCents": 13500
  }
]
```

Each block keeps all of these rules true:

- `row` is the row shared by every seat in the block.
- Every seat is in the same row.
- Columns are consecutive.
- A block stays on one side of the aisle. A, B and C form one block and D, E and F form the other.
- Every seat is available. Booked seats, blocked accessible-seating holds and seats occupied by
  passengers outside the party are excluded.
- Every passenger belongs to the same reservation and flight.
- Passenger restrictions come from `getPassengerRestrictions`.
- A child is never offered an exit-row block.
- If a passenger must sit with an adult, the searched party must include an adult from the same
  reservation.
- `extraCostCents` is the sum of `calculateSeatPrice` for every seat in the block.
- `totalPriceCents` has the same value as `extraCostCents`.
- Results are ordered from lowest to highest `extraCostCents`. Seat ids provide a stable tie
  breaker when two blocks cost the same.

Invalid, duplicate, unrelated or restriction-incompatible passenger lists return no blocks.

### `assignSeatsForParty`

Canonical call:

```ts
assignSeatsForParty(flightId, assignments)
```

Each assignment pairs one passenger with one seat:

```json
[
  { "passengerId": "PAX-1", "seatId": "21A" },
  { "passengerId": "PAX-2", "seatId": "21B" },
  { "passengerId": "PAX-3", "seatId": "21C" }
]
```

The operation also accepts parallel passenger and seat arrays:

```ts
assignSeatsForParty(flightId, passengerIds, seatIds)
```

When the flight is implied by the passengers' reservation, both forms may omit `flightId`.

Success:

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
  "totalPriceCents": 0
}
```

Failure:

```json
{
  "ok": false,
  "reason": "seat_booked",
  "message": "Seat 21B was taken while you were choosing. Please pick another block."
}
```

Before moving anyone, the operation validates that:

- Every passenger and seat is present and unique.
- Every passenger is on the same reservation and flight.
- The selected seats are consecutive, in one row and on one side of the aisle.
- No selected seat is booked, blocked or held by someone outside the party.
- Exit-row and adult-accompaniment restrictions still hold.

The apply is atomic for the party. Either every requested passenger reaches the requested block or
none of them does. If validation or any assignment fails, every passenger retains the seat they
held before the party operation began. A seat swap that cannot be ordered safely fails without
partially applying the move.

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

### GET `/api/seats/{flightId}/party`

Find ranked adjacent blocks for a party. Pass passenger ids by repeating `passengerId`:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

The route also accepts repeated or comma-separated `passengerIds` values.

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "blocks": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "extraCostCents": 0,
      "totalPriceCents": 0
    },
    {
      "row": 2,
      "seatIds": ["2A", "2B", "2C"],
      "extraCostCents": 13500,
      "totalPriceCents": 13500
    }
  ]
}
```

The blocks follow the contiguity, availability, passenger restriction and price ranking rules
described for `findSeatsForParty`. An empty `blocks` array means no valid block is currently
available.

`400 { "error": "passenger_ids_required" }` when no passenger ids are supplied.

### POST `/api/seats/{flightId}/party`

Atomically assign an adjacent block to the party.

Request:

```json
{
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ]
}
```

Parallel arrays are also accepted:

```json
{
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
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
  "totalPriceCents": 0
}
```

Failures include `ok`, `error`, `reason` and a customer-readable message:

```json
{
  "ok": false,
  "error": "seats_not_together",
  "reason": "seats_not_together",
  "message": "Choose consecutive seats in one row on the same side of the aisle."
}
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not valid JSON. |
| 400 | `assignments_required` | No complete assignments were supplied. |
| 400 | `passengerId_and_seatId_required` | An assignment is missing a valid passenger or seat id. |
| 400 | `duplicate_passenger` | A passenger appears more than once. |
| 400 | `duplicate_seat` | A seat appears more than once. |
| 404 | `passenger_not_found` | A passenger does not exist. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 404 | `flight_not_found` | The flight does not exist. |
| 409 | `seat_booked` | A selected seat is booked or held outside the party. |
| 409 | `seat_blocked` | A selected seat is held for accessible seating. |
| 409 | `party_move_conflict` | The requested party move cannot be ordered safely. |
| 422 | `seats_not_together` | The seats are not one consecutive same-side block. |
| 422 | `exit_row_child` | A child was assigned an exit-row seat. |
| 422 | `adult_required` | A passenger who must sit with an adult has no adult in the party. |
| 422 | `flight_mismatch` | The party is not booked on the route flight. |
| 422 | `passengers_not_in_same_party` | The passengers are not on the same booking. |

Any failure leaves all passengers in their previous seats.

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

Move one passenger to one seat. Use `/api/seats/{flightId}/party` when an adjacent block must be
applied to several passengers atomically.

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
