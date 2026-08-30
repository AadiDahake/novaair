# Project agent memory

NovaAir is a fictional consumer airline website. It is the host product for the Patchlet demo.
`README.md` covers running and checking it. This file covers what an agent needs before it changes
anything.

## The seat-party capability

NovaAir composes its seat primitives into a deliberate seat-party capability. The seat map can find
ranked blocks of adjacent seats for an adult and all children in the booking, then move the whole
family in one atomic action. Customers can still move each passenger by hand.

The composition remains separate from the single-purpose primitives and has its own route, control,
tests and documentation. Changes to it must preserve the invariants in the next section rather than
reaching past the primitives into the store.

## Maintaining seat-party capabilities

The seat-party capability finds a block of seats for a travel party and moves the party in one
action. It composes the existing primitives rather than reaching past them into the store:
`getSeatMap`, `getAvailableSeats`, `getPassengerRestrictions`, `calculateSeatPrice`, `assignSeat`
and `getReservation`.

Where the pieces belong:

| Piece | Where |
| --- | --- |
| The search and the apply | `lib/seats/`, exported from `lib/seats/index.ts` |
| The HTTP shell over it | a route under `app/api/seats/[flightId]/` |
| The control a customer operates | the seat map, in `components/seats/` |

What it must keep true, whatever else it does:

- **Contiguous, same row.** Every block it offers sits in one row, in consecutive columns, on one
  side of the aisle. A, B and C are one block, D, E and F are the other, and two seats either side
  of the aisle are not seats together.
- **Free seats only.** Never a seat that is booked, never the seat held for accessible seating, and
  never a seat a passenger outside the party holds.
- **The passenger rules still hold.** No child in an exit row, and a passenger who must sit with an
  adult is only offered a block that also seats an adult from their own party. Read both from
  `getPassengerRestrictions` rather than restating them.
- **Ranked by extra cost.** A block carries the sum of `calculateSeatPrice` over its seats, and the
  cheapest block comes first.
- **One atomic apply.** The whole party lands or none of it does. A failed apply leaves every
  passenger on the seat they already had.

`tests/seat-party.test.ts` is the contract on all of that. It enforces every point above through
the `findSeatsForParty` and `assignSeatsForParty` exports. Keep those names: they are what the test
looks for, and an export under another name is a capability the test cannot guard. The same test
also asserts that the seven primitives remain exported and that nothing else appears beside the
seven primitives and these two compositions.

Changes to this capability also update `docs/api.md`, and the help center in
`lib/help/articles.ts` when customer-facing behavior or instructions change.

## Layout

| Path | What lives there |
| --- | --- |
| `lib/seats/` | The domain. Types, constants, the seed, prices, aria labels, primitives and seat-party compositions. |
| `lib/repo/` | Storage. `types.ts` is the contract; `memory.ts` and `supabase.ts` implement it; `index.ts` picks one. |
| `lib/analytics/` | The event contract and `capture`. PostHog itself starts in `instrumentation-client.ts`. |
| `lib/help/articles.ts` | Every help article, as data. |
| `app/api/` | Route handlers. Each one is a thin HTTP shell over a domain operation. |
| `app/` | Pages. `trips/[code]` is Manage Trip; `trips/[code]/seats` is the seat map. |
| `components/seats/` | The seat map UI. `ChooseSeatsView.tsx` owns the interaction and the events. |
| `scripts/` | Migrate, seed and reset, in plain `pg`. Also the PostHog seeders and the verifier. |
| `supabase/migrations/` | The schema. |

## The seats module contract

`lib/seats/index.ts` exports seven primitives and two seat-party compositions, documented in
`docs/api.md`: `getSeatMap`, `getAvailableSeats`, `getPassengerRestrictions`,
`calculateSeatPrice`, `assignSeat`, `getReservation`, `getReservationByCode`,
`findSeatsForParty` and `assignSeatsForParty`.

- `assignSeat` moves one passenger. It is atomic, because the store rejects a seat another
  passenger holds, and it is idempotent for the same passenger and seat.
- `findSeatsForParty` searches and ranks valid contiguous blocks by extra cost.
- `assignSeatsForParty` moves the whole party atomically and leaves all previous assignments
  unchanged if any move fails.
- Adding an export to this module changes the contract. `tests/seat-party.test.ts` fails for an
  unknown name, which is the moment to think about whether the export belongs and whether it is a
  primitive or a composition.

## The analytics contract

`docs/analytics.md` is the written contract and `lib/analytics/events.ts` is the typed one. Event
names and property names are stable; a rename breaks anything that reads the stream. Add a property
rather than change one.

