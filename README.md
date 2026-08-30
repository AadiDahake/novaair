# NovaAir

NovaAir is a fictional consumer airline website. It is the host product for the Patchlet demo: a
real reservation flow, a real seat map, real persistence, real analytics and an accessible DOM.

Nothing on this site is a real airline, a real flight or a real booking.

## What it does

- Search flights, with a working filter panel.
- Find a booking by confirmation code and last name.
- Manage Trip: itinerary, passengers, and Seats, Bags and Check-in sections.
- Choose Seats: a 30 row, 3-3 seat map with paid extra-legroom rows, exit rows, and one seat held
  for accessible seating. One passenger moves at a time.
- A help center of six articles.

## What it does not do

NovaAir has no way to find seats together and no way to move a party in one action. A customer
reads the map and moves each passenger by hand. That absence is deliberate, and
`tests/no-group-seating.test.ts` fails if such a feature appears.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no environment set the site runs on an in-memory store seeded by
the same function the database uses, so it needs no credentials and no network.

The one booking is:

| Field | Value |
| --- | --- |
| Confirmation code | `NVA7K2` |
| Last name | `Musk` |
| Flight | NA 214, SFO to JFK, 19 September 2026 |
| Party | Elon Musk (adult) 12A, Sam Altman (child, 9) 18C, Zuck (child, 6) 24F |

`npm run db:reset-demo` puts those seats back.

## Check it

```bash
npm run typecheck   # tsc over the app and over the end-to-end tests
npm run lint
npm test            # vitest: seed properties, primitives, reservation flow
npm run build
npm run e2e         # playwright: the whole seat change, end to end
```

`npm test` and `npm run e2e` use the in-memory store, so neither needs a database or a network.
Stop `npm run dev` before `npm run e2e`, or let it run: the end-to-end build uses its own output
directory.

## Environment

Every variable is described in `.env.example`. Copy it to `.env.local` and fill in what you need.
The site works with none of them set.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | The Supabase project URL. With the service role key, it switches the site to Postgres. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key. It must never reach the browser. |
| `SUPABASE_DB_URL` | Direct Postgres connection string. Used only by the migrate, seed and reset scripts. |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project key. Without it, PostHog never starts. |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingestion host. |
| `POSTHOG_HOST` | PostHog private API host. The seeding and verification scripts read it. |
| `POSTHOG_PROJECT_ID` | The numeric PostHog project id. |
| `POSTHOG_PERSONAL_API_KEY` | Personal API key, Query Read and Session Recording Read. Server only. |
| `NEXT_PUBLIC_PATCHLET_WIDGET_URL` | The Patchlet widget script URL. |
| `NEXT_PUBLIC_PATCHLET_KEY` | The Patchlet public key, sent as the script tag's `data-key`. |
| `NOVAAIR_BASE_URL` | The site the reset script, the end-to-end run and the session seeder talk to. |
| `NOVAAIR_DEMO_CODE` | The booking the session seeder looks up. Defaults to the demo reservation. |
| `NOVAAIR_DEMO_LAST_NAME` | The last name it looks it up with. Defaults to the demo reservation. |

The Patchlet widget script tag renders only when both `NEXT_PUBLIC_PATCHLET_WIDGET_URL` and
`NEXT_PUBLIC_PATCHLET_KEY` are set. NovaAir holds no other code for it.

## Database

The site does not need a database. To run it on Supabase Postgres:

```bash
npm run db:migrate     # apply supabase/migrations/*.sql with plain pg
npm run db:seed        # write the flight, the seats, the booking and the passengers
npm run db:reset-demo  # put the demo back to 12A, 18C and 24F
```

The scripts use `pg` directly. They need no Docker, no local Postgres and no Supabase CLI.

## PostHog evidence

The demo needs sessions in PostHog that show customers moving a party by hand, with replays a
person can watch.

```bash
npm run seed:sessions -- --dry-run   # print the plan, send nothing
npm run seed:sessions                # record 83 real sessions in a browser
npm run seed:outcomes -- --dry-run   # print the seeded 30-day numbers
npm run seed:outcomes                # send them through the capture endpoint
npm run seed:verify                  # read it all back out of PostHog
```

`seed:sessions` drives the running site with a browser, so every session gets a real
`$session_id` and a real replay. `seed:outcomes` sends the figures for thirty days after a change
that has not shipped; every one of those events carries `seeded: true`, and NovaAir never sends
them. `docs/analytics.md` holds the plan, the queries and what each seeded event means.

PostHog cannot delete event data. Use `--dry-run` first, and run each seeder once.

## Deploy

Vercel project `novaair`, root at the repository root, framework Next.js, no build overrides. Set
the environment variables above in the Vercel project. Without the Supabase variables a deployment
still runs, on the in-memory store, and its data resets when the instance recycles.

## Documents

| File | What it holds |
| --- | --- |
| `docs/api.md` | The primitives and the route handlers over them. |
| `docs/analytics.md` | Every event name and property NovaAir sends. |
| `docs/design-research.md` | What was read on real airline sites, and what NovaAir borrows. |
| `docs/screenshots/` | The site at 1440x900, and one PostHog replay of a seeded session. |
| `AGENTS.md` | How to work in this repository. |
