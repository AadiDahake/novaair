#!/usr/bin/env node
/**
 * Ask PostHog what it has.
 *
 * This is the proof that the seeded sessions are real data in a real product analytics project,
 * and not a number written into a slide: every figure it prints comes back from a HogQL query over
 * the events NovaAir itself sent. The query text is in `docs/analytics.md` as well, because the
 * trajectory miner runs the same one.
 *
 *   node --import tsx scripts/posthog-verify.mjs [--days 90] [--sessions 5] [--json]
 *
 * It reads only. It needs a personal API key with the Query Read and Session Recording Read
 * scopes.
 */
import process from 'node:process'
import { loadEnv } from './lib/env.mjs'
import { getRecording, readPrivateApiEnv, replayUrl, runQuery } from './lib/posthog.mjs'

loadEnv()

/**
 * The events NovaAir sends from the seat map. Naming them, rather than matching `seat_%`, keeps
 * the seeded 30-day outcome events out of the trajectories.
 */
const SEAT_EVENTS = `'seat_map_opened', 'passenger_selected', 'seat_hovered', 'seat_selected',
                    'seat_selection_rejected', 'seat_assignment_confirmed'`

/**
 * A session counts as a hand-worked party move when the customer opened the seat map and saved a
 * set of seats that ended up together, for a booking with more than one passenger. That is the
 * "successful trajectory" filter: it keeps the families, and it drops the sessions that gave up
 * and the ones that moved a single passenger.
 */
const SUCCESSFUL = `countIf(event = 'seat_map_opened') > 0
       AND countIf(event = 'seat_assignment_confirmed'
                   AND toString(properties.contiguous) = 'true'
                   AND toInt(properties.party_size) > 1) > 0`

/** How many matching sessions there are, and what the workaround cost each of them. */
export function headlineQuery(days) {
  return `
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
    WHERE timestamp >= now() - INTERVAL ${days} DAY
      AND event IN (${SEAT_EVENTS})
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING ${SUCCESSFUL}
)`
}

/**
 * One row for each matching session, with its steps in order.
 *
 * The whole trajectory comes back in one pass over `events`: `groupArray` collects a tuple for
 * every step, `arraySort` orders it by the timestamp in the tuple's first position, and the outer
 * `arrayFilter` trims it to the window between opening the map and saving. There is no join and no
 * window function, so it stays inside PostHog's ten second query budget.
 */
export function trajectoryQuery(days, limit) {
  return `
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
    WHERE timestamp >= now() - INTERVAL ${days} DAY
      AND event IN (${SEAT_EVENTS})
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING ${SUCCESSFUL}
)
WHERE confirmed_at > opened_at
ORDER BY opened_at DESC
LIMIT ${limit}`
}

/** The sessions that opened the seat map and never saved anything. */
export function abandonedQuery(days) {
  return `
SELECT count() AS abandoned_sessions
FROM (
    SELECT properties.$session_id AS session_id
    FROM events
    WHERE timestamp >= now() - INTERVAL ${days} DAY
      AND event IN (${SEAT_EVENTS})
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING countIf(event = 'seat_map_opened') > 0
       AND countIf(event = 'seat_assignment_confirmed') = 0
)`
}

/** The seeded outcome numbers, which are future data and are labelled as seeded. */
export function outcomeQuery(days) {
  return `
SELECT
    countIf(event = 'seat_party_together_eligible')  AS eligible,
    countIf(event = 'seat_party_together_used')      AS used,
    countIf(event = 'seat_party_together_succeeded') AS succeeded,
    round(avgIf(toInt(properties.interactions),
                event = 'seat_party_together_succeeded'), 2) AS mean_interactions_after,
    countIf(event = 'seat_support_contact'
            AND toString(properties.period) = 'before_launch') AS support_before,
    countIf(event = 'seat_support_contact'
            AND toString(properties.period) = 'after_launch')  AS support_after
FROM events
WHERE timestamp >= now() - INTERVAL ${days} DAY
  AND event IN ('seat_party_together_eligible', 'seat_party_together_used',
                'seat_party_together_succeeded', 'seat_support_contact')
  AND toString(properties.seeded) = 'true'`
}

