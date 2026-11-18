# NovaAir API

Every route handler is a thin shell over a capability in `lib/seats/index.ts`. The client calls
these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## The seat module

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

### Seat-party capability

| Capability | Job |
| --- | --- |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank valid adjacent-seat blocks for a party. |
| `assignSeatsForParty(...)` | Move a whole party into one adjacent-seat block in one operation. |

`findSeatsForParty` returns blocks in this shape:

```json
{
  "seatIds": ["21A", "21B", "21C"],
  "totalPriceCents": 0
}
```

Every returned block:

- contains one seat for each passenger;
- uses consecutive seats in one row on one side of the aisle;
- contains only available seats, never booked or blocked seats;
- excludes seats held by a passenger outside the party;
- follows the restrictions returned by `getPassengerRestrictions`;
- excludes exit rows when any passenger in the party cannot use one;
- includes an adult from the party when a passenger must sit with an adult; and
- carries the sum of `calculateSeatPrice` for its seats.

Blocks are ordered from lowest to highest `totalPriceCents`, then by their first seat id.

`assignSeatsForParty` supports these forms:

```ts
assignSeatsForParty(reservationCode, seatIds)
assignSeatsForParty(reservationCode, assignments)
assignSeatsForParty(flightId, passengerIds, seatIds)
```

An assignment has a passenger and a seat:

```json
{ "passengerId": "PAX-1", "seatId": "21A" }
```

The reservation and seat-list form associates seats with passengers in reservation order. The
explicit assignment form associates each passenger with the stated seat.

The apply validates the whole block again before moving anyone. It succeeds only when every
passenger can be assigned. If any assignment fails, completed moves are restored so every
passenger retains the seat they held before the operation.

Success returns:

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

Failures return:

```json
{
  "ok": false,
  "reason": "seats_not_together",
  "message": "Choose consecutive seats in one row on the same side of the aisle."
}
```

`tests/seat-party.test.ts` holds the composed capability to its invariants: contiguous same-row
seats, no booked or blocked seats, the exit-row and child rules, ranking by extra cost, and one
atomic apply.

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

### GET `/api/seats/{flightId}/party?reservationCode=NVA7K2`

Find valid adjacent-seat blocks for every passenger on the reservation. The reservation must be
for the flight in the path.

Response `200`:

```json
{
  "flightId": "NA214",
  "reservationCode": "NVA7K2",
  "partySize": 3,
  "blocks": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "totalPriceCents": 0
    },
    {
      "seatIds": ["1A", "1B", "1C"],
      "totalPriceCents": 13500
    }
  ]
}
```

The blocks follow the same availability, adjacency, passenger-rule and price-ordering guarantees
as `findSeatsForParty`.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `reservation_code_required` | The query has no reservation code. |
| 404 | `reservation_not_found` | The booking does not exist or is for another flight. |

An empty `blocks` array means there is no valid adjacent block for the whole party.

### POST `/api/seats/{flightId}/party`

Move every passenger on a reservation into one adjacent-seat block. Seats are associated with
passengers in reservation order.

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
  "totalPriceCents": 0
}
```

The route validates availability and passenger restrictions again when the customer confirms. The
whole party moves or none of it does.

Failures carry an error and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not valid JSON. |
| 400 | `invalid_request` | The body is not a JSON object. |
| 400 | `reservation_code_required` | The body has no reservation code. |
| 400 | `seat_ids_required` | The body does not contain a non-empty string seat id list. |
| 404 | `reservation_not_found` | The booking does not exist or is for another flight. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | A passenger does not exist. |
| 404 | `seat_not_found` | A seat is not on the aircraft. |
| 409 | `seat_booked` | A requested seat is booked or held by another passenger. |
| 409 | `seat_blocked` | A requested seat is held for accessible seating. |
| 409 | `assignment_failed` | The whole party could not be saved. |
| 422 | `party_size_mismatch` | There is not one seat for every passenger on the booking. |
| 422 | `invalid_party_assignments` | Passengers or seats are duplicated or missing. |
| 422 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |
| 422 | `exit_row_child` | A passenger who cannot use an exit row was assigned one. |
| 422 | `child_requires_adult` | A passenger who must sit with an adult has no adult in the party. |

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

Move one passenger to one seat. One passenger for each call. Party seat suggestions and atomic
party moves use `/api/seats/{flightId}/party` instead.

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
