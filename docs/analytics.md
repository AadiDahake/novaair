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

`npm run seed:sessions` records real sessions in PostHog. A browser drives the running site with
`posthog-js` live, so PostHog assigns each session its own `$session_id`, keeps a session replay
for it, and receives the events above from the site itself. The capture API could post the same
events far faster, but it cannot produce a replay.

The plan for each session is `scripts/lib/synth-sessions.ts`. It is deterministic, so
`npm run seed:sessions -- --dry-run` prints exactly what a real run will play, and
`tests/synth-sessions.test.ts` checks it against the cabin before any browser starts. Every seat a
session touches is read out of `createSeatDefinitions`, so a change to the cabin fails that test
rather than the run.

The run plays 83 sessions:

| How many | What they do | What a miner should make of them |
| --- | --- | --- |
| 63 | A party of three moves by hand and saves seats that end up together. | The evidence. |
| 15 | Open the seat map, look around, leave without saving. | Rejected: no `seat_assignment_confirmed`. |
| 5 | Read help articles, or move one passenger. | Rejected: not a party move. |

Each session identifies as `novaair-synth-NNN`, so the seeded traffic is obvious in PostHog and
can be filtered out. The seat-map interaction counts of the 63 are chosen so the median is 14 and
the mean is 14.2.

Notes on running it:

- `NOVAAIR_BASE_URL` is the site. `NEXT_PUBLIC_POSTHOG_KEY` must be set on that site, or it records
  nothing.
- The booking goes back to its starting seats before each session, through `POST /api/demo/reset`
  on the in-memory store or a write to Postgres on Supabase. One booking is shared, so that part of
  each session is taken one at a time while the browsers run in parallel.
- `posthog-js` drops every event from anything that looks automated. It reads
  `navigator.webdriver` and looks for "headlesschrome" in the user agent and in the user agent
  client hints, so the run presents itself as an ordinary browser. Without that, PostHog accepts
  the page loads and records nothing.
- A replay needs about ten seconds of activity, so each session stays well above that and then
  waits for the last batch to reach PostHog.
- PostHog cannot delete event data. Run `--dry-run` first. If a run stops part way, run it again:
  the finished sessions are in `.posthog-seed-progress.jsonl` and are skipped.
- On a site started with `next dev`, React runs mount effects twice, so `seat_map_opened` arrives
  twice per session. The queries below count it as "more than none" and take the earliest one, so
  it makes no difference to them.

The steps of a session are the helpers in `e2e/helpers.ts`, the same ones the end-to-end test uses.
The helpers are separate from the specs so a session generator can compose them into different
paths without repeating the selectors.

## Reading the sessions back

`npm run seed:verify` runs the queries below through
`POST {POSTHOG_HOST}/api/projects/{POSTHOG_PROJECT_ID}/query/` with a personal API key, and prints
the counts and three replay links. The query text lives in `scripts/posthog-verify.mjs`; it is
repeated here because the trajectory miner runs the same queries.

Both queries name the six seat events rather than matching `seat_%`. That keeps the seeded outcome
events at the end of this file out of the trajectories.

A session is a hand-worked party move when it opened the seat map and saved seats that ended up
together, for a booking with more than one passenger:

```sql
countIf(event = 'seat_map_opened') > 0
  AND countIf(event = 'seat_assignment_confirmed'
              AND toString(properties.contiguous) = 'true'
              AND toInt(properties.party_size) > 1) > 0
```

### How many, and what it cost them

```sql
SELECT
    count()                                    AS matching_sessions,
    median(seat_map_actions)                   AS median_seat_map_actions,
    round(avg(seat_map_actions), 2)            AS mean_seat_map_actions,
    median(duration_seconds)                   AS median_duration_seconds,
    min(seat_map_actions)                      AS fewest_actions,
    max(seat_map_actions)                      AS most_actions
FROM (
    SELECT
        properties.$session_id                                                     AS session_id,
        maxIf(toInt(properties.interactions), event = 'seat_assignment_confirmed') AS seat_map_actions,
        dateDiff('second', min(timestamp), max(timestamp))                         AS duration_seconds
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY
      AND event IN ('seat_map_opened', 'passenger_selected', 'seat_hovered', 'seat_selected',
                    'seat_selection_rejected', 'seat_assignment_confirmed')
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING countIf(event = 'seat_map_opened') > 0
       AND countIf(event = 'seat_assignment_confirmed'
                   AND toString(properties.contiguous) = 'true'
                   AND toInt(properties.party_size) > 1) > 0
)
```

