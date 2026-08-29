import type { PassengerType, SeatState } from '../seats/types'

/**
 * The analytics contract.
 *
 * Every event name and every property name here is stable. Trajectory mining reads these events, so
 * a rename is a breaking change. `docs/analytics.md` is the written form of this file.
 */
export interface NovaAirEventMap {
  seat_map_opened: {
    reservation_code: string
    flight_id: string
    party_size: number
    current_seats: string[]
  }
  passenger_selected: {
    passenger_index: number
    passenger_type: PassengerType
  }
  seat_hovered: {
    seat: string
    row: number
    column: string
    state: SeatState
  }
  seat_selected: {
    seat: string
    row: number
    column: string
    passenger_index: number
    state: SeatState
    price: number
  }
  seat_selection_rejected: {
    seat: string
    reason: string
  }
  seat_assignment_confirmed: {
    seats: string[]
    party_size: number
    same_row: boolean
    contiguous: boolean
    additional_cost: number
    interactions: number
    elapsed_ms: number
  }
  help_article_viewed: {
    slug: string
  }
}

export type NovaAirEventName = keyof NovaAirEventMap

export const NOVAAIR_EVENT_NAMES: NovaAirEventName[] = [
  'seat_map_opened',
  'passenger_selected',
  'seat_hovered',
  'seat_selected',
  'seat_selection_rejected',
  'seat_assignment_confirmed',
  'help_article_viewed',
]

/** How often at most one `seat_hovered` event is sent, in milliseconds. */
export const SEAT_HOVER_THROTTLE_MS = 400

/** True when every seat is in the same row. */
export function seatsAreSameRow(seats: string[]): boolean {
  if (seats.length === 0) return false
  const rows = seats.map((seat) => Number.parseInt(seat, 10))
  return rows.every((row) => row === rows[0])
}

/**
 * True when the seats form one unbroken block on one side of the aisle.
 * A B C is one block. C D is not, because the aisle sits between them.
 */
export function seatsAreContiguous(seats: string[]): boolean {
  if (seats.length === 0) return false
  if (seats.length === 1) return true
  if (!seatsAreSameRow(seats)) return false

  const left = 'ABC'
  const right = 'DEF'
  const columns = seats
    .map((seat) => seat.trim().toUpperCase().slice(-1))
    .sort((a, b) => a.localeCompare(b))
  const side = columns.every((column) => left.includes(column))
    ? left
    : columns.every((column) => right.includes(column))
      ? right
      : null
  if (!side) return false

  const indexes = columns.map((column) => side.indexOf(column))
  return indexes.every((value, position) => position === 0 || value === (indexes[position - 1] ?? -9) + 1)
}