function parseArgs(argv) {
  const args = { days: 90, sessions: 5, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--days') args.days = Number(argv[(i += 1)])
    else if (arg === '--sessions') args.sessions = Number(argv[(i += 1)])
    else {
      console.error(`unknown option: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const env = readPrivateApiEnv()
if (env.missing.length > 0) {
  console.error(`not set: ${env.missing.join(', ')}. See .env.example.`)
  process.exit(1)
}

const headline = await runQuery(env, 'novaair_seat_workaround_headline', headlineQuery(args.days))
const trajectories = await runQuery(
  env,
  'novaair_seat_workaround_sessions',
  trajectoryQuery(args.days, 200),
)
const abandoned = await runQuery(env, 'novaair_seat_map_abandoned', abandonedQuery(args.days))
const outcomes = await runQuery(env, 'novaair_seat_party_together_outcomes', outcomeQuery(60))

const summary = headline.rows[0] ?? {}
const outcome = outcomes.rows[0] ?? {}

// The replay links go to the longest sessions, because those are the ones worth watching.
const watchable = [...trajectories.rows]
  .sort((a, b) => b.seat_map_actions - a.seat_map_actions)
  .slice(0, 3)
const recordings = await Promise.all(
  watchable.map(async (row) => {
    const recording = await getRecording(env, row.session_id).catch(() => null)
    return {
      sessionId: row.session_id,
      distinctId: row.distinct_id,
      actions: row.seat_map_actions,
      seats: row.final_seats,
      url: replayUrl(env, row.session_id),
      exists: Boolean(recording),
      durationSeconds: recording?.recording_duration ?? null,
      clicks: recording?.click_count ?? null,
    }
  }),
)

if (args.json) {
  console.log(JSON.stringify({ summary, outcome, recordings, sessions: trajectories.rows }, null, 2))
  process.exit(0)
}

console.log(`PostHog project ${env.projectId}, last ${args.days} days`)
console.log('')
console.log('Before the change: hand-worked party moves')
console.log(`  matching successful sessions   ${summary.matching_sessions}`)
console.log(`  median seat-map actions        ${summary.median_seat_map_actions}`)
console.log(`  mean seat-map actions          ${summary.mean_seat_map_actions}`)
console.log(`  range of seat-map actions      ${summary.fewest_actions} to ${summary.most_actions}`)
console.log(`  median session length          ${summary.median_duration_seconds} seconds`)
console.log(`  sessions that opened the map and gave up   ${abandoned.rows[0]?.abandoned_sessions}`)

if (outcome.eligible > 0) {
  const rate = (value, total) => (total > 0 ? `${Math.round((value / total) * 100)}%` : 'n/a')
  const change = Math.round(((outcome.support_after - outcome.support_before) / outcome.support_before) * 100)
  console.log('')
  console.log('After the change: seeded outcome data, 30 days (labelled seeded, not from the site)')
  console.log(`  eligible travelers             ${outcome.eligible}`)
  console.log(`  used the feature               ${outcome.used} (${rate(outcome.used, outcome.eligible)})`)
  console.log(`  succeeded                      ${outcome.succeeded} (${rate(outcome.succeeded, outcome.used)})`)
  console.log(`  mean interactions              ${summary.mean_seat_map_actions} -> ${outcome.mean_interactions_after}`)
  console.log(`  seat-related support contacts  ${outcome.support_before} -> ${outcome.support_after} (${change}%)`)
}

console.log('')
console.log(`Trajectories returned: ${trajectories.rows.length}`)
for (const row of trajectories.rows.slice(0, args.sessions)) {
  const path = row.steps
    .filter((step) => step[1] !== 'seat_hovered')
    .map((step) => (step[2] ? `${step[1]}:${step[2]}` : step[1]))
    .join(' -> ')
  console.log('')
  console.log(
    `  ${row.distinct_id}  ${row.seat_map_actions} actions, ${row.duration_seconds}s, ends on ${row.final_seats}`,
  )
  console.log(`    ${path}`)
}

console.log('')
console.log('Session replays:')
for (const recording of recordings) {
  console.log(
    `  ${recording.url}` +
      `\n    ${recording.distinctId}, ${recording.actions} actions, ends on ${recording.seats}` +
      `\n    recording: ${recording.exists ? `${recording.durationSeconds}s, ${recording.clicks} clicks` : 'NOT FOUND'}`,
  )
}

const missingRecording = recordings.filter((recording) => !recording.exists)
if (missingRecording.length > 0) {
  console.error('')
  console.error(`${missingRecording.length} of the linked sessions have no replay.`)
  process.exit(1)
}
