import { createClient } from '@supabase/supabase-js'
import { MemorySeatRepository } from './memory'
import { SupabaseSeatRepository } from './supabase'
import type { SeatRepository } from './types'

let cached: SeatRepository | null = null

type Assignment = Awaited<ReturnType<SeatRepository['getAssignments']>>[number]

interface PartyAssignment {
  passengerId: string
  seatId: string
}

interface AssignmentSnapshot {
  passengerId: string
  seatId: string | null
}

interface MemoryAssignments {
  flights: Map<string, Promise<Assignment[]>>
  tail: Promise<void>
}

// The repository owns reset as well as writes. Do not expose this queue through the legacy
// reset hook in lib/seats, which would wrap resetDemo and try to acquire the same queue twice.
const memoryGlobal = globalThis as typeof globalThis & {
  __novaAirMemoryAssignmentState?: MemoryAssignments
}

function memoryAssignments(): MemoryAssignments {
  return (memoryGlobal.__novaAirMemoryAssignmentState ??= {
    flights: new Map(),
    tail: Promise.resolve(),
  })
}

async function withMemoryWrite<T>(state: MemoryAssignments, write: () => Promise<T>): Promise<T> {
  const previous = state.tail
  let release!: () => void
  state.tail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await write()
  } finally {
    release()
  }
}

function memoryRepository(repository: SeatRepository): SeatRepository {
  const state = memoryAssignments()

  async function readAssignments(flightId: string): Promise<Assignment[]> {
    let snapshot = state.flights.get(flightId)
    if (!snapshot) {
      snapshot = repository.getAssignments(flightId).then((entries) => entries.map((entry) => ({ ...entry })))
      state.flights.set(flightId, snapshot)
      void snapshot.catch(() => {
        if (state.flights.get(flightId) === snapshot) state.flights.delete(flightId)
      })
    }
    return snapshot
  }

  function publish(flightId: string, entries: Assignment[]): void {
    state.flights.set(flightId, Promise.resolve(entries))
  }

  async function assign(flightId: string, passengerId: string, seatId: string) {
    return withMemoryWrite(state, async () => {
      const passenger = await repository.getPassenger(passengerId)
      if (!passenger) return { ok: false as const }
      const reservation = await repository.getReservationByCode(passenger.reservationCode)
      if (!reservation || reservation.flightId !== flightId) return { ok: false as const }
      const seat = await repository.getSeatDefinition(flightId, seatId)
      if (!seat || seat.baseState !== 'available') return { ok: false as const }

      const current = await readAssignments(flightId)
      if (current.some((entry) => entry.seatId === seatId && entry.passengerId !== passengerId)) {
        return { ok: false as const }
      }
      const previous = current.find((entry) => entry.passengerId === passengerId)
      const next = current.filter((entry) => entry.passengerId !== passengerId)
      next.push({ ...previous, flightId, passengerId, seatId } as Assignment)
      publish(flightId, next)
      return { ok: true as const, previousSeatId: previous?.seatId ?? null }
    })
  }

  function resetDemo() {
    return withMemoryWrite(state, async () => {
      const result = await repository.resetDemo()
      state.flights.clear()
      return result
    })
  }

  return new Proxy(repository, {
    get(target, property) {
      if (property === 'getAssignments') {
        return async (flightId: string) =>
          (await readAssignments(flightId)).map ( (entry) => ({ ...entry }))
      }
      if (property === 'getPassenger') {
        return async (passengerId: string) => {
          const passenger = await target.getPassenger(passengerId)
          if (!passenger) return null
          const reservation = await target.getReservationByCode(passenger.reservationCode)
          if (!reservation) return passenger
          const entries = await readAssignments(reservation.flightId)
          return {
            ...passenger,
            seatId: entries.find((entry) => entry.passengerId === passenger.id)?.seatId ?? null,
          }
        }
      }
      if (property === 'getPassengers') {
        return async (code: string) => {
          const passengers = await target.getPassengers(code)
          const reservation = await target.getReservationByCode(code)
          if (!reservation) return passengers
          const entries = await readAssignments(reservation.flightId)
          return passengers.map((passenger) => ({
            ...passenger,
            seatId: entries.find((entry) => entry.passengerId === passenger.id)?.seatId ?? null,
          }))
        }
      }
      if (property === 'assign') return assign
      if (property === 'resetDemo') return resetDemo
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Pick the store from the environment.
 * Supabase is used when both its URL and its service role key are present. Otherwise the site runs
 * on the in-memory store, so `npm run dev` and the tests work with no credentials and no network.
 * The service role key is server-only. It must never reach the browser.
 */
export function getRepository(): SeatRepository {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  cached = url && serviceRoleKey
    ? new SupabaseSeatRepository(url, serviceRoleKey)
    : memoryRepository(new MemorySeatRepository())
  return cached
}

/**
 * Publish a party's assignments only if the expected assignments and all target seats still match.
 * The database boundary must check the same conditions in its transaction.
 */
export async function commitSeatAssignments(
  flightId: string,
  assignments: PartyAssignment[],
  expectedAssignments: AssignmentSnapshot[],
): Promise<boolean> {
  if (
    assignments.length === 0 ||
    assignments.length !== expectedAssignments.length ||
    new Set(assignments.map((entry) => entry.passengerId)).size !== assignments.length ||
    new Set(assignments.map((entry) => entry.seatId)).size !== assignments.length ||
    new Set(expectedAssignments.map((entry) => entry.passengerId)).size !== expectedAssignments.length
  ) {
    return false
  }
  const party = new Set(assignments.map((entry) => entry.passengerId))
  if (expectedAssignments.some((entry) => !party.has(entry.passengerId))) return false

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && serviceRoleKey) {
    const client = createClient(url, serviceRoleKey)
    const { data, error } = await client.rpc('commit_seat_assignments', {
      p_flight_id: flightId,
      p_assignments: assignments,
      p_expected_assignments: expectedAssignments,
    })
    if (error) return false
    return data === true || (typeof data === 'object' && data !== null && data.ok === true)
  }

  const repository = getRepository()
  const state = memoryAssignments()
  return withMemoryWrite(state, async () => {
    const current = await repository.getAssignments(flightId)
    if (
      expectedAssignments.some(
        (entry) =>
          (current.find((item) => item.passengerId === entry.passengerId)?.seatId ?? null) !==
          entry.seatId,
      )
    ) {
      return false
    }
    if (
      assignments.some((entry) =>
        current.some((item) => item.seatId === entry.seatId && !party.has(item.passengerId)),
      )
    ) {
      return false
    }

    for (const entry of assignments) {
      const passenger = await repository.getPassenger(entry.passengerId)
      if (!passenger) return false
      const reservation = await repository.getReservationByCode(passenger.reservationCode)
      if (!reservation || reservation.flightId !== flightId) return false
      const seat = await repository.getSeatDefinition(flightId, entry.seatId)
      if (!seat || seat.baseState !== 'available') return false
    }

    const next = current.filter((entry) => !party.has(entry.passengerId))
    for (const entry of assignments) {
      const previous = current.find((item) => item.passengerId === entry.passengerId)
      next.push({ ...previous, flightId, ...entry } as Assignment)
    }
    state.flights.set(flightId, Promise.resolve(next))
    return true
  })
}

/** Test helper. Drops the cached instance so the next call re-reads the environment. */
export function resetRepositoryCache(): void {
  cached = null
}

export type { SeatRepository } from './types'
