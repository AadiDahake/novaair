# NovaAir API

Every route handler is a thin shell over a primitive or seat-party composition in
`lib/seats/index.ts`. The client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## The seat module exports

| Export | Job |
| --- | --- |
| `getSeatMap(flightId)` | The whole cabin: every row, every seat, and its state now. |
| `getAvailableSeats(flightId)` | The ids of every seat a passenger could take now. |
| `getPassengerRestrictions(passengerId)` | What one passenger may and may not do. |
| `calculateSeatPrice(flightId, seatId)` | What one seat costs, in cents. |
| `assignSeat(passengerId, seatId)` | Move one passenger to one seat. Atomic and idempotent. |
| `getReservation(code, lastName)` | Find one booking. |
| `getReservationByCode(code)` | Read a booking when the code is already trusted. |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank contiguous blocks for a party. |
| `assignSeatsForParty(passengerIds, seatIds)` | Move a party into one contiguous block in one atomic apply. |

The first seven exports are the single-purpose seat primitives. The two seat-party exports compose
those primitives to search for adjacent seats and apply a group change.

`findSeatsForParty` offers only consecutive seats in one row on one side of the aisle. A, B and C
form one block, and D, E and F form the other. A block never crosses the aisle. Booked seats, seats
held for accessible seating, and seats occupied by passengers outside the party are excluded. A
party's current seats may be included.

The search reads each passenger's restrictions. Children are not offered exit rows, and a child
who must sit with an adult is offered a block only when an adult from the party is included. Each
option includes the sum of `calculateSeatPrice` for its seats, and options are ordered from lowest
to highest total extra cost.

`assignSeatsForParty(passengerIds, seatIds)` assigns each passenger to the seat at the same array
index and determines the flight from the passengers' reservation. Server callers that already know
the flight may instead use `assignSeatsForParty(flightId, assignments)` or
`assignSeatsForParty(flightId, passengerIds, seatIds)`.

`assignSeatsForParty` validates the complete block before writing any assignment. The seats must
still be available to the party and all passenger restrictions must still hold. If any write
fails, completed writes are reversed so every passenger keeps the seat they had before the apply.

`AGENTS.md`, under "Adding seat-party capabilities", describes these invariants, and
`tests/seat-party.test.ts` enforces them.

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

### GET `/api/seats/{flightId}/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3`

Find adjacent seats for the specified passengers. `passengerId` may be repeated, as above.
A comma-separated `passengerIds` query value is also accepted.

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "options": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "extraCostCents": 0,
      "totalPriceCents": 0
    },
    {
      "row": 1,
      "seatIds": ["1A", "1B", "1C"],
      "extraCostCents": 13500,
      "totalPriceCents": 13500
    }
  ]
}
```

Each option has exactly one seat for each requested passenger. The seats are consecutive, in the
same row, and on the same side of the aisle. Options contain only seats available to the party,
follow passenger restrictions, and are ordered from lowest to highest `extraCostCents`.
`totalPriceCents` is the same total and is included for clients that present the complete party
price.

An empty `options` array means no valid adjacent block is currently available for that party.

`400 { "error": "passengerIds_required" }` when no passenger is supplied.

### POST `/api/seats/{flightId}/party`

Move all specified passengers into one adjacent block. Passenger and seat order determines which
passenger receives each seat.

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

The full request is validated before the first passenger moves. Assignments are ordered so a
passenger leaves a party-held seat before another passenger moves into it. If any assignment
fails, completed assignments are reversed before the failure is returned.

Failures carry an `error`, a `reason`, and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not JSON. |
| 400 | `assignments_required` | The body does not contain valid assignments. |
| 400 | `duplicate_passenger` | A passenger appears more than once. |
| 400 | `duplicate_seat` | A seat appears more than once. |
| 404 | `flight_not_found` | No such flight. |
| 404 | `passenger_not_found` | No such passenger. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 409 | `seat_booked` | A seat is booked or occupied outside the party. |
| 409 | `seat_blocked` | A seat is held for accessible seating. |
| 409 | `assignment_cycle` | The requested party-held seats cannot be moved safely. |
| 422 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |
| 422 | `adult_required` | A child who must sit with an adult has no adult in the party. |
| 422 | `exit_row_child` | A child was assigned an exit-row seat. |

A failed party apply leaves every passenger on their previous seat.

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

Move one passenger to one seat. One passenger for each call. Use
`POST /api/seats/{flightId}/party` when the full party must move together.

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
