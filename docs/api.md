# NovaAir API

Every route handler is a thin HTTP shell over an operation in `lib/seats/index.ts`. The client calls
these routes; it never reaches the store directly.

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
| `findSeatsForParty(flightId, passengerIds)` | Find and rank contiguous blocks for a party. |
| `assignSeatsForParty(passengerIds, seatIds)` | Move a complete party into one contiguous block as one guarded operation. |
| `assignSeatsForParty(flightId, assignments)` | Move a complete party into one contiguous block as one guarded operation. |

The seat-party compositions call the existing primitives rather than reaching past them into the
store.

`findSeatsForParty` offers blocks that:

- are in one row and use consecutive columns on one side of the aisle;
- contain no booked seat, accessibility-held seat, or seat held by somebody outside the party;
- follow the restrictions returned by `getPassengerRestrictions`;
- keep children out of exit rows;
- include an adult from the same party when a child must sit with an adult; and
- are ordered by lowest total extra cost, then row and column.

Seats the party already holds may be included in a result.

The result is an array. Each option includes its seat ids, row, summed extra cost and total price.
`extraCostCents` and `totalPriceCents` contain the same summed seat price:

```json
[
  {
    "seatIds": ["21A", "21B", "21C"],
    "row": 21,
    "extraCostCents": 0,
    "totalPriceCents": 0
  },
  {
    "seatIds": ["1A", "1B", "1C"],
    "row": 1,
    "extraCostCents": 13500,
    "totalPriceCents": 13500
  }
]
```

An invalid flight or party, or a search with no eligible block, returns an empty array from the
domain composition. The HTTP route performs request validation and returns route-specific errors
before calling it.

`assignSeatsForParty` can accept parallel passenger and seat arrays:

```json
{
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "seatIds": ["21A", "21B", "21C"]
}
```

Call this form as
`assignSeatsForParty(["PAX-1", "PAX-2", "PAX-3"], ["21A", "21B", "21C"])`.

The composition also accepts a flight id and one passenger and seat pair for every member of the
party:

```json
[
  { "passengerId": "PAX-1", "seatId": "21A" },
  { "passengerId": "PAX-2", "seatId": "21B" },
  { "passengerId": "PAX-3", "seatId": "21C" }
]
```

Call this form as `assignSeatsForParty(flightId, assignments)`.

A successful domain result includes every final assignment and the total extra cost:

```json
{
  "ok": true,
  "assignments": [
    {
      "passengerId": "PAX-1",
      "seatId": "21A",
      "previousSeatId": "12A",
      "priceCents": 0
    },
    {
      "passengerId": "PAX-2",
      "seatId": "21B",
      "previousSeatId": "18C",
      "priceCents": 0
    },
    {
      "passengerId": "PAX-3",
      "seatId": "21C",
      "previousSeatId": "24F",
      "priceCents": 0
    }
  ],
  "totalPriceCents": 0
}
```

A failed domain result has this shape:

```json
{
  "ok": false,
  "reason": "invalid_seat_block",
  "message": "Choose consecutive seats in one row on the same side of the aisle."
}
```

The possible failure reasons are:

- `flight_not_found`
- `passenger_not_found`
- `passenger_not_on_flight`
- `party_requires_adult`
- `invalid_seat_block`
- `seat_not_found`
- `seat_booked`
- `seat_blocked`
- `exit_row_child`
- `assignment_failed`

The complete block is validated before the first assignment. If a later assignment fails, completed
moves are rolled back in reverse order so the party is not left with a partial change.

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

Find adjacent seats for a party. Pass each passenger as a repeated `passengerId` query parameter:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

A comma-separated `passengerIds` parameter is also accepted.

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "options": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "row": 21,
      "extraCostCents": 0,
      "totalPriceCents": 0
    },
    {
      "seatIds": ["1A", "1B", "1C"],
      "row": 1,
      "extraCostCents": 13500,
      "totalPriceCents": 13500
    }
  ]
}
```

Options are already ordered by lowest total extra cost. An empty `options` array means no eligible
contiguous block is available for that party.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passenger_ids_required` | No passenger ids were provided. |
| 400 | `duplicate_passenger` | A passenger id appears more than once. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | A passenger does not exist. |

### POST `/api/seats/{flightId}/party`

Assign a complete party to a contiguous block. All assignments succeed or the party keeps its
previous seats.

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

Response `200`:

```json
{
  "ok": true,
  "assignments": [
    {
      "passengerId": "PAX-1",
      "seatId": "21A",
      "previousSeatId": "12A",
      "priceCents": 0
    },
    {
      "passengerId": "PAX-2",
      "seatId": "21B",
      "previousSeatId": "18C",
      "priceCents": 0
    },
    {
      "passengerId": "PAX-3",
      "seatId": "21C",
      "previousSeatId": "24F",
      "priceCents": 0
    }
  ],
  "totalPriceCents": 0
}
```

HTTP failures contain `error` and a customer-readable `message`:

```json
{
  "error": "seat_booked",
  "message": "Seat 21A is already taken. Please pick another seat."
}
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `assignments_required` | The body has no valid, non-empty assignments array. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | A passenger does not exist. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 409 | `seat_booked` | A booked seat or a seat held outside the party was requested. |
| 409 | `seat_blocked` | A seat is held for accessible seating. |
| 409 | `assignment_failed` | An assignment failed while the guarded operation was applied. |
| 422 | `passenger_not_on_flight` | The passengers are not on this flight and the same booking. |
| 422 | `party_requires_adult` | A child who must sit with an adult has no adult in the party. |
| 422 | `invalid_seat_block` | The seats are not one consecutive same-row, same-side block. |
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

Move one passenger to one seat. One passenger is moved for each call. Use
`POST /api/seats/{flightId}/party` when applying a suggested party block.

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
