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
 * The server-side seat primitives and seat-party composition.
 *
 * Each primitive does a single job. `findSeatsForParty` composes the read primitives to rank
 * contiguous blocks, and `assignSeatsForParty` composes validation and assignment so a party moves
 * together or retains its previous seats.
 *
 * `AGENTS.md`, under "Adding seat-party capabilities", describes the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface SeatPartyBlock {
  row: number
  seatIds: string[]
  extraCostCents: number
  totalPriceCents: number
}

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      assignments: AssignSeatResult[]
      totalPriceCents: number
    }
  | {
      ok: false
      reason: string
      message: string
    }

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
 * It moves one passenger. Party moves use `assignSeatsForParty`.
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
 * Find available same-row blocks for a party, ranked by their combined extra cost.
 *
 * A block never crosses the aisle. Passenger restrictions are read for every member of the party,
 * so children are not offered exit rows and a child who must sit with an adult is only searched
 * for with an adult from the same reservation.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyBlock[]>
export async function findSeatsForParty(input: {
  flightId: string
  passengerIds: string[]
}): Promise<SeatPartyBlock[]>
export async function findSeatsForParty(
  flightIdOrInput: string | { flightId: string; passengerIds: string[] },
  providedPassengerIds?: string[],
): Promise<SeatPartyBlock[]> {
  const flightId =
    typeof flightIdOrInput === 'string' ? flightIdOrInput : flightIdOrInput.flightId
  const passengerIds =
    typeof flightIdOrInput === 'string'
      ? (providedPassengerIds ?? [])
      : flightIdOrInput.passengerIds

  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) return []

  const repository = getRepository()
  const [map, availableSeatIds, restrictions, passengerRecords] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
    Promise.all(passengerIds.map((passengerId) => repository.getPassenger(passengerId))),
  ])
  if (!map || restrictions.some((restriction) => restriction === null)) return []
  if (passengerRecords.some((passenger) => passenger === null)) return []

  const passengers = passengerRecords.filter(
    (passenger): passenger is Passenger => passenger !== null,
  )
  const reservationCodes = new Set(passengers.map((passenger) => passenger.reservationCode))
  if (reservationCodes.size !== 1) return []

  const reservationCode = passengers[0]?.reservationCode
  if (!reservationCode) return []
  const reservation = await repository.getReservationByCode(reservationCode)
  if (!reservation || reservation.flightId !== flightId) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const available = new Set(availableSeatIds)
  const blocks: SeatPartyBlock[] = []

  for (const row of map.rows) {
    if (
      row.isExitRow &&
      passengerRestrictions.some((restriction) => !restriction.canUseExitRow)
    ) {
      continue
    }

    for (const side of [row.left, row.right]) {
      for (let start = 0; start + passengerIds.length <= side.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        if (seats.length !== passengerIds.length) continue
        if (seats.some((seat) => !available.has(seat.id))) continue

        const columnIndexes = seats.map((seat) => COLUMNS.indexOf(seat.column))
        if (
          columnIndexes.some(
            (columnIndex, index) =>
              index > 0 && columnIndex !== (columnIndexes[index - 1] ?? columnIndex) + 1,
          )
        ) {
          continue
        }

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const extraCostCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )

        blocks.push({
          row: row.row,
          seatIds: seats.map((seat) => seat.id),
          extraCostCents,
          totalPriceCents: extraCostCents,
        })
      }
    }
  }

  blocks.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
  )
  return blocks
}

function partyFailure(reason: string, message: string): AssignSeatsForPartyResult {
  return { ok: false, reason, message }
}

function arePartySeatsContiguous(seats: Seat[]): boolean {
  if (seats.length === 0) return false
  const row = seats[0]?.row
  if (row === undefined || seats.some((seat) => seat.row !== row)) return false

  const allLeft = seats.every((seat) => LEFT_COLUMNS.includes(seat.column))
  const allRight = seats.every((seat) => RIGHT_COLUMNS.includes(seat.column))
  if (!allLeft && !allRight) return false

  const indexes = seats.map((seat) => COLUMNS.indexOf(seat.column)).sort((left, right) => left - right)
  return indexes.every((columnIndex, index) => index === 0 || columnIndex === indexes[index - 1]! + 1)
}

