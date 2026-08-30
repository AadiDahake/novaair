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
 * The server-side seat primitives and seat-party compositions.
 *
 * The primitives each do a single job. `findSeatsForParty` and `assignSeatsForParty` deliberately
 * compose them to find ranked blocks and move a whole party while preserving the cabin and
 * passenger rules documented in `AGENTS.md`.
 */

export interface SeatPartyBlock {
  seatIds: string[]
  seats: string[]
  row: number
  totalPriceCents: number
  priceCents: number
  additionalCostCents: number
  extraCostCents: number
}

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export interface PartyAssignmentRequest {
  flightId?: string
  passengerIds?: string[]
  seatIds?: string[]
  assignments?: PartySeatAssignment[]
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      flightId: string
      seatIds: string[]
      totalPriceCents: number
      assignments: AssignSeatResult[]
      results: AssignSeatResult[]
    }
  | {
      ok: false
      reason:
        | 'invalid_passengers'
        | 'invalid_seat_block'
        | 'seat_unavailable'
        | 'assignment_failed'
      error:
        | 'invalid_passengers'
        | 'invalid_seat_block'
        | 'seat_unavailable'
        | 'assignment_failed'
      message: string
      cause?: AssignSeatResult
    }

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

function partyFailure(
  reason:
    | 'invalid_passengers'
    | 'invalid_seat_block'
    | 'seat_unavailable'
    | 'assignment_failed',
  message: string,
  cause?: AssignSeatResult,
): AssignSeatsForPartyResult {
  return cause
    ? { ok: false, reason, error: reason, message, cause }
    : { ok: false, reason, error: reason, message }
}

function normalizedUniqueIds(ids: string[]): string[] | null {
  const normalized = ids.map((id) => id.trim()).filter(Boolean)
  return normalized.length === ids.length && new Set(normalized).size === normalized.length
    ? normalized
    : null
}

function normalizedUniqueSeatIds(ids: string[]): string[] | null {
  const normalized = ids.map((id) => id.trim().toUpperCase()).filter(Boolean)
  return normalized.length === ids.length &&
    normalized.every((id) => parseSeatId(id) !== null) &&
    new Set(normalized).size === normalized.length
    ? normalized
    : null
}

function seatsFormBlock(seatIds: string[]): boolean {
  if (seatIds.length === 0) return false

  const parsed = seatIds.map((seatId) => parseSeatId(seatId))
  if (parsed.some((seat) => seat === null)) return false

  const seats = parsed.filter((seat): seat is NonNullable<typeof seat> => seat !== null)
  const row = seats[0]?.row
  if (row === undefined || seats.some((seat) => seat.row !== row)) return false

  const columns = seats.map((seat) => seat.column)
  const onLeft = columns.every((column) => LEFT_COLUMNS.includes(column))
  const onRight = columns.every((column) => RIGHT_COLUMNS.includes(column))
  if (!onLeft && !onRight) return false

  const side = onLeft ? LEFT_COLUMNS : RIGHT_COLUMNS
  const indexes = columns.map((column) => side.indexOf(column)).sort((a, b) => a - b)
  return indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1)
}

