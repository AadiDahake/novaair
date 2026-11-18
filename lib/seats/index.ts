import { getRepository } from '../repo'
import {
  AISLE_AFTER,
  COLUMNS,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  UNACCOMPANIED_MINIMUM_AGE,
  parseSeatId,
} from './constants'
import type {
  AssignSeatResult,
  Passenger,
  PassengerRestrictions,
  Reservation,
  Seat,
  SeatMap,
  SeatRow,
  SeatState,
} from './types'

/**
 * The server-side seat primitives and the seat-party capability composed from them.
 *
 * Each primitive does a single job. The party capability deliberately composes those primitives
 * to search for ranked blocks of adjacent seats and move a party in one apply.
 *
 * `AGENTS.md`, under "Adding seat-party capabilities", defines the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}

export type AssignSeatsForPartyResult =
  | { ok: true; assignments: { passengerId: string; seatId: string }[] }
  | { ok: false; reason: string; message: string }

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

/** Read the whole cabin: every row, every seat, and its state right now. */
export async function getSeatMap(flightId: string): Promise<SeatMap | null> {
  const repository = getRepository()
  const flight = await repository.getFlight(flightId)
  if (!flight) return null

  const [definitions, assignments] = await Promise.all([
    repository.getSeatDefinitions(flightId),
    repository.getAssignments(flightId),
  ])
  const occupantBySeat = new Map(assignments.map((entry) => [entry.seatId, entry.passengerId]))

  const rows: SeatRow[] = []
  for (let row = 1; row <= flight.rowCount; row += 1) {
    const inRow = definitions.filter((definition) => definition.row === row)
    if (inRow.length === 0) continue

    const seats: Seat[] = inRow.map((definition) => {
      const occupantPassengerId = occupantBySeat.get(definition.id) ?? null
      return {
        ...definition,
        occupantPassengerId,
        state: effectiveState(definition.baseState, occupantPassengerId !== null),
      }
    })
    const first = inRow[0]
    rows.push({
      row,
      isExitRow: first?.isExitRow ?? false,
      isExtraLegroom: first?.isExtraLegroom ?? false,
      left: LEFT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
      right: RIGHT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
    })
  }

  return {
    flightId: flight.id,
    cabinName: flight.cabinName,
    rowCount: flight.rowCount,
    columns: COLUMNS,
    aisleAfter: AISLE_AFTER,
    rows,
  }
}

/** The ids of every seat a passenger could take right now, in row then column order. */
export async function getAvailableSeats(flightId: string): Promise<string[]> {
  const map = await getSeatMap(flightId)
  if (!map) return []
  const available: string[] = []
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) {
      if (seat.state === 'available') available.push(seat.id)
    }
  }
  return available
}

/** What one passenger is and is not allowed to do. */
export async function getPassengerRestrictions(
  passengerId: string,
): Promise<PassengerRestrictions | null> {
  const passenger = await getRepository().getPassenger(passengerId)
  if (!passenger) return null
  return {
    passengerId: passenger.id,
    type: passenger.type,
    age: passenger.age,
    canUseExitRow: passenger.type === 'adult',
    mustSitWithAdult: passenger.age < UNACCOMPANIED_MINIMUM_AGE,
  }
}

/** What one seat costs, in cents. Zero for a standard seat. */
export async function calculateSeatPrice(flightId: string, seatId: string): Promise<number | null> {
  const parsed = parseSeatId(seatId)
  if (!parsed) return null
  const definition = await getRepository().getSeatDefinition(flightId, seatId.trim().toUpperCase())
  return definition?.priceCents ?? null
}

/**
 * Move one passenger to one seat.
 *
 * Atomic: the store rejects a seat another passenger already holds.
 * Idempotent: calling it again with the same passenger and seat succeeds and changes nothing.
 * It moves one passenger. There is no bulk form of this call.
 */
