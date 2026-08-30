import { describe, expect, it } from 'vitest'
import { createSeatDefinitions } from '../lib/seats/seed'
import { DEMO_PASSENGERS } from '../lib/seats/demo-data'
import {
  ABANDONED_SESSION_COUNT,
  FAMILY_TRIPLES,
  INTERACTION_COUNTS,
  SUCCESSFUL_SESSION_COUNT,
  UNRELATED_SESSION_COUNT,
  mean,
  median,
  planSessions,
  plannedInteractions,
} from '../scripts/lib/synth-sessions'

/**
 * The plan behind `npm run seed:sessions`.
 *
 * The two numbers the demo quotes come out of PostHog, and PostHog only reports what the seeded
 * sessions actually did. This test is where those numbers are decided, and it is the cheap way to
 * find out that a change to the cabin seed has broken a scripted path, without spending an hour of
 * browser time to learn it.
 */
describe('the synthetic session plan', () => {
  const sessions = planSessions()
  const successful = sessions.filter((session) => session.kind === 'successful')

  it('holds 63 successful sessions, 15 abandoned and 5 unrelated', () => {
    expect(successful).toHaveLength(SUCCESSFUL_SESSION_COUNT)
    expect(sessions.filter((s) => s.kind === 'abandoned')).toHaveLength(ABANDONED_SESSION_COUNT)
    expect(sessions.filter((s) => s.kind === 'unrelated')).toHaveLength(UNRELATED_SESSION_COUNT)
    expect(new Set(sessions.map((s) => s.distinctId)).size).toBe(sessions.length)
    expect(sessions.map((s) => s.index)).toEqual(sessions.map((_s, i) => i + 1))
  })

  it('has a median of 14 seat-map interactions, and a mean of 14.2', () => {
    expect(INTERACTION_COUNTS).toHaveLength(SUCCESSFUL_SESSION_COUNT)
    expect(median(INTERACTION_COUNTS)).toBe(14)
    expect(mean(INTERACTION_COUNTS).toFixed(1)).toBe('14.2')
  })

  it('plays exactly the interactions it promises', () => {
    for (const session of successful) {
      expect(plannedInteractions(session)).toBe(session.interactions)
    }
    expect(successful.map((session) => session.interactions)).toEqual([...INTERACTION_COUNTS])
  })

  it('ends every successful session on a block of three on one side of the aisle', () => {
    // A party with children can use two blocks: the one that is free and the one that costs extra.
    expect(FAMILY_TRIPLES.map((triple) => triple.seats.join(''))).toEqual(['21A21B21C', '2A2B2C'])

    const endings = new Set<string>()
    for (const session of successful) {
      expect(session.targetSeats).toHaveLength(DEMO_PASSENGERS.length)
      endings.add((session.targetSeats ?? []).join(''))
      expect(session.steps.at(-1)?.kind).toBe('confirm')
    }
    expect([...endings].sort()).toEqual(['21A21B21C', '2A2B2C'])
  })

  it('never confirms an abandoned or a help-reading session', () => {
    for (const session of sessions.filter((s) => s.kind !== 'successful')) {
      if (session.shape === 'single-seat-change') continue
      expect(session.steps.some((step) => step.kind === 'confirm')).toBe(false)
    }
  })

  it('moves one passenger and no more in the sessions the miner must reject', () => {
    const single = sessions.filter((session) => session.shape === 'single-seat-change')
    expect(single.length).toBeGreaterThan(0)
    for (const session of single) {
      const moved = (session.targetSeats ?? []).filter(
        (seat, index) => seat !== DEMO_PASSENGERS[index]?.seatId,
      )
      expect(moved).toHaveLength(1)
    }
  })

  it('only touches seats the cabin actually has, in the state the step expects', () => {
    const seats = new Map(createSeatDefinitions().map((seat) => [seat.id, seat]))
    for (const session of sessions) {
      for (const step of session.steps) {
        if (step.kind !== 'seat' && step.kind !== 'hover') continue
        const seat = seats.get(step.seat ?? '')
        expect(seat, `${session.distinctId} touches ${step.seat}`).toBeDefined()
        if (step.kind !== 'seat') continue
        if (step.reason === 'seat_booked') expect(seat?.baseState).toBe('booked')
        if (step.reason === 'seat_blocked') expect(seat?.baseState).toBe('blocked')
        if (step.reason === 'exit_row_child') expect(seat?.isExitRow).toBe(true)
        if (step.outcome === 'accepted') {
          expect(seat?.baseState, `${session.distinctId} takes ${step.seat}`).toBe('available')
          expect(seat?.isExitRow).toBe(false)
        }
      }
    }
  })

  it('agrees with the seat map on every click it plays', () => {
    // The same rules ChooseSeatsView applies, in the same order. If a scripted click would be
    // refused when the plan says it is taken, or the other way round, the run would drift.
    const seats = new Map(createSeatDefinitions().map((seat) => [seat.id, seat]))

    for (const session of sessions) {
      const staged = new Map<number, string>(
        DEMO_PASSENGERS.map((passenger) => [passenger.index, passenger.seatId ?? '']),
      )
      let selected = 0
      let interactions = 0

      for (const step of session.steps) {
        if (step.kind === 'passenger') {
          selected = step.index ?? 0
          interactions += 1
          continue
        }
        if (step.kind !== 'seat') continue

        const seat = seats.get(step.seat ?? '')
        expect(seat, `${session.distinctId} clicks ${step.seat}`).toBeDefined()
        if (!seat) continue
        const owner = [...staged].find(([, seatId]) => seatId === seat.id)?.[0] ?? null
        const passenger = DEMO_PASSENGERS[selected]

        let outcome: 'accepted' | 'rejected' | 'ignored' = 'accepted'
        let reason: string | undefined
        if (seat.baseState === 'booked') {
          outcome = 'rejected'
          reason = 'seat_booked'
        } else if (seat.baseState === 'blocked') {
          outcome = 'rejected'
          reason = 'seat_blocked'
        } else if (owner !== null) {
          outcome = owner === selected ? 'ignored' : 'rejected'
          reason = owner === selected ? undefined : 'seat_taken_by_party'
        } else if (seat.isExitRow && passenger?.type !== 'adult') {
          outcome = 'rejected'
          reason = 'exit_row_child'
        }

        const where = `${session.distinctId} clicks ${seat.id} for passenger ${selected}`
        expect(outcome, where).toBe(step.outcome)
        expect(reason, where).toBe(step.reason)

        interactions += 1
        if (outcome === 'accepted') {
          staged.set(selected, seat.id)
          selected = (selected + 1) % DEMO_PASSENGERS.length
        }
      }

      if (!session.steps.some((step) => step.kind === 'confirm')) continue
      expect([...staged.values()], session.distinctId).toEqual(session.targetSeats)
      expect(interactions, session.distinctId).toBe(session.interactions)
    }
  })
})