A seat-map action is what `seat_assignment_confirmed` calls `interactions`: seat clicks, refused
clicks and passenger picks. The site counts them, so the query does not have to.

### The trajectory of each session

```sql
SELECT
    session_id,
    distinct_id,
    opened_at,
    confirmed_at,
    dateDiff('second', opened_at, confirmed_at) AS duration_seconds,
    seat_map_actions,
    final_seats,
    arrayFilter(x -> x.1 >= opened_at AND x.1 <= confirmed_at, all_steps) AS steps
FROM (
    SELECT
        properties.$session_id                                                     AS session_id,
        any(distinct_id)                                                           AS distinct_id,
        minIf(timestamp, event = 'seat_map_opened')                                AS opened_at,
        maxIf(timestamp, event = 'seat_assignment_confirmed')                      AS confirmed_at,
        maxIf(toInt(properties.interactions), event = 'seat_assignment_confirmed') AS seat_map_actions,
        argMaxIf(toString(properties.seats), timestamp,
                 event = 'seat_assignment_confirmed')                              AS final_seats,
        arraySort(groupArray(tuple(timestamp, event, toString(properties.seat),
                                   toString(properties.reason))))                  AS all_steps
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY
      AND event IN ('seat_map_opened', 'passenger_selected', 'seat_hovered', 'seat_selected',
                    'seat_selection_rejected', 'seat_assignment_confirmed')
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING countIf(event = 'seat_map_opened') > 0
       AND countIf(event = 'seat_assignment_confirmed'
                   AND toString(properties.contiguous) = 'true'
                   AND toInt(properties.party_size) > 1) > 0
)
WHERE confirmed_at > opened_at
ORDER BY opened_at DESC
LIMIT 200
```

The whole trajectory comes back in one pass over `events`. `groupArray` collects a tuple per step,
`arraySort` orders it by the timestamp in the tuple's first position, and the outer `arrayFilter`
trims it to the window between opening the map and saving. There is no join and no window
function, so it stays inside PostHog's ten second query budget. Always pass a `name` with the
query: it is the only way to tell these apart from the product's own queries in `query_log`.

Two things the query endpoint does that will surprise you:

- **It caches against the text of the query.** Run the same query twice and the second answer can
  come from a cache filled while a seeding run was still part way through, with no sign of it in
  the numbers. Send `"refresh": "force_blocking"` when the answer has to be current.
- **`OFFSET` is rejected** for personal API keys. Page with a keyset on `timestamp` instead.

### Watching one session

The replay id is the session id:

```
{POSTHOG_HOST}/project/{POSTHOG_PROJECT_ID}/replay/{session_id}
```

`GET /api/projects/{id}/session_recordings/{session_id}/` answers whether a replay exists and how
long it is. The personal API key needs the Query Read and Session Recording Read scopes, and
nothing else.

## Seeded outcome events

`npm run seed:outcomes` sends the "thirty days after the change" numbers through PostHog's public
capture endpoint. **NovaAir never sends these events.** They are future data: the capability does
not exist yet, so no real system can produce them. Every one of them carries `seeded: true` and a
`source` naming the script that made it.

| Event | How many | Properties |
| --- | --- | --- |
| `seat_party_together_eligible` | 1,428 | `party_size` |
| `seat_party_together_used` | 917 | `party_size` |
| `seat_party_together_succeeded` | 884 | `party_size`, `interactions`, `same_row`, `contiguous` |
| `seat_support_contact` | 251 then 148 | `period`, `topic` |

The travelers who used the feature, and the ones it worked for, are prefixes of the same list of
distinct ids, so the funnel PostHog computes from them is a real funnel. `interactions` on the
successful events has a mean of 2.1, against the 14.2 the 63 recorded sessions measure.
`seat_support_contact` carries `period`, because a change of minus 41 percent needs both halves:
251 contacts in the thirty days before the change and 148 in the thirty days after.

`historical_migration` stays false. PostHog gates the true setting behind a paid plan and requires
every timestamp to be at least 48 hours old.