export async function assignSeat(passengerId: string, seatId: string): Promise<AssignSeatResult> {
  const repository = getRepository()
  const normalizedSeatId = seatId.trim().toUpperCase()

  const passenger = await repository.getPassenger(passengerId)
  if (!passenger) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const reservation = await repository.getReservationByCode(passenger.reservationCode)
  if (!reservation) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const seat = await repository.getSeatDefinition(reservation.flightId, normalizedSeatId)
  if (!seat) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: `Seat ${normalizedSeatId} is not on this aircraft.`,
    }
  }

  if (seat.baseState === 'blocked') {
    return {
      ok: false,
      reason: 'seat_blocked',
      message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
    }
  }
  if (seat.baseState === 'booked') {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} is already taken. Please pick another seat.`,
    }
  }
  if (seat.isExitRow && passenger.type !== 'adult') {
    return {
      ok: false,
      reason: 'exit_row_child',
      message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger.firstName} cannot sit there.`,
    }
  }

  const result = await repository.assign(reservation.flightId, passenger.id, seat.id)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} was taken while you were choosing. Please pick another seat.`,
    }
  }

  return {
    ok: true,
    passengerId: passenger.id,
    seatId: seat.id,
    previousSeatId: result.previousSeatId,
    priceCents: seat.priceCents,
  }
}

/** Find one reservation by its confirmation code and the last name on it. */
export async function getReservation(code: string, lastName: string): Promise<Reservation | null> {
  const repository = getRepository()
  const record = await repository.findReservation(code, lastName)
  if (!record) return null

  const [flight, passengers] = await Promise.all([
    repository.getFlight(record.flightId),
    repository.getPassengers(record.code),
  ])
  if (!flight) return null

  return {
    code: record.code,
    lastName: record.lastName,
    flight,
    passengers,
    bookedOn: record.bookedOn,
    fareBrand: record.fareBrand,
    totalPaidUsd: record.totalPaidUsd,
  }
}

/** Read a reservation when the code is already trusted, for example from the URL of a trip page. */
export async function getReservationByCode(code: string): Promise<Reservation | null> {
  const record = await getRepository().getReservationByCode(code)
  if (!record) return null
  return getReservation(record.code, record.lastName)
}

async function getPartyPassengers(passengerIds: string[]): Promise<Passenger[] | null> {
  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) return null

  const passengers = await Promise.all(
    passengerIds.map((passengerId) => getRepository().getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) return null

  const party = passengers.filter((passenger): passenger is Passenger => passenger !== null)
  const reservationCode = party[0]?.reservationCode
  if (!reservationCode) return null
  if (party.some((passenger) => passenger.reservationCode !== reservationCode)) return null

  return party
}

function isContiguousSeatBlock(seatIds: string[]): boolean {
  if (seatIds.length === 0 || new Set(seatIds).size !== seatIds.length) return false

  const parsed = seatIds.map((seatId) => parseSeatId(seatId))
  if (parsed.some((seat) => seat === null)) return false

  const seats = parsed.filter((seat): seat is NonNullable<typeof seat> => seat !== null)
  const first = seats[0]
  if (!first || seats.some((seat) => seat.row !== first.row)) return false

  for (const columns of [LEFT_COLUMNS, RIGHT_COLUMNS]) {
    const positions = seats.map((seat) => columns.indexOf(seat.column))
    if (positions.some((position) => position < 0)) continue

    const sorted = [...positions].sort((left, right) => left - right)
    const start = sorted[0]
    if (start === undefined) continue
    if (sorted.every((position, index) => position === start + index)) return true
  }

  return false
}

/**
 * Find contiguous same-row blocks for a party, ordered from the lowest extra cost to the highest.
 *
 * Seats the requested party already holds may be included. Seats held by anyone outside the
 * requested party, booked seats and seats held for accessible seating are never offered.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyOption[]> {
  const party = await getPartyPassengers(passengerIds)
  if (!party) return []

  const reservation = await getReservationByCode(party[0]?.reservationCode ?? '')
  if (!reservation || reservation.flight.id !== flightId) return []

  const [map, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map || restrictions.some((restriction) => restriction === null)) return []

  const partyIds = new Set(passengerIds)
  const hasAdult = restrictions.some((restriction) => restriction?.canUseExitRow)
  if (
    restrictions.some((restriction) => restriction?.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const options: SeatPartyOption[] = []

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      if (side.length < passengerIds.length) continue

      for (let start = 0; start <= side.length - passengerIds.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        const seatIds = seats.map((seat) => seat.id)

        if (!isContiguousSeatBlock(seatIds)) continue
        if (
          seats.some(
            (seat) =>
              seat.baseState !== 'available' ||
              (seat.occupantPassengerId !== null &&
                !partyIds.has(seat.occupantPassengerId)),
          )
        ) {
          continue
        }
        if (
          seats.some(
            (seat, index) =>
              seat.isExitRow && restrictions[index]?.canUseExitRow !== true,
          )
        ) {
          continue
        }

        const prices = await Promise.all(
          seatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
        )
        if (prices.some((price) => price === null)) continue

        options.push({
          row: row.row,
          seatIds,
          extraCostCents: prices.reduce<number>(
            (total, price) => total + (price ?? 0),
            0,
          ),
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.row - right.row ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
  )
}

/**
 * Move a party to one contiguous block.
 *
 * Every target is validated before the first move. Moves are dependency ordered, and any
 * successfully completed move is rolled back if a later move fails.
 */
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult> {
  if (passengerIds.length === 0 || passengerIds.length !== seatIds.length) {
    return {
      ok: false,
      reason: 'party_and_seats_required',
      message: 'Choose one seat for every passenger in the party.',
    }
  }

  const party = await getPartyPassengers(passengerIds)
  if (!party) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find every passenger in that party.',
    }
  }

  const normalizedSeatIds = seatIds.map((seatId) => seatId.trim().toUpperCase())
  if (!isContiguousSeatBlock(normalizedSeatIds)) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in the same row on one side of the aisle.',
    }
  }

  const reservation = await getReservationByCode(party[0]?.reservationCode ?? '')
  if (!reservation) {
    return {
      ok: false,
      reason: 'reservation_not_found',
      message: 'We cannot find that reservation.',
    }
  }

  const [map, restrictions] = await Promise.all([
    getSeatMap(reservation.flight.id),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map || restrictions.some((restriction) => restriction === null)) {
    return {
      ok: false,
      reason: 'seat_map_not_found',
      message: 'We cannot load the seat map for this flight.',
    }
  }

  const seatsById = new Map(
    map.rows
      .flatMap((row) => [...row.left, ...row.right])
      .map((seat) => [seat.id, seat] as const),
  )
  const targetSeats = normalizedSeatIds.map((seatId) => seatsById.get(seatId))
  if (targetSeats.some((seat) => seat === undefined)) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }

  const partyIds = new Set(passengerIds)
  const hasAdult = restrictions.some((restriction) => restriction?.canUseExitRow)
  if (
    restrictions.some((restriction) => restriction?.mustSitWithAdult) &&
    !hasAdult
  ) {
    return {
      ok: false,
      reason: 'adult_required',
      message: 'A child in this party must sit with an adult on the same booking.',
    }
  }

  for (let index = 0; index < targetSeats.length; index += 1) {
    const seat = targetSeats[index]
    if (!seat) continue

    if (seat.baseState === 'blocked') {
      return {
        ok: false,
        reason: 'seat_blocked',
        message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another block.`,
      }
    }
    if (seat.baseState === 'booked') {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another block.`,
      }
    }
    if (seat.occupantPassengerId && !partyIds.has(seat.occupantPassengerId)) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} was taken while you were choosing. Please pick another block.`,
      }
    }
    if (seat.isExitRow && restrictions[index]?.canUseExitRow !== true) {
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      }
    }
  }

  const passengerById = new Map(party.map((passenger) => [passenger.id, passenger]))
  const targetByPassenger = new Map(
    passengerIds.map((passengerId, index) => [passengerId, normalizedSeatIds[index] as string]),
  )
  const currentOwnerBySeat = new Map<string, string>()
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) {
      if (seat.occupantPassengerId) {
        currentOwnerBySeat.set(seat.id, seat.occupantPassengerId)
      }
    }
  }

  const remaining = party.filter(
    (passenger) => targetByPassenger.get(passenger.id) !== passenger.seatId,
  )
  const order: Passenger[] = []

  while (remaining.length > 0) {
    const movableIndex = remaining.findIndex((passenger) => {
      const target = targetByPassenger.get(passenger.id)
      if (!target) return false
      const holder = currentOwnerBySeat.get(target)
      return !holder || holder === passenger.id
    })

    if (movableIndex === -1) {
      return {
        ok: false,
        reason: 'seat_swap_not_supported',
        message: 'Those seats cannot be moved in one safe apply. Please choose another block.',
      }
    }

    const [passenger] = remaining.splice(movableIndex, 1)
    if (!passenger) continue

    const target = targetByPassenger.get(passenger.id)
    if (!target) continue

    if (passenger.seatId) currentOwnerBySeat.delete(passenger.seatId)
    currentOwnerBySeat.set(target, passenger.id)
    order.push(passenger)
  }

  const completed: Passenger[] = []
  for (const passenger of order) {
    const target = targetByPassenger.get(passenger.id)
    if (!target) continue

    const result = await assignSeat(passenger.id, target)
    if (!result.ok) {
      for (const movedPassenger of [...completed].reverse()) {
        if (movedPassenger.seatId) {
          await assignSeat(movedPassenger.id, movedPassenger.seatId)
        }
      }
      return {
        ok: false,
        reason: result.reason,
        message: result.message,
      }
    }
    completed.push(passenger)
  }

  return {
    ok: true,
    assignments: passengerIds.map((passengerId) => ({
      passengerId: passengerById.get(passengerId)?.id ?? passengerId,
      seatId: targetByPassenger.get(passengerId) ?? '',
    })),
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
