# NovaAir analytics contract

NovaAir sends events to PostHog. This file is the contract. Event names and property names are
stable; a rename is a breaking change for anything that reads them.

The typed form of this file is `lib/analytics/events.ts`. `tests/analytics.test.ts` checks that the
two agree on the event list.

## How it starts

`instrumentation-client.ts` starts `posthog-js`. Next.js runs that file on the client before the
app hydrates, which is the pattern the PostHog wizard produces for Next.js 15.3 and later, so the
first pageview and the start of the session recording are not lost.

It starts only when `NEXT_PUBLIC_POSTHOG_KEY` is set. With no key nothing is sent and no request
leaves the browser, so `npm run dev` and the end-to-end run are silent by default.

Settings:

| Setting | Value |
| --- | --- |
| `api_host` | `NEXT_PUBLIC_POSTHOG_HOST`, or `https://us.i.posthog.com` |
| `defaults` | `'2026-05-30'` |
| Session recording | on |
| Autocapture | on |
| Pageviews and page leaves | on, through `defaults` |

`lib/analytics/client.ts` holds `capture`, which sends the explicit events below. It is a no-op
when no key is set.

Autocapture gives the raw click stream. The events below give the meaning behind it.

## Events

### `seat_map_opened`

Sent once, when the seat map mounts.

| Property | Type | Meaning |
| --- | --- | --- |
| `reservation_code` | string | The confirmation code, for example `NVA7K2`. |
| `flight_id` | string | The flight, for example `NA214`. |
| `party_size` | number | How many passengers are on the booking. |
| `current_seats` | string[] | The seat of each passenger, in party order, as the map opened. |

### `passenger_selected`

Sent when a passenger becomes the one a seat click will move. That happens when the customer picks
a passenger, and again when the map moves on to the next passenger after a seat is taken.

| Property | Type | Meaning |
| --- | --- | --- |
| `passenger_index` | number | Place in the party, counting from zero. |
| `passenger_type` | `"adult"` \| `"child"` | Which kind of passenger. |

### `seat_hovered`

Sent when the pointer or the keyboard focus lands on a seat. Throttled to one event every 400 ms
(`SEAT_HOVER_THROTTLE_MS`), so a sweep across the map does not flood the stream. This is the event
that shows scanning behaviour.

| Property | Type | Meaning |
| --- | --- | --- |
| `seat` | string | Seat id, for example `21A`. |
| `row` | number | Row number. |
| `column` | string | `A` to `F`. |
| `state` | `"available"` \| `"booked"` \| `"blocked"` \| `"occupied"` | The state of the seat when it was hovered. |

### `seat_selected`

Sent when a seat is taken for the selected passenger. It is not sent for a click that is refused;
see `seat_selection_rejected`.

| Property | Type | Meaning |
| --- | --- | --- |
| `seat` | string | Seat id. |
| `row` | number | Row number. |
| `column` | string | `A` to `F`. |
| `passenger_index` | number | Which passenger took it. |
| `state` | string | The state of the seat before it was taken. Always `available`. |
| `price` | number | The seat fee in cents. `0` for a standard seat. |

### `seat_selection_rejected`

Sent when a seat click cannot go through. This is the backtracking signal.

| Property | Type | Meaning |
| --- | --- | --- |
| `seat` | string | Seat id. |
| `reason` | string | Why it was refused. |

`reason` is one of:

| Reason | Meaning |
| --- | --- |
| `seat_booked` | Another customer already has the seat. |
| `seat_blocked` | The seat is held for accessible seating. |
| `seat_taken_by_party` | Another passenger on this booking has the seat. |
| `exit_row_child` | The passenger is a child and the seat is in an exit row. |

### `seat_assignment_confirmed`

Sent when Confirm seats saves every change. It is the end of the task, and it carries the cost of
getting there.

| Property | Type | Meaning |
| --- | --- | --- |
| `seats` | string[] | The final seat of each passenger, in party order. |
| `party_size` | number | How many passengers are on the booking. |
| `same_row` | boolean | True when every seat is in one row. |
| `contiguous` | boolean | True when the seats form one unbroken block on one side of the aisle. `21A 21B 21C` is true. `22B 22C 22D` is false, because the aisle sits between C and D. |
| `additional_cost` | number | The total seat fees in cents. |
| `interactions` | number | Seat clicks, refused clicks and passenger picks, counted from when the map opened. |
| `elapsed_ms` | number | Milliseconds from the map opening to the save. |

`contiguous` and `same_row` come from `seatsAreContiguous` and `seatsAreSameRow` in
`lib/analytics/events.ts`. They describe the outcome. They do not help a customer reach it.

### `help_article_viewed`

Sent once for each help article a reader opens.

| Property | Type | Meaning |
| --- | --- | --- |
| `slug` | string | The article, for example `traveling-with-children`. |

## What a hand-worked session looks like

A customer with a party of three, starting on 12A, 18C and 24F:

```
seat_map_opened          { party_size: 3, current_seats: ["12A","18C","24F"] }
seat_hovered             { seat: "14A", state: "booked" }
seat_hovered             { seat: "17C", state: "booked" }
seat_selection_rejected  { seat: "16D", reason: "exit_row_child" }
seat_hovered             { seat: "21A", state: "available" }
seat_selected            { seat: "21A", passenger_index: 0, price: 0 }
passenger_selected       { passenger_index: 1, passenger_type: "child" }
seat_selected            { seat: "21B", passenger_index: 1, price: 0 }
passenger_selected       { passenger_index: 2, passenger_type: "child" }
seat_selected            { seat: "21C", passenger_index: 2, price: 0 }
seat_assignment_confirmed{ seats: ["21A","21B","21C"], same_row: true, contiguous: true,
                           additional_cost: 0, interactions: 14, elapsed_ms: 96000 }
```

The shape is always the same: scan, compare, back off, assign one passenger, repeat, confirm.
`interactions` counts the cost of it.

## Producing sessions

The end-to-end helpers in `e2e/helpers.ts` are the steps of that session. To record real sessions
from a running site, set `NEXT_PUBLIC_POSTHOG_KEY` on the site, point `NOVAAIR_BASE_URL` at it and
run `npm run e2e`. The helpers are separate from the specs so a session generator can compose them
into different paths without repeating the selectors.