export async function assignSeatsForParty(
  flightId: string,
  assignments: PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  assignments: PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightIdOrAssignmentsOrPassengerIds: string | PartySeatAssignment[] | string[],
  assignmentsOrSeatIds?: PartySeatAssignment[] | string[],
  providedSeatIds?: string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string | null = null
  let assignments: PartySeatAssignment[]

  if (typeof flightIdOrAssignmentsOrPassengerIds === 'string') {
    flightId = flightIdOrAssignmentsOrPassengerIds
    if (providedSeatIds) {
      const passengerIds = assignmentsOrSeatIds as string[] | undefined
      assignments = (passengerIds ?? []).map((passengerId, index) => ({
        passengerId,
        seatId: providedSeatIds[index] ?? '',
      }))
    } else {
      assignments = (assignmentsOrSeatIds as PartySeatAssignment[] | undefined) ?? []
    }
  } else if (
    flightIdOrAssignmentsOrPassengerIds.every(
      (value): value is PartySeatAssignment =>
        typeof value === 'object' &&
        value !== null &&
        'passengerId' in value &&
        'seatId' in value,
    )
  ) {
    assignments = flightIdOrAssignmentsOrPassengerIds
  } else {
    const passengerIds = flightIdOrAssignmentsOrPassengerIds as string[]
    const seatIds = (assignmentsOrSeatIds as string[] | undefined) ?? []
    assignments = passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  }

  if (assignments.length === 0) {
    return partyFailure('assignments_required', 'Choose seats for every passenger first.')
  }

  const normalizedAssignments = assignments.map((assignment) => ({
    passengerId: assignment.passengerId.trim(),
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
  if (
    normalizedAssignments.some(
      (assignment) => !assignment.passengerId || !parseSeatId(assignment.seatId),
    )
  ) {
    return partyFailure(
      'passengerId_and_seatId_required',
      'Choose a valid seat for every passenger.',
    )
  }

  const passengerIds = normalizedAssignments.map((assignment) => assignment.passengerId)
  const seatIds = normalizedAssignments.map((assignment) => assignment.seatId)
  if (new Set(passengerIds).size !== passengerIds.length) {
    return partyFailure(
      'duplicate_passenger',
      'Each passenger can have only one seat in a family block.',
    )
  }
  if (new Set(seatIds).size !== seatIds.length) {
    return partyFailure(
      'duplicate_seat',
      'Each passenger needs a different seat in the family block.',
    )
  }

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) {
    return partyFailure('passenger_not_found', 'We cannot find one of those passengers.')
  }

  const foundPassengers = passengers.filter(
    (passenger): passenger is Passenger => passenger !== null,
  )
  const reservationCodes = new Set(
    foundPassengers.map((passenger) => passenger.reservationCode),
  )
  if (reservationCodes.size !== 1) {
    return partyFailure(
      'passengers_not_in_same_party',
      'All passengers must be on the same booking.',
    )
  }

  const reservationCode = foundPassengers[0]?.reservationCode
  if (!reservationCode) {
    return partyFailure('passenger_not_found', 'We cannot find one of those passengers.')
  }
  const reservationRecord = await repository.getReservationByCode(reservationCode)
  if (!reservationRecord) {
    return partyFailure('passenger_not_found', 'We cannot find one of those passengers.')
  }
  if (flightId && reservationRecord.flightId !== flightId) {
    return partyFailure(
      'flight_mismatch',
      'Those passengers are not booked on this flight.',
    )
  }
  flightId = reservationRecord.flightId

  const [map, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map) {
    return partyFailure('flight_not_found', 'We cannot find that flight.')
  }
  if (restrictions.some((restriction) => restriction === null)) {
    return partyFailure('passenger_not_found', 'We cannot find one of those passengers.')
  }

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !passengerRestrictions.some((restriction) => restriction.type === 'adult')
  ) {
    return partyFailure(
      'adult_required',
      'A child under 13 must sit with an adult on the same booking.',
    )
  }

  const seatById = new Map<string, Seat>()
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
  }

  const selectedSeats: Seat[] = []
  for (const assignment of normalizedAssignments) {
    const seat = seatById.get(assignment.seatId)
    if (!seat) {
      return partyFailure(
        'seat_not_found',
        `Seat ${assignment.seatId} is not on this aircraft.`,
      )
    }
    selectedSeats.push(seat)
  }

  if (!arePartySeatsContiguous(selectedSeats)) {
    return partyFailure(
      'seats_not_together',
      'Choose consecutive seats in one row on the same side of the aisle.',
    )
  }

  const partyIdSet = new Set(passengerIds)
  for (const seat of selectedSeats) {
    if (seat.baseState === 'blocked') {
      return partyFailure(
        'seat_blocked',
        `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another block.`,
      )
    }
    if (
      seat.baseState === 'booked' ||
      (seat.occupantPassengerId !== null && !partyIdSet.has(seat.occupantPassengerId))
    ) {
      return partyFailure(
        'seat_booked',
        `Seat ${seat.id} was taken while you were choosing. Please pick another block.`,
      )
    }
  }

  for (let index = 0; index < normalizedAssignments.length; index += 1) {
    const restriction = passengerRestrictions[index]
    const seat = selectedSeats[index]
    if (restriction && seat?.isExitRow && !restriction.canUseExitRow) {
      const passenger = foundPassengers[index]
      return partyFailure(
        'exit_row_child',
        `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger?.firstName ?? 'this passenger'} cannot sit there.`,
      )
    }
  }

  const previousSeatByPassenger = new Map<string, string | null>()
  const occupantBySeat = new Map<string, string>()
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) {
      if (seat.occupantPassengerId) {
        occupantBySeat.set(seat.id, seat.occupantPassengerId)
        if (partyIdSet.has(seat.occupantPassengerId)) {
          previousSeatByPassenger.set(seat.occupantPassengerId, seat.id)
        }
      }
    }
  }
  for (const passengerId of passengerIds) {
    if (!previousSeatByPassenger.has(passengerId)) {
      previousSeatByPassenger.set(passengerId, null)
    }
  }

  const remaining = normalizedAssignments.filter(
    (assignment) => previousSeatByPassenger.get(assignment.passengerId) !== assignment.seatId,
  )
  const ordered: PartySeatAssignment[] = []

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((assignment) => {
      const occupant = occupantBySeat.get(assignment.seatId)
      return !occupant || occupant === assignment.passengerId
    })
    if (nextIndex === -1) {
      return partyFailure(
        'party_move_conflict',
        'We cannot complete that seat swap safely. Please choose another block.',
      )
    }

    const [next] = remaining.splice(nextIndex, 1)
    if (!next) break

    const previousSeatId = previousSeatByPassenger.get(next.passengerId)
    if (previousSeatId) occupantBySeat.delete(previousSeatId)
    occupantBySeat.set(next.seatId, next.passengerId)
    ordered.push(next)
  }

  const completed: Array<{ assignment: PartySeatAssignment; result: AssignSeatResult }> = []
  for (const assignment of ordered) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const completedMove of [...completed].reverse()) {
        const previousSeatId = previousSeatByPassenger.get(
          completedMove.assignment.passengerId,
        )
        if (previousSeatId) {
          await assignSeat(completedMove.assignment.passengerId, previousSeatId)
        }
      }
      return partyFailure(result.reason, result.message)
    }
    completed.push({ assignment, result })
  }

  const prices = await Promise.all(
    selectedSeats.map((seat) => calculateSeatPrice(flightId, seat.id)),
  )

  return {
    ok: true,
    assignments: completed.map((entry) => entry.result),
    totalPriceCents: prices.reduce<number>(
      (total, price) => total + (price ?? 0),
      0,
    ),
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
