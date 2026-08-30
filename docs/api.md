# NovaAir API

Every route handler is a thin shell over a primitive or composition in `lib/seats/index.ts`. The
client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat operations

`lib/seats/index.ts` exports seven single-purpose primitives and two seat-party compositions.

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
| `findSeatsForParty(flightId, passengerIds)` | Find and rank valid adjacent-seat blocks for a party. |
| `assignSeatsForParty(flightId, assignments)` | Move a party to one adjacent-seat block in one atomic operation. |

`findSeatsForParty` composes the seat map, availability, passenger restrictions and seat prices.
Every option:

- contains one seat for each passenger;
- is in one row with consecutive columns on one side of the aisle;
- excludes booked seats, accessibility-held seats and seats held by passengers outside the party;
- may include seats already held by passengers in the party;
- keeps children out of exit rows;
- includes an adult when a passenger must sit with an adult; and
- carries the total extra cost and is ordered from lowest to highest cost.

It returns an array of options:

```json
[
  {
    "row": 21,
    "seatIds": ["21A", "21B", "21C"],
    "seats": ["21A", "21B", "21C"],
    "assignments": [
      { "passengerId": "PAX-1", "seatId": "21A" },
      { "passengerId": "PAX-2", "seatId": "21B" },
      { "passengerId": "PAX-3", "seatId": "21C" }
    ],
    "priceCents": 0,
    "totalPriceCents": 0
  }
]
```

`seatIds` and `seats` contain the same ordered seat ids. `priceCents` and `totalPriceCents` contain
the same total extra cost in cents.

`assignSeatsForParty` validates the whole assignment before moving anyone. It rejects seats that
are not one contiguous block, rechecks availability and passenger restrictions, then orders the
moves so a passenger leaves a seat before another party member takes it. If any move fails,
completed moves are rolled back and every passenger keeps their previous seat.

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

Find adjacent seats for a party. Pass each passenger with a repeated `passengerId` query
parameter:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

The route also accepts repeated `passengerIds` parameters and comma-separated ids.

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "options": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "seats": ["21A", "21B", "21C"],
      "assignments": [
        { "passengerId": "PAX-1", "seatId": "21A" },
        { "passengerId": "PAX-2", "seatId": "21B" },
        { "passengerId": "PAX-3", "seatId": "21C" }
      ],
      "priceCents": 0,
      "totalPriceCents": 0
    }
  ]
}
```

Options are ordered by lowest total extra cost, then row and seat ids. An empty `options` array
means no valid block is currently available. Searching never changes any seat.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passenger_ids_required` | No passenger id was supplied. |
| 400 | `invalid_passenger_ids` | A passenger id was supplied more than once. |

### POST `/api/seats/{flightId}/party`

Apply one option returned by the party search. The request must contain one different seat for each
passenger:

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
  "seatIds": ["21A", "21B", "21C"],
  "seats": ["21A", "21B", "21C"],
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ],
  "priceCents": 0,
  "totalPriceCents": 0
}
```

Failures carry `error`, `reason` and a message written for a customer to read. No family seat is
changed when the apply fails.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not valid JSON. |
| 400 | `assignments_required` | The body has no assignments. |
| 400 | `invalid_assignments` | A field is missing, a passenger is repeated or a seat is repeated. |
| 404 | `flight_not_found` | No such flight. |
| 404 | `passenger_not_found` | One of the passengers does not exist. |
| 404 | `seat_not_found` | One of the seats is not on the aircraft. |
| 409 | `seat_booked` | A booked seat or a seat held outside the party was requested. |
| 409 | `seat_blocked` | A seat is held for accessible seating. |
| 409 | `current_seat_required` | A passenger's current seat could not be verified. |
| 409 | `seat_swap_not_supported` | The requested moves form a swap that cannot be ordered safely. |
| 422 | `adult_required` | A child who must sit with an adult has no adult in the party. |
| 422 | `exit_row_child` | A child was assigned to an exit row. |
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

Move one passenger to one seat. This route remains available for manual individual seat changes.

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
