import type { Flight, Passenger, SeatDefinition } from '../seats/types'

/**
 * The storage contract. Two implementations satisfy it: Supabase Postgres for a deployed site, and
 * an in-memory store so `npm run dev` and the tests need no credentials and no network.
 *
 * The interface is deliberately narrow. It reads and writes rows. It holds no seat logic, so the
 * primitives in `lib/seats/` behave the same on either store.
 */
export interface ReservationRecord {
  code: string
  lastName: string
  flightId: string
  bookedOn: string
  fareBrand: string
  totalPaidUsd: number
}

export interface AssignmentRecord {
  flightId: string
  seatId: string
  passengerId: string
}

export interface SeatRepository {
  /** Which store is in use. Shown in the dev banner and in `/api/health`. */
  readonly kind: 'memory' | 'supabase'

  getFlight(flightId: string): Promise<Flight | null>
  getSeatDefinitions(flightId: string): Promise<SeatDefinition[]>
  getSeatDefinition(flightId: string, seatId: string): Promise<SeatDefinition | null>

  findReservation(code: string, lastName: string): Promise<ReservationRecord | null>
  getReservationByCode(code: string): Promise<ReservationRecord | null>
  getPassengers(code: string): Promise<Passenger[]>
  getPassenger(passengerId: string): Promise<Passenger | null>

  getAssignments(flightId: string): Promise<AssignmentRecord[]>

  /**
   * Move one passenger to one seat, atomically.
   * Returns `taken` when another passenger already holds the seat. Returns `ok` and does nothing
   * when the passenger already holds it, so a repeated call is safe.
   */
  assign(
    flightId: string,
    passengerId: string,
    seatId: string,
  ): Promise<{ ok: true; previousSeatId: string | null } | { ok: false; reason: 'taken' }>

  /** Put the demo back to its starting seats and starting availability. */
  resetDemo(): Promise<void>
}
