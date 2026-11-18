# NovaAir API

Route handlers are thin HTTP shells over the primitives and approved seat-party compositions in
`lib/seats/index.ts`. The client calls these routes; it never reaches the store directly.

All routes are dynamic. All bodies and responses are JSON.

## Seat module exports

`lib/seats/index.ts` exports seven single-purpose primitives and two approved seat-party
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
| `findSeatsForParty(flightId, passengerIds)` | Find and rank adjacent blocks for a booking party. |
| `assignSeatsForParty(passengerIds, seatIds)` | Assign one validated block to the whole party atomically. |

`findSeatsForParty` returns `SeatPartyOption[]`:

```ts
interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}
```

Each option contains one seat per passenger. Every block is in one row, uses consecutive columns
on one side of the aisle, and excludes booked seats, seats held for accessible seating, and seats
held by passengers outside the party. Seats already held by members of the party may be included.

The search reads passenger rules through `getPassengerRestrictions`. Children are not offered exit
row seats, and a passenger who must sit with an adult is not offered a block unless an adult from
the same party is included. Options are ordered from lowest to highest `extraCostCents`, calculated
as the sum of `calculateSeatPrice` for every seat in the block.

`assignSeatsForParty` returns:

```ts
type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: { passengerId: string; seatId: string }[]
    }
  | {
      ok: false
      reason: string
      message: string
    }
```

The order of `seatIds` corresponds to the order of `passengerIds`. The composition validates the
whole block before moving anyone. If a move cannot be completed, it restores completed moves so
every passenger keeps the seat they had before the call.

`AGENTS.md`, under "Adding seat-party capabilities", defines these invariants.
`tests/seat-party.test.ts` enforces the export contract, adjacency, aisle boundaries, availability,
passenger restrictions, pricing order and atomic failure behavior.

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

Find adjacent seats for a booking party. Supply each passenger as a repeated `passengerId` query
parameter:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

A comma-separated `passengerIds` parameter is also accepted:

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
      "row": 3,
      "seatIds": ["3D", "3E", "3F"],
      "extraCostCents": 13500
    }
  ]
}
```

Options contain one seat for every supplied passenger and are ordered from lowest to highest total
extra cost. An empty `options` array means no valid adjacent block is currently available for that
party.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passengerIds_required` | No passengers were supplied or a passenger id was repeated. |
| 404 | `flight_not_found` | No such flight. |
| 404 | `passenger_not_found` | One or more passengers do not exist. |

### POST `/api/seats/{flightId}/party`

Assign a suggested adjacent block to the whole booking party in one operation.

Request:

```json
{
  "passengerIds": ["PAX-1", "PAX-2", "PAX-3"],
  "seatIds": ["21A", "21B", "21C"]
}
```

Each array must be non-empty, the arrays must have the same length, and neither array may contain
duplicates. The order defines the assignment: `PAX-1` receives `21A`, `PAX-2` receives `21B`, and
`PAX-3` receives `21C`.

Response `200`:

```json
{
  "ok": true,
  "flightId": "NA214",
  "assignments": [
    { "passengerId": "PAX-1", "seatId": "21A" },
    { "passengerId": "PAX-2", "seatId": "21B" },
    { "passengerId": "PAX-3", "seatId": "21C" }
  ]
}
```

The route checks the current seat map and passenger restrictions again before applying the block.
The seats must still form one of the options returned by `findSeatsForParty`. If any assignment
cannot be completed, the response fails and no passenger remains moved.

Failures include a customer-readable `message`:

```json
{
  "error": "invalid_seat_block",
  "message": "Those seats are no longer available together. Find seats together again to see current options."
}
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `invalid_party_assignment` | Arrays are missing, empty, different lengths or contain duplicates. |
| 404 | `flight_not_found` | No such flight. |
| 404 | `passenger_not_found` | One or more passengers do not exist. |
| 404 | `reservation_not_found` | The booking cannot be found. |
| 409 | `passengers_not_in_same_booking` | The passengers are not all on one booking. |
| 409 | `atomic_apply_unavailable` | The party cannot be moved without risking existing assignments. |
| 409 | `seat_swap_not_supported` | The requested move requires an unsupported circular seat swap. |
| 409 | `seat_booked` | A target seat was taken while the operation was being applied. |
| 422 | `invalid_party` | The domain request does not identify one seat per unique passenger. |
| 422 | `invalid_seat_block` | The seats are not a currently valid adjacent block for this party. |

A failed apply leaves every passenger in their previous seat.

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

Move one passenger to one seat. Use one call per passenger for manual seat selection. To move an
entire booking into an adjacent block atomically, use `POST /api/seats/{flightId}/party`.

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
