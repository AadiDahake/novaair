# NovaAir API

Every route handler is a thin shell over an exported operation in `lib/seats/index.ts`. The client
calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat domain exports

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
| `findSeatsForParty(flightId, party)` | Find and rank valid adjacent blocks for a reservation party. |
| `assignSeatsForParty(flightId, assignments)` | Move explicit passenger assignments to one adjacent block in an all-or-nothing operation. |
| `assignSeatsForParty(flightId, party, seatIds)` | Move a party to an ordered adjacent block on a specified flight in an all-or-nothing operation. |
| `assignSeatsForParty(party, seatIds)` | Resolve the party's flight and move the party to an ordered adjacent block in an all-or-nothing operation. |

`findSeatsForParty` accepts a reservation code, passenger ids, or passenger records as its `party`
argument. Every passenger must belong to the same reservation and flight.

Each returned option has this shape:

```json
{
  "row": 21,
  "seatIds": ["21A", "21B", "21C"],
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ],
  "extraCostCents": 0,
  "totalPriceCents": 0
}
```

An option:

- contains one seat for every passenger;
- stays in one row and uses consecutive columns on one side of the aisle;
- contains only available seats, never booked or blocked seats;
- never includes a seat held by a passenger outside the party;
- follows the restrictions returned by `getPassengerRestrictions`;
- never places a child in an exit row;
- includes an adult from the same party when a child must sit with an adult; and
- carries the sum of `calculateSeatPrice` for all seats.

Options are ordered by `extraCostCents`, with the lowest extra cost first. `totalPriceCents` contains
the same total for route and client consumers. Row and seat ids provide a stable order when options
have the same total.

`assignSeatsForParty` supports three call forms. Callers may provide a flight id and one
`{ passengerId, seatId }` assignment for each passenger, a flight id with a party and ordered seat
ids, or a party with ordered seat ids. The party argument accepts the same reservation code,
passenger ids, or passenger records as `findSeatsForParty`. When ordered seat ids are supplied, the
passenger at each position is assigned the seat at the same position.

Every call form validates the complete block before moving anyone. The passengers must belong to
one reservation on the requested or resolved flight, each passenger and seat must appear once, and
the seats must still form a valid adjacent block. If any assignment fails, completed writes are
rolled back so every passenger keeps the seat they had before the request.

`assignSeat` remains the single-passenger operation. Callers making a grouped choice use
`assignSeatsForParty` instead of calling `assignSeat` repeatedly.

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

### GET `/api/seats/{flightId}/party?reservationCode={reservationCode}`

Find ranked adjacent-seat options for every passenger on the reservation.

Response `200`:

```json
{
  "flightId": "NA214",
  "options": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "assignments": [
        { "passengerId": "PAX-1", "seatId": "21A" },
        { "passengerId": "PAX-2", "seatId": "21B" },
        { "passengerId": "PAX-3", "seatId": "21C" }
      ],
      "extraCostCents": 0,
      "totalPriceCents": 0
    }
  ]
}
```

`options` is empty when there is no valid block for the whole party, the reservation does not
belong to the flight, or the reservation cannot be found.

A valid block contains only free, consecutive seats in one row on one side of the aisle. Results
follow all passenger restrictions and are ordered by total extra cost.

`400` when `reservationCode` is missing:

```json
{
  "error": "reservationCode_query_required",
  "message": "Enter a reservation code to find seats together."
}
```

### POST `/api/seats/{flightId}/party`

Assign a complete adjacent block to a party in one operation.

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

The route validates the whole request before applying it. The party moves together or every
passenger remains in their previous seat.

Failures carry an `error` and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `assignments_required` | The body does not contain an assignments array or the array is empty. |
| 400 | `invalid_assignments` | An assignment is missing a passenger id or seat id. |
| 400 | `duplicate_passenger` | A passenger appears more than once. |
| 400 | `duplicate_seat` | A seat appears more than once. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `party_not_found` | The passengers do not form one reservation party on this flight. |
| 404 | `passenger_not_found` | A passenger cannot be found. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 409 | `seat_booked` | A requested seat is booked or another passenger holds it. |
| 409 | `seat_blocked` | A requested seat is held for accessible seating. |
| 422 | `adult_required` | A child who must sit with an adult has no adult in the party. |
| 422 | `exit_row_child` | A passenger who cannot use an exit row was assigned there. |
| 422 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |

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

Move one passenger to one seat. Use the flight-scoped party route when moving a group together.

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