function allSeats(map: SeatMap): Seat[] {
  return map.rows.flatMap((row) => [...row.left, ...row.right])
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
 * It moves one passenger. Party moves are composed by `assignSeatsForParty`.
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

/**
 * Find valid same-row blocks for a party, with the cheapest total extra cost first.
 *
 * Seats already held by somebody in the requested party may be included. Seats held by anybody
 * else, booked seats and seats held for accessible seating are excluded.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyBlock[]> {
  const normalizedPassengerIds = normalizedUniqueIds(passengerIds)
  if (!normalizedPassengerIds || normalizedPassengerIds.length === 0) return []
  if (normalizedPassengerIds.length > LEFT_COLUMNS.length) return []

  const repository = getRepository()
  const [map, passengers, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(normalizedPassengerIds.map((passengerId) => repository.getPassenger(passengerId))),
    Promise.all(normalizedPassengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map || passengers.some((passenger) => passenger === null)) return []
  if (restrictions.some((restriction) => restriction === null)) return []

  const validPassengers = passengers.filter((passenger): passenger is Passenger => passenger !== null)
  const validRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const reservationCodes = new Set(validPassengers.map((passenger) => passenger.reservationCode))
  if (reservationCodes.size !== 1) return []

  const reservation = await repository.getReservationByCode(validPassengers[0]!.reservationCode)
  if (!reservation || reservation.flightId !== flightId) return []

  const hasAdult = validRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    validRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const party = new Set(normalizedPassengerIds)
  const blocks: SeatPartyBlock[] = []

  for (const row of map.rows) {
    if (
      row.isExitRow &&
      validRestrictions.some((restriction) => !restriction.canUseExitRow)
    ) {
      continue
    }

    for (const side of [row.left, row.right]) {
      for (let start = 0; start <= side.length - normalizedPassengerIds.length; start += 1) {
        const seats = side.slice(start, start + normalizedPassengerIds.length)
        if (seats.length !== normalizedPassengerIds.length) continue
        if (
          seats.some(
            (seat) =>
              seat.baseState !== 'available' ||
              (seat.occupantPassengerId !== null && !party.has(seat.occupantPassengerId)),
          )
        ) {
          continue
        }

        const seatIds = seats.map((seat) => seat.id)
        if (!seatsFormBlock(seatIds)) continue

        const prices = await Promise.all(
          seatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
        )
        if (prices.some((price) => price === null)) continue

        const totalPriceCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )
        blocks.push({
          seatIds,
          seats: seatIds,
          row: row.row,
          totalPriceCents,
          priceCents: totalPriceCents,
          additionalCostCents: totalPriceCents,
          extraCostCents: totalPriceCents,
        })
      }
    }
  }

  return blocks.sort((left, right) => {
    if (left.totalPriceCents !== right.totalPriceCents) {
      return left.totalPriceCents - right.totalPriceCents
    }

    const leftFirst = parseSeatId(left.seatIds[0] ?? '')
    const rightFirst = parseSeatId(right.seatIds[0] ?? '')
    if (!leftFirst || !rightFirst) return 0
    if (leftFirst.row !== rightFirst.row) return leftFirst.row - rightFirst.row
    return COLUMNS.indexOf(leftFirst.column) - COLUMNS.indexOf(rightFirst.column)
  })
}

export function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  flightId: string,
  assignments: PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  assignments: PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  request: PartyAssignmentRequest,
): Promise<AssignSeatsForPartyResult>
/**
 * Move a party into one valid block.
 *
 * Every target is validated before the first write. Writes are ordered so a passenger leaves a
 * seat before another party member takes it. If a write fails, completed writes are rolled back
 * before the failure is returned.
 */
export async function assignSeatsForParty(
  first: string | string[] | PartySeatAssignment[] | PartyAssignmentRequest,
  second?: string[] | PartySeatAssignment[],
  third?: string[],
): Promise<AssignSeatsForPartyResult> {
  let requestedFlightId: string | undefined
  let rawPassengerIds: string[] = []
  let rawSeatIds: string[] = []

  if (typeof first === 'string') {
    requestedFlightId = first
    if (third) {
      rawPassengerIds = Array.isArray(second) ? (second as string[]) : []
      rawSeatIds = third
    } else {
      const assignments = Array.isArray(second) ? (second as PartySeatAssignment[]) : []
      rawPassengerIds = assignments.map((assignment) => assignment.passengerId)
      rawSeatIds = assignments.map((assignment) => assignment.seatId)
    }
  } else if (Array.isArray(first)) {
    if (second) {
      rawPassengerIds = first as string[]
      rawSeatIds = second as string[]
    } else {
      const assignments = first as PartySeatAssignment[]
      rawPassengerIds = assignments.map((assignment) => assignment.passengerId)
      rawSeatIds = assignments.map((assignment) => assignment.seatId)
    }
  } else {
    requestedFlightId = first.flightId
    if (first.assignments) {
      rawPassengerIds = first.assignments.map((assignment) => assignment.passengerId)
      rawSeatIds = first.assignments.map((assignment) => assignment.seatId)
    } else {
      rawPassengerIds = first.passengerIds ?? []
      rawSeatIds = first.seatIds ?? []
    }
  }

  const passengerIds = normalizedUniqueIds(rawPassengerIds)
  if (!passengerIds || passengerIds.length === 0) {
    return partyFailure(
      'invalid_passengers',
      'Choose at least one valid passenger before finding seats together.',
    )
  }

  const seatIds = normalizedUniqueSeatIds(rawSeatIds)
  if (!seatIds || seatIds.length !== passengerIds.length || !seatsFormBlock(seatIds)) {
    return partyFailure(
      'invalid_seat_block',
      'Choose one consecutive block of seats in the same row and on the same side of the aisle.',
    )
  }

  const repository = getRepository()
  const [passengers, restrictions] = await Promise.all([
    Promise.all(passengerIds.map((passengerId) => repository.getPassenger(passengerId))),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (
    passengers.some((passenger) => passenger === null) ||
    restrictions.some((restriction) => restriction === null)
  ) {
    return partyFailure(
      'invalid_passengers',
      'One or more passengers could not be found. Please reopen your trip and try again.',
    )
  }

  const validPassengers = passengers.filter((passenger): passenger is Passenger => passenger !== null)
  const validRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const reservationCodes = new Set(validPassengers.map((passenger) => passenger.reservationCode))
  if (reservationCodes.size !== 1) {
    return partyFailure(
      'invalid_passengers',
      'All passengers must be on the same booking to choose seats together.',
    )
  }

  const reservation = await repository.getReservationByCode(validPassengers[0]!.reservationCode)
  if (!reservation) {
    return partyFailure(
      'invalid_passengers',
      'We could not find the booking for these passengers.',
    )
  }

  const flightId = requestedFlightId ?? reservation.flightId
  if (flightId !== reservation.flightId) {
    return partyFailure(
      'invalid_passengers',
      'These passengers are not traveling on this flight.',
    )
  }

  const hasAdult = validRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    validRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return partyFailure(
      'invalid_passengers',
      'A child under 13 must be seated with an adult from the same booking.',
    )
  }

  const map = await getSeatMap(flightId)
  if (!map) {
    return partyFailure('invalid_seat_block', 'We could not find the seat map for this flight.')
  }

  const seatById = new Map(allSeats(map).map((seat) => [seat.id, seat]))
  const targetSeats = seatIds.map((seatId) => seatById.get(seatId))
  if (targetSeats.some((seat) => seat === undefined)) {
    return partyFailure(
      'invalid_seat_block',
      'One or more selected seats are not on this aircraft.',
    )
  }

  const party = new Set(passengerIds)
  for (let index = 0; index < targetSeats.length; index += 1) {
    const seat = targetSeats[index]
    const restriction = validRestrictions[index]
    if (!seat || !restriction) {
      return partyFailure('invalid_seat_block', 'The selected seat block is not valid.')
    }
    if (
      seat.baseState !== 'available' ||
      (seat.occupantPassengerId !== null && !party.has(seat.occupantPassengerId))
    ) {
      return partyFailure(
        'seat_unavailable',
        `Seat ${seat.id} is no longer available. Please find another block.`,
      )
    }
    if (seat.isExitRow && !restriction.canUseExitRow) {
      return partyFailure(
        'invalid_seat_block',
        `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      )
    }
  }

  const targetByPassenger = new Map(
    passengerIds.map((passengerId, index) => [passengerId, seatIds[index]!]),
  )
  const currentSeatByPassenger = new Map(
    validPassengers.map((passenger) => [passenger.id, passenger.seatId]),
  )
  const currentOwnerBySeat = new Map<string, string>()
  for (const passenger of validPassengers) {
    if (passenger.seatId) currentOwnerBySeat.set(passenger.seatId, passenger.id)
  }

  const remaining = validPassengers.filter(
    (passenger) => targetByPassenger.get(passenger.id) !== passenger.seatId,
  )
  const ordered: Passenger[] = []

  while (remaining.length > 0) {
    const movableIndex = remaining.findIndex((passenger) => {
      const target = targetByPassenger.get(passenger.id)
      if (!target) return false
      const holder = currentOwnerBySeat.get(target)
      return !holder || holder === passenger.id
    })

    if (movableIndex === -1) {
      return partyFailure(
        'assignment_failed',
        'These seats require passengers to swap places directly. Please choose another block.',
      )
    }

    const [passenger] = remaining.splice(movableIndex, 1)
    if (!passenger) break

    if (passenger.seatId) currentOwnerBySeat.delete(passenger.seatId)
    const target = targetByPassenger.get(passenger.id)
    if (target) currentOwnerBySeat.set(target, passenger.id)
    ordered.push(passenger)
  }

  const completed: Array<{ passenger: Passenger; result: AssignSeatResult }> = []
  const resultByPassenger = new Map<string, AssignSeatResult>()

  for (const passenger of ordered) {
    const target = targetByPassenger.get(passenger.id)
    if (!target) continue

    const result = await assignSeat(passenger.id, target)
    if (!result.ok) {
      for (const completedMove of [...completed].reverse()) {
        const previousSeatId =
          completedMove.result.ok
            ? completedMove.result.previousSeatId
            : currentSeatByPassenger.get(completedMove.passenger.id)
        if (previousSeatId) {
          await assignSeat(completedMove.passenger.id, previousSeatId)
        }
      }

      return partyFailure(
        'assignment_failed',
        result.message || 'We could not save all seats together. No seats were changed.',
        result,
      )
    }

    completed.push({ passenger, result })
    resultByPassenger.set(passenger.id, result)
  }

  for (const passenger of validPassengers) {
    if (resultByPassenger.has(passenger.id)) continue
    const seatId = targetByPassenger.get(passenger.id)
    if (!seatId) continue
    const priceCents = await calculateSeatPrice(flightId, seatId)
    resultByPassenger.set(passenger.id, {
      ok: true,
      passengerId: passenger.id,
      seatId,
      previousSeatId: passenger.seatId,
      priceCents: priceCents ?? 0,
    })
  }

  const results = passengerIds
    .map((passengerId) => resultByPassenger.get(passengerId))
    .filter((result): result is AssignSeatResult => result !== undefined)
  const prices = await Promise.all(
    seatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
  )
  const totalPriceCents = prices.reduce<number>(
    (total, price) => total + (price ?? 0),
    0,
  )

  return {
    ok: true,
    flightId,
    seatIds,
    totalPriceCents,
    assignments: results,
    results,
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

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
