# NovaAir API

Route handlers are thin shells over the primitives and party compositions in `lib/seats/index.ts`.
The client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## The primitives

| Primitive | Job |
| --- | --- |
| `getSeatMap(flightId)` | The whole cabin: every row, every seat, and its state now. |
| `getAvailableSeats(flightId)` | The ids of every seat a passenger could take now. |
| `getPassengerRestrictions(passengerId)` | What one passenger may and may not do. |
| `calculateSeatPrice(flightId, seatId)` | What one seat costs, in cents. |
| `assignSeat(passengerId, seatId)` | Move one passenger to one seat. Atomic and idempotent. |
| `getReservation(code, lastName)` | Find one booking. |
| `getReservationByCode(code)` | Read a booking when the code is already trusted. |

## Party compositions

The party compositions are separate from the seven single-purpose primitives:

- `findSeatsForParty(flightId, passengerIds)` returns qualifying blocks for one to three
  passengers on the same reservation and flight. Each block contains consecutive seats in one
  row and on one side of the aisle. Booked seats, accessible seating holds and seats held by
  passengers outside the party are excluded; seats already held by the party may be included.
  Passenger restrictions are applied, including exit-row eligibility and seating a passenger
  who needs an adult next to an adult in the party. Each block contains seat IDs, passenger
  assignments and the sum of the seat prices in cents. Blocks are ordered by combined fee,
  cheapest first.
- `assignSeatsForParty(flightId, passengerIds, seatIds)` revalidates the selected block and
  applies its assignments together. The IDs must identify a qualifying block in the order
  returned by the search. The apply is all-or-nothing: if availability or an expected
  assignment has changed, it returns a conflict and leaves the party's assignments unchanged.

`tests/seat-party.test.ts` holds these compositions to their seating and atomicity contracts.

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

Find blocks for a booking with exactly three passengers. The route resolves the booking, checks
that it belongs to the flight and derives passenger IDs on the server. `code` is also accepted
as the query parameter.

Response `200`:

```json
{
  "flightId": "NA214",
  "blocks": [
    {
      "seatIds": ["21A", "21B", "21C"],
      "seats": ["21A", "21B", "21C"],
      "assignments": [
        { "passengerId": "PAX-2", "seatId": "21A" },
        { "passengerId": "PAX-1", "seatId": "21B" },
        { "passengerId": "PAX-3", "seatId": "21C" }
      ],
      "totalPriceCents": 0,
      "totalCostCents": 0,
      "priceCents": 0
    }
  ]
}
```

The three price fields contain the same combined fee in cents. Results are ordered by that fee,
cheapest first. An empty `blocks` array means no qualifying block is available.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `reservation_code_required` | The code is missing or blank. |
| 404 | `reservation_not_found` | The booking was not found for this flight. |
| 422 | `party_size_not_supported` | The booking does not have exactly three passengers. |

### POST `/api/seats/{flightId}/party`

Apply a block returned by the party search. The route derives passenger IDs from the booking
rather than accepting them from the client. Seat IDs are normalized for case and outer spaces;
send them in the order returned in `seatIds`.

Request:

```json
{ "reservationCode": "NVA7K2", "seatIds": ["21A", "21B", "21C"] }
```

`code` is also accepted in place of `reservationCode`.

Response `200`:

```json
{
  "ok": true,
  "assignments": [
    { "passengerId": "PAX-2", "seatId": "21A" },
    { "passengerId": "PAX-1", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ],
  "totalPriceCents": 0
}
```

The block is revalidated before the atomic apply. If it is no longer available or the apply
cannot be committed, the route returns `409` with an `error` and a customer-readable `message`.
No party assignment is changed by a failed apply. Search again before choosing another block.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not a JSON object. |
| 400 | `reservation_code_required` | The code is missing or blank. |
| 400 | `three_seats_required` | The body does not contain three non-empty seat IDs. |
| 404 | `reservation_not_found` | The booking was not found for this flight. |
| 422 | `party_size_not_supported` | The booking does not have exactly three passengers. |
| 409 | `seat_booked` | The block no longer qualifies or the atomic commit fails. |

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

Move one passenger to one seat. One passenger for each call. This route has no bulk form; a
party apply has its own route under `/api/seats/{flightId}/`.

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

Party applies use the atomic boundary in `lib/repo/index.ts`. In memory it publishes one
conflict-checked assignment snapshot; for Supabase it calls the `commit_seat_assignments`
database function. A failed boundary does not publish a partial party assignment.

The store is picked in `lib/repo/index.ts`: Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are both set, otherwise memory.
