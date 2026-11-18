# NovaAir API

Route handlers are thin HTTP shells over the primitives and composed capabilities in
`lib/seats/index.ts`. The client calls these routes; it never reaches the store directly.

All routes are dynamic. All request bodies and responses are JSON.

## Seat domain exports

`lib/seats/index.ts` exports seven single-purpose primitives and two seat-party capability
functions.

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
| `findSeatsForParty(flightId, passengerIds)` | Find valid same-row blocks for a party, ranked by total extra cost. |
| `assignSeatsForParty(passengerIds, seatIds)` | Move the whole party into one recommended block as an all-or-none operation. |

`findSeatsForParty` returns `SeatPartyOption[]`:

```ts
interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}
```

Each option:

- has one seat for each passenger;
- is in one row and one side of the aisle;
- uses consecutive columns;
- excludes booked seats, seats held for accessible seating, and seats held by passengers outside
  the party;
- follows the passenger restrictions returned by `getPassengerRestrictions`;
- includes the sum of `calculateSeatPrice` for every seat; and
- is sorted by total extra cost, with the cheapest option first.

A seat the party already holds may be included in a recommendation. Passengers must be on the same
booking and flight. A child cannot be offered an exit-row seat, and a child who must sit with an
adult is offered a block only when the party includes an adult.

`assignSeatsForParty` accepts one seat for each passenger. The passenger and seat arrays correspond
by index. It validates that the requested block is still a valid recommendation before moving
anyone.

Success:

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

Failure:

```json
{
  "ok": false,
  "reason": "seats_unavailable",
  "message": "Those seats are no longer available together. Find another block and try again."
}
```

The apply is atomic from the caller's perspective. The whole party moves or every passenger
remains in their previous seat.

`tests/seat-party.test.ts` holds the capability to these adjacency, availability, restriction,
price-ranking, and atomicity rules.

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

Find valid seat blocks for a travel party. Pass passenger ids as repeated `passengerId` query
parameters:

```text
/api/seats/NA214/party?passengerId=PAX-1&passengerId=PAX-2&passengerId=PAX-3
```

Comma-separated values and the plural `passengerIds` parameter are also accepted:

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

Options are ranked by `extraCostCents`, with the cheapest first. An empty `options` array means
there is no valid block for that party.

| Status | `error` | When |
| --- | --- | --- |
| 400 | `passenger_ids_required` | No passenger ids were provided. |
| 404 | `flight_not_found` | The flight does not exist. |

### POST `/api/seats/{flightId}/party`

Apply one recommended block to the whole party. The passenger and seat arrays correspond by index.

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

The route checks the recommendation again immediately before applying it. If a seat is no longer
available or the block is no longer valid, nobody in the party is moved.

Failures carry an error and a message written for a customer to read:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The request body is not valid JSON. |
| 400 | `passenger_ids_and_seat_ids_required` | The arrays are missing, empty, or have different lengths. |
| 400 | `invalid_party` | The party is invalid or its passengers are not on the same booking. |
| 400 | `invalid_seats` | A seat id is invalid or appears more than once. |
| 404 | `flight_not_found` | The flight does not exist. |
| 404 | `passenger_not_found` | One or more passengers do not exist. |
| 409 | `seats_unavailable` | The requested seats are not a current valid recommendation. |
| 409 | `seat_booked` | A seat was taken while the party was being moved. |
| 409 | `seat_blocked` | A seat is held for accessible seating. |
| 409 | `assignment_cycle` | The requested moves cannot be safely ordered. |
| 409 | `atomic_assignment_unavailable` | The party cannot be moved without risking a partial assignment. |
| 422 | `exit_row_child` | A child would be assigned to an exit row. |

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

Move one passenger to one seat. This remains the single-passenger assignment route. Use
`POST /api/seats/{flightId}/party` to apply a recommended block to a whole party.

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
