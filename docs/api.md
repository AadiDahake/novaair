# NovaAir API

Route handlers are thin HTTP shells over the primitives and seat-party capability in
`lib/seats/index.ts`. The client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat exports

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

| Export | Job |
| --- | --- |
| `findSeatsForParty(flightId, passengerIds)` | Find and rank available adjacent blocks for passengers on one booking. |
| `assignSeatsForParty(passengerIds, seatIds)` | Move every requested passenger to one adjacent block in one atomic apply. |

`findSeatsForParty` composes the seat map, availability, passenger restrictions and prices. Every
option:

- contains one seat for each requested passenger;
- is in one row and uses consecutive columns on one side of the aisle;
- excludes booked seats and seats held for accessible seating;
- excludes seats held by passengers outside the requested party;
- follows child, accompanying-adult and exit-row restrictions; and
- includes the total extra cost of the block.

The results are ordered from lowest to highest extra cost, then by row and seat id. Seats A, B and
C form one side of the aisle. Seats D, E and F form the other. A block never crosses between C and
D.

Seats already held by a requested passenger may appear in an option. All passenger ids must be
unique, belong to the same reservation and be on the requested flight. Invalid parties return no
options.

`assignSeatsForParty` requires one seat id for every passenger id. Passenger and seat positions
correspond, so the first passenger is assigned the first seat, the second passenger the second
seat, and so on. It validates the complete block before moving anyone. If any seat cannot be
assigned, every passenger remains in their previous seat.

The capability contract is enforced by `tests/seat-party.test.ts`.

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

Find adjacent seats for a requested party. Supply passenger ids as repeated `passengerId` query
parameters:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

The route also accepts repeated `passengerIds` parameters. Each value may contain a comma-separated
list:

```text
/api/seats/NA214/party?passengerIds=PAX-1,PAX-2,PAX-3
```

Response `200`:

```json
{
  "flightId": "NA214",
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "options": [
    {
      "row": 21,
      "seatIds": ["21A", "21B", "21C"],
      "extraCostCents": 0
    },
    {
      "row": 2,
      "seatIds": ["2D", "2E", "2F"],
      "extraCostCents": 13500
    }
  ]
}
```

An empty `options` array means no valid block is available for that party. This includes parties
that do not belong to one reservation, do not belong to the requested flight or cannot satisfy the
passenger restrictions.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passengerIds_required` | No passenger id was supplied. |
| 404 | `flight_not_found` | The flight does not exist. |

### POST `/api/seats/{flightId}/party`

Apply one search result to the requested party. The passenger and seat arrays must have the same
length, and their positions determine each assignment.

Request:

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
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ]
}
```

The route searches again before applying the block. This prevents a stale result from being
confirmed after its seats are no longer available together.

Failures include a customer-readable `message` and either an `error` or `reason`:

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `passengerIds_and_seatIds_required` | The arrays are missing, empty, contain invalid values or have different lengths. |
| 400 | `party_and_seats_required` | The domain receives no complete passenger-to-seat assignment. |
| 400 | `seats_not_together` | The seats are not consecutive in one row on one side of the aisle. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | One or more passengers cannot be found. |
| 404 | `reservation_not_found` | The reservation cannot be found. |
| 404 | `seat_map_not_found` | The seat map cannot be loaded. |
| 404 | `seat_not_found` | A requested seat is not on the aircraft. |
| 409 | `seats_unavailable` | The block is not a current search result or is no longer available together. |
| 409 | `seat_booked` | A requested seat was taken before the apply completed. |
| 409 | `seat_blocked` | A requested seat is held for accessible seating. |
| 409 | `seat_swap_not_supported` | The requested moves form a swap that cannot be safely ordered. |
| 422 | `adult_required` | A child who must sit with an adult has no adult in the requested party. |
| 422 | `exit_row_child` | A requested assignment would put a child in an exit row. |

A failed apply does not leave a partial party move.

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

Move one passenger to one seat. One passenger is moved for each call. Party assignments use
`POST /api/seats/{flightId}/party` instead.

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
