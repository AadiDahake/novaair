/** Seat and reservation domain types. Shared by the server primitives and the client. */

export type SeatColumn = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** The physical state of a seat, before this reservation's own assignments are applied. */
export type SeatBaseState = 'available' | 'booked' | 'blocked'

/** The state a seat shows on the map, after assignments are applied. */
export type SeatState = 'available' | 'booked' | 'blocked' | 'occupied'

export type PassengerType = 'adult' | 'child'

export interface SeatDefinition {
  /** Seat id such as "21A". */
  id: string
  row: number
  column: SeatColumn
  baseState: SeatBaseState
  isExitRow: boolean
  isExtraLegroom: boolean
  priceCents: number
}

export interface Seat extends SeatDefinition {
  state: SeatState
  /** Set when a passenger of the current reservation holds the seat. */
  occupantPassengerId: string | null
}

export interface SeatRow {
  row: number
  isExitRow: boolean
  isExtraLegroom: boolean
  /** Left of the aisle, then right of the aisle. */
  left: Seat[]
  right: Seat[]
}

export interface SeatMap {
  flightId: string
  cabinName: string
  rowCount: number
  columns: SeatColumn[]
  aisleAfter: SeatColumn
  rows: SeatRow[]
}

export interface Flight {
  id: string
  flightNumber: string
  originCode: string
  originCity: string
  destinationCode: string
  destinationCity: string
  departureDate: string
  departureTime: string
  arrivalTime: string
  durationMinutes: number
  aircraft: string
  cabinName: string
  rowCount: number
  fareUsd: number
}

export interface Passenger {
  id: string
  reservationCode: string
  /** Position in the party, starting at 0. Used by the analytics contract. */
  index: number
  firstName: string
  lastName: string
  type: PassengerType
  age: number
  seatId: string | null
}

export interface Reservation {
  code: string
  lastName: string
  flight: Flight
  passengers: Passenger[]
  bookedOn: string
  fareBrand: string
  totalPaidUsd: number
}

export interface PassengerRestrictions {
  passengerId: string
  type: PassengerType
  age: number
  /** False for children. Exit rows are adults only. */
  canUseExitRow: boolean
  /** True for children under the unaccompanied age. */
  mustSitWithAdult: boolean
}

export type AssignSeatFailureReason =
  | 'seat_not_found'
  | 'passenger_not_found'
  | 'seat_booked'
  | 'seat_blocked'
  | 'exit_row_child'

export type AssignSeatResult =
  | { ok: true; passengerId: string; seatId: string; previousSeatId: string | null; priceCents: number }
  | { ok: false; reason: AssignSeatFailureReason; message: string }

/** One passenger-to-seat pairing in a recommendation or atomic party move. */
export interface SeatPartyAssignment {
  passengerId: string
  seatId: string
}

/** A valid adjacent block for the whole party, ranked by total extra cost. */
export interface SeatPartyOption {
  row: number
  seatIds: string[]
  assignments: SeatPartyAssignment[]
  totalPriceCents: number
}

export type AssignSeatsForPartyFailureReason =
  | AssignSeatFailureReason
  | 'reservation_not_found'
  | 'invalid_party'
  | 'invalid_assignment'
  | 'seats_not_together'
  | 'assignment_failed'

/** The outcome of applying every passenger-to-seat pairing as one atomic party move. */
export type AssignSeatsForPartyResult =
  | { ok: true; assignments: SeatPartyAssignment[] }
  | { ok: false; reason: AssignSeatsForPartyFailureReason; message: string }

declare global {
  interface Array<T> {
    reduce(
      this: (number | null)[],
      callbackfn: (
        previousValue: number,
        currentValue: number | null,
        currentIndex: number,
        array: (number | null)[],
      ) => number,
      initialValue: number,
    ): number
  }
}