Events fire only when `NEXT_PUBLIC_POSTHOG_KEY` is set, so nothing is sent in development or in
tests by default.

## The PostHog evidence

`npm run seed:sessions` drives a browser over the running site so PostHog records real sessions
with real replays. `npm run seed:outcomes` sends the figures for thirty days after a change that
has not shipped. `npm run seed:verify` reads all of it back with HogQL. `docs/analytics.md` holds
the plan, the working queries and what each seeded event means.

- **PostHog cannot delete event data.** Both seeders take `--dry-run`. Use it. A run that stops
  part way resumes from `.posthog-seed-progress.jsonl`, so never restart one from the top.
- `scripts/lib/synth-sessions.ts` decides what each session does, deterministically, from
  `createSeatDefinitions`. `tests/synth-sessions.test.ts` replays every planned click against the
  cabin's rules, so a change to the seed fails there rather than an hour into a browser run. That
  test also fixes the two numbers the demo quotes: a median of 14 seat-map actions, and a mean of
  14.2.
- The seeder types no passenger first name and reads the lookup from `lib/seats/demo-data.ts`, so
  renaming the demo party does not break it.

## Accessible names are load-bearing

Three control names are matched literally by the Patchlet interface probe and must not drift:

- `Manage Trip` - the trip page heading, and the breadcrumb link on both trip pages.
- `Seats` - the tab in `components/trip/TripSections.tsx`.
- `Change seats` - the link in that tab's panel.

Seat buttons carry `data-seat`, `data-row`, `data-column`, `data-state` and an `aria-label` built by
`seatAriaLabel` in `lib/seats/labels.ts`. `tests/labels.test.ts` pins the exact strings.

A seat that cannot be taken is still a real, focusable button. It is never `disabled`, because a
click on it has to explain why, and that refusal is an analytics signal.

## Never hardcode

- The seat availability pattern. It comes from `createSeatDefinitions` in `lib/seats/seed.ts`, the
  one deterministic function both stores seed from. `tests/seed.test.ts` asserts the properties the
  demo depends on: the only free block of three that costs nothing is 21A 21B 21C, at least two
  rows are aisle traps, at least one block of three costs extra, and the cabin is about 60 percent
  full. Change the seed and those tests tell you what broke.
- Demo facts. Flight, reservation, passengers and their starting seats live in
  `lib/seats/demo-data.ts`. Row numbers, prices, exit rows and the blocked seat live in
  `lib/seats/constants.ts`.
- Any secret. Read them from the environment, list them in `.env.example` by name only, and keep
  `SUPABASE_SERVICE_ROLE_KEY` on the server.
- Screen text that a test reads. Prefer a `data-testid` or an `aria-label`.
- A colour. Every colour is a token in the `@theme` block of `app/globals.css`. Nothing in `app/`
  or `components/` holds a palette colour of its own, apart from the drawn illustrations.

## The theme

NovaAir is dark, and dark is the only theme. There is no toggle and no light fallback.

- Token names say their job, not their hue: `ink` is text and is near-white, `surface` is a card,
  `line` is a decorative hairline and `line-strong` is the edge of a control a customer operates.
  Read the comments in the `@theme` block before you add one.
- `tests/contrast.test.ts` parses that block and measures every pair the design puts on screen. It
  fails with the pair named, so a token change tells you what it broke. Add the pair to that test
  when you add a colour, rather than checking a ratio by hand.
- A receding seat is close to the panel behind it on purpose. Its state is never carried by the pad
  colour alone: the seat prints its own id, an available seat is ringed in amber, and the state is
  in `data-state` and in the `aria-label`. The test holds that reasoning.

## Sharp edges

- `next build` rewrites `next-env.d.ts` with a hard path into whichever output directory ran last.
  That file is a build artifact here and is gitignored. `types/next.d.ts` holds the references that
  are actually committed. Do not commit `next-env.d.ts`.
- `npm run e2e` builds into `.next-e2e`, so it does not fight a running `npm run dev`.
- The in-memory store lives on `globalThis` so it survives hot reloads. A script outside the server
  cannot reach it, which is why `POST /api/demo/reset` exists next to `npm run db:reset-demo`.
- Confirm seats writes one assignment for each moving passenger, ordered so a passenger leaves a
  seat before the next one takes it. A deliberate two-way swap cannot be ordered and reports a
  clear failure instead.
- Tailwind v4 is configured in CSS. Design tokens live in the `@theme` block of `app/globals.css`,
  not in a `tailwind.config` file.

## Commits

Conventional Commits, imperative subject, no trailers and no agent co-author. Plain dash, never an
em dash, anywhere in this repository.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
