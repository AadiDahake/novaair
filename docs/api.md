# NovaAir API

Every route handler is a thin shell over an exported operation in `lib/seats/index.ts`. The client
calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## The primitives and seat-party composition

The seven single-purpose primitives remain the base contract:

| Primitive | Job |
| --- | --- |
| `getSeatMap(flightId)` | The whole cabin: every row, every seat, and its state now. |
| `getAvailableSeats(flightId)` | The ids of every seat a passenger could take now. |
| `getPassengerRestrictions(passengerId)` | What one passenger may and may not do. |
| `calculateSeatPrice(flightId, seatId)` | What one seat costs, in cents. |
| `assignSeat(passengerId, seatId)` | Move one passenger to one seat. Atomic and idempotent. |
| `getReservation(code, lastName)` | Find one booking. |
| `getReservationByCode(code)` | Read a booking when the code is already trusted. |

Two exported operations compose those primitives for a travel party:

| Operation | Job |
| --- | --- |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank available contiguous blocks for the party. |
| `assignSeatsForParty(passengerIds, seatIds)` | Assign one selected block to the whole party in one atomic apply, inferring the flight from the passengers. |
| `assignSeatsForParty(flightId, passengerIds, seatIds)` | Assign one selected block to the whole party in one atomic apply. |
| `assignSeatsForParty(flightId, assignments)` | The equivalent assignment form using passenger and seat pairs. |

### `findSeatsForParty`

Input:

```ts
findSeatsForParty(flightId: string, passengerIds: string[])
```

Result:

```ts
interface SeatPartyOption {
  seatIds: string[]
  row: number
  extraCostCents: number
  totalPriceCents: number
}
```

The result is an array of options. Each option keeps the requested party:

- in one row;
- in consecutive columns;
- on one side of the aisle, so a block never crosses between C and D;
- out of booked seats and seats held for accessible seating;
- out of seats held by passengers outside the party;
- out of exit rows when any passenger cannot use an exit row; and
- with an adult from the same party when a passenger must sit with an adult.

Passenger rules come from `getPassengerRestrictions`. Prices come from `calculateSeatPrice`.
`row` is the row shared by every seat in the block. `extraCostCents` is the sum of the extra cost
for every seat in the block, and `totalPriceCents` carries the same total for the selected option.

Options are ordered by `extraCostCents`, lowest first. Equal-price options are ordered by row and
then starting column. An invalid party, an unknown passenger, a party too large for one side of the
aisle, or a party that cannot satisfy its restrictions produces an empty array.

Example:

```json
[
  {
    "seatIds": ["21A", "21B", "21C"],
    "row": 21,
    "extraCostCents": 0,
    "totalPriceCents": 0
  },
  {
    "seatIds": ["15D", "15E", "15F"],
    "row": 15,
    "extraCostCents": 11700,
    "totalPriceCents": 11700
  }
]
```

### `assignSeatsForParty`

All three call forms are supported:

```ts
assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
)
```

```ts
assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
)
```

```ts
assignSeatsForParty(
  flightId: string,
  assignments: Array<{ passengerId: string; seatId: string }>,
)
```

Passenger and seat positions correspond. In the array forms, the first passenger receives the
first seat. In the assignment form, each pair states the assignment directly. The two-argument
form infers the flight from the passengers, who must all belong to the same booking.

A successful result is:

```ts
{
  ok: true
  assignments: Array<{
    ok: true
    passengerId: string
    seatId: string
    previousSeatId: string | null
    priceCents: number
  }>
  totalPriceCents: number
}
```

A failure is:

```ts
{
  ok: false
  reason:
    | 'invalid_party'
    | 'invalid_block'
    | 'seats_unavailable'
    | 'passenger_not_found'
    | 'seat_not_found'
    | 'seat_booked'
    | 'seat_blocked'
    | 'exit_row_child'
  message: string
}
```

The requested seats must be one of the blocks currently returned by `findSeatsForParty` for those
passengers. The apply is all or nothing: if any assignment fails, completed moves are rolled back
and every passenger keeps the seat they had before the call.

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

Find ranked blocks of seats for a party. Pass passenger ids as repeated `passengerId` query
parameters:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

A comma-separated or JSON-array `passengerIds` parameter is also accepted.

Response `200`:

```json
{
  "flightId": "NA214",
  "options": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "row": 21,
      "extraCostCents": 0,
      "totalPriceCents": 0
    }
  ]
}
```

The options follow the contiguity, aisle, availability, passenger restriction, and price ranking
rules documented for `findSeatsForParty`.

`400 { "error": "passengerIds_required" }` when no passenger ids are supplied. A valid search with
no matching block returns `200` with an empty `options` array.

### POST `/api/seats/{flightId}/party`

Assign a selected block to the whole party. Either request shape is accepted.

Passenger and seat arrays:

```json
{
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "seatIds": ["21A", "21B", "21C"]
}
```

Assignment pairs:

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

The route validates the selected block again immediately before applying it. The whole party is
assigned or none of it is. A failure response contains an `error` reason and a customer-readable
`message`.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `party_assignments_required` | The body does not contain a supported request shape. |
| 400 | `invalid_party` | Passengers or seats are missing, duplicated, or do not pair one to one. |
| 400 | `invalid_block` | The seats are not a currently available valid block for the party. |
| 404 | `passenger_not_found` | No such passenger. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 409 | `seats_unavailable` | The requested block is no longer available. |
| 409 | `seat_booked` | Another passenger already holds a seat. |
| 409 | `seat_blocked` | A seat is held for accessible seating. |
| 422 | `exit_row_child` | A child was assigned an exit-row seat. |

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

Move one passenger to one seat. One passenger is handled by each call. Use
`POST /api/seats/{flightId}/party` to apply a valid block for a whole party atomically.

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
