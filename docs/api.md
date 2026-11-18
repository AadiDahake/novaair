# NovaAir API

Every route handler is a thin shell over an operation in `lib/seats/index.ts`. The client calls
these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat module contract

`lib/seats/index.ts` exports seven single-purpose primitives and two deliberate seat-party
compositions.

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
| `findSeatsForParty(flightId, passengerIds)` | Find and rank valid adjacent blocks for the given passengers. |
| `findSeatsForParty(reservationCode)` | Find and rank valid adjacent blocks for every passenger on a reservation. |
| `findSeatsForParty(flightId, reservationCode)` | Find and rank valid adjacent blocks after confirming the reservation belongs to the flight. |
| `assignSeatsForParty(reservationCode, assignments)` | Apply one passenger-to-seat assignment for every passenger on a reservation. |
| `assignSeatsForParty(flightId, reservationCode, assignments)` | Apply the party assignments after confirming the reservation belongs to the flight. |

A seat-party option has this shape:

```json
{
  "row": 21,
  "seatIds": ["21A", "21B", "21C"],
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ],
  "totalPriceCents": 0
}
```

`findSeatsForParty` returns only blocks that:

- contain one seat for every requested passenger;
- are in one row and consecutive by column;
- stay on one side of the aisle, either A, B and C or D, E and F;
- exclude booked seats, seats held for accessible seating, and seats held by a passenger outside
  the party;
- respect each result from `getPassengerRestrictions`, including exit-row and adult-accompaniment
  rules; and
- carry the sum of `calculateSeatPrice` for the block.

Options are ordered by `totalPriceCents`, cheapest first. Equal-price options are ordered by row
and then seat id.

`assignSeatsForParty` validates the whole request before moving a passenger. It requires one unique
passenger-to-seat assignment for every passenger on the reservation, and the selected seats must
form a valid adjacent block. If any move fails, completed moves are restored so every passenger
retains the seat held before the attempt.

The single-passenger `assignSeat` primitive remains available for manual seat selection.

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

### GET `/api/seats/{flightId}/party?reservationCode={reservationCode}`

Find adjacent seats for every passenger on the reservation. Recommendations are valid for the
passenger rules and current seat map, and are ranked by total extra cost.

Response `200`:

```json
{
  "flightId": "NA214",
  "reservationCode": "NVA7K2",
  "options": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "assignments": [
        { "passengerId": "PAX-1", "seatId": "21A" },
        { "passengerId": "PAX-2", "seatId": "21B" },
        { "passengerId": "PAX-3", "seatId": "21C" }
      ],
      "totalPriceCents": 0
    }
  ]
}
```

An empty `options` array means no valid adjacent block is currently available. Successful
responses include `Cache-Control: no-store` because availability can change at any time.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `reservation_code_required` | The query has no reservation code. |
| 404 | `reservation_not_found` | The reservation does not exist or belongs to another flight. |

### POST `/api/seats/{flightId}/party`

Apply one recommended passenger-to-seat combination to the whole reservation party.

Request:

```json
{
  "reservationCode": "NVA7K2",
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
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ]
}
```

The route requires one unique seat for every passenger on the reservation. All seats must be
consecutive in one row and on one side of the aisle. The passenger restrictions and current seat
availability are checked again when the request is applied.

Failures carry a reason and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not a JSON object. |
| 400 | `reservation_code_required` | The body has no reservation code. |
| 400 | `assignments_required` | The body has no non-empty assignments array. |
| 400 | `invalid_assignments` | An assignment is missing a passenger or seat id. |
| 404 | `reservation_not_found` | The reservation does not exist or belongs to another flight. |
| 404 | `passenger_not_found` | An assigned passenger does not exist. |
| 404 | `seat_not_found` | An assigned seat is not on the aircraft. |
| 409 | `seat_booked` | A selected seat is booked or held by another passenger. |
| 409 | `seat_blocked` | A selected seat is held for accessible seating. |
| 409 | `assignment_failed` | The party move could not be completed. |
| 422 | `exit_row_child` | A child was assigned to an exit-row seat. |
| 422 | `invalid_party` | The request does not assign every passenger or cannot satisfy the adult-accompaniment rule. |
| 422 | `invalid_assignment` | Passenger or seat assignments are duplicated or do not belong to the reservation. |
| 422 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |

The apply is all-or-nothing from the customer's perspective. If a write fails after another
passenger has moved, completed moves are restored before the error response is returned.

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
`POST /api/seats/{flightId}/party` when applying a valid adjacent block to the whole reservation
party.

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
  service role, on the server only. A single-passenger assignment goes through the `assign_seat`
  SQL function, so it is one statement and cannot race.
- `MemorySeatRepository` holds the same data in the process, seeded by the same seed function.

The seat-party compositions use the public seat primitives rather than reaching past them into
the repository. A failed party apply restores completed passenger moves before returning a
failure.

The store is picked in `lib/repo/index.ts`: Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are both set, otherwise memory.
