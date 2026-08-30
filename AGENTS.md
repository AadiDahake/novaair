# Project agent memory

NovaAir is a fictional consumer airline website. It is the host product for the Patchlet demo.
`README.md` covers running and checking it. This file covers what an agent needs before it changes
anything.

## The rule that shapes this repository

NovaAir has the seat primitives but not their composition. There is no function, route, help
article or control that finds seats together, ranks groups of seats, or moves more than one
passenger in one action. A customer moves each passenger by hand. That absence is the point of the
product it demonstrates.

`tests/no-group-seating.test.ts` enforces it. It scans `lib/`, `app/` and `components/` for the
banned names and asserts the exact export list of `lib/seats/index.ts`. Do not weaken it. If a task
asks you to add such a feature, that task is changing the premise, so raise it rather than quietly
adding the code.

## Layout

| Path | What lives there |
| --- | --- |
| `lib/seats/` | The domain. Types, constants, the seed, prices, aria labels, and the primitives in `index.ts`. |
| `lib/repo/` | Storage. `types.ts` is the contract; `memory.ts` and `supabase.ts` implement it; `index.ts` picks one. |
| `lib/analytics/` | The event contract and `capture`. PostHog itself starts in `instrumentation-client.ts`. |
| `lib/help/articles.ts` | Every help article, as data. |
| `app/api/` | Route handlers. Each one is a thin shell over one primitive. |
| `app/` | Pages. `trips/[code]` is Manage Trip; `trips/[code]/seats` is the seat map. |
| `components/seats/` | The seat map UI. `ChooseSeatsView.tsx` owns the interaction and the events. |
| `scripts/` | Migrate, seed and reset, in plain `pg`. Also the PostHog seeders and the verifier. |
| `supabase/migrations/` | The schema. |

## The primitives contract

`lib/seats/index.ts` exports exactly seven functions, documented in `docs/api.md`:
`getSeatMap`, `getAvailableSeats`, `getPassengerRestrictions`, `calculateSeatPrice`, `assignSeat`,
`getReservation`, `getReservationByCode`.

- `assignSeat` moves one passenger. It is atomic, because the store rejects a seat another
  passenger holds, and it is idempotent for the same passenger and seat.
- Adding an export to this module changes the contract. `tests/no-group-seating.test.ts` will fail
  until the expected list is updated, which is the moment to think about whether the new export
  belongs.

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
