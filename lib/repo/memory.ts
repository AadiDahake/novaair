import { DEMO_FLIGHT, DEMO_PASSENGERS, DEMO_RESERVATION } from '../seats/demo-data'
import { createSeatDefinitions } from '../seats/seed'
import type { Flight, Passenger, SeatDefinition } from '../seats/types'
import type { AssignmentRecord, ReservationRecord, SeatRepository } from './types'

interface Store {
  flights: Map<string, Flight>
  seats: Map<string, SeatDefinition[]>
  reservations: Map<string, ReservationRecord>
  passengers: Map<string, Passenger[]>
  assignments: Map<string, AssignmentRecord[]>
}

function buildStore(): Store {
  const reservation: ReservationRecord = {
    code: DEMO_RESERVATION.code,
    lastName: DEMO_RESERVATION.lastName,
    flightId: DEMO_FLIGHT.id,
    bookedOn: DEMO_RESERVATION.bookedOn,
    fareBrand: DEMO_RESERVATION.fareBrand,
    totalPaidUsd: DEMO_RESERVATION.totalPaidUsd,
  }
  const passengers = DEMO_PASSENGERS.map((passenger) => ({ ...passenger }))
  const assignments: AssignmentRecord[] = passengers
    .filter((passenger): passenger is Passenger & { seatId: string } => passenger.seatId !== null)
    .map((passenger) => ({
      flightId: DEMO_FLIGHT.id,
      seatId: passenger.seatId,
      passengerId: passenger.id,
    }))

  return {
    flights: new Map([[DEMO_FLIGHT.id, { ...DEMO_FLIGHT }]]),
    seats: new Map([[DEMO_FLIGHT.id, createSeatDefinitions()]]),
    reservations: new Map([[reservation.code, reservation]]),
    passengers: new Map([[reservation.code, passengers]]),
    assignments: new Map([[DEMO_FLIGHT.id, assignments]]),
  }
}

/**
 * The store lives on `globalThis` so the Next.js dev server keeps it across hot reloads.
 * Without that, every edit would put the demo reservation back to 12A / 18C / 24F mid-flow.
 */
const globalStore = globalThis as unknown as { __novaairStore?: Store }

function store(): Store {
  if (!globalStore.__novaairStore) globalStore.__novaairStore = buildStore()
  return globalStore.__novaairStore
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

export class MemorySeatRepository implements SeatRepository {
  readonly kind = 'memory' as const

  async getFlight(flightId: string): Promise<Flight | null> {
    return store().flights.get(flightId) ?? null
  }

  async getSeatDefinitions(flightId: string): Promise<SeatDefinition[]> {
    return store().seats.get(flightId) ?? []
  }

  async getSeatDefinition(flightId: string, seatId: string): Promise<SeatDefinition | null> {
    const seats = await this.getSeatDefinitions(flightId)
    return seats.find((seat) => seat.id === seatId) ?? null
  }

  async findReservation(code: string, lastName: string): Promise<ReservationRecord | null> {
    const record = store().reservations.get(normalizeCode(code))
    if (!record) return null
    if (record.lastName.toLowerCase() !== lastName.trim().toLowerCase()) return null
    return record
  }

  async getReservationByCode(code: string): Promise<ReservationRecord | null> {
    return store().reservations.get(normalizeCode(code)) ?? null
  }

  async getPassengers(code: string): Promise<Passenger[]> {
    const passengers = store().passengers.get(normalizeCode(code)) ?? []
    return passengers.map((passenger) => ({ ...passenger }))
  }

  async getPassenger(passengerId: string): Promise<Passenger | null> {
    for (const passengers of store().passengers.values()) {
      const found = passengers.find((passenger) => passenger.id === passengerId)
      if (found) return { ...found }
    }
    return null
  }

  async getAssignments(flightId: string): Promise<AssignmentRecord[]> {
    return (store().assignments.get(flightId) ?? []).map((record) => ({ ...record }))
  }

  async assign(
    flightId: string,
    passengerId: string,
    seatId: string,
  ): Promise<{ ok: true; previousSeatId: string | null } | { ok: false; reason: 'taken' }> {
    const current = store().assignments.get(flightId) ?? []
    const holder = current.find((record) => record.seatId === seatId)
    if (holder && holder.passengerId !== passengerId) return { ok: false, reason: 'taken' }

    const own = current.find((record) => record.passengerId === passengerId)
    const previousSeatId = own?.seatId ?? null
    if (previousSeatId === seatId) return { ok: true, previousSeatId }

    const next = current.filter((record) => record.passengerId !== passengerId)
    next.push({ flightId, seatId, passengerId })
    store().assignments.set(flightId, next)

    for (const passengers of store().passengers.values()) {
      const passenger = passengers.find((entry) => entry.id === passengerId)
      if (passenger) passenger.seatId = seatId
    }
    return { ok: true, previousSeatId }
  }

  async resetDemo(): Promise<void> {
    globalStore.__novaairStore = buildStore()
  }
}
