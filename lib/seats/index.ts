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
  AssignSeatsForPartyResult,
  Passenger,
  PassengerRestrictions,
  Reservation,
  Seat,
  SeatMap,
  SeatPartyAssignment,
  SeatPartyOption,
  SeatRow,
  SeatState,
} from './types'

/**
 * The server-side seat domain.
 *
 * The seven primitives each do one job. `findSeatsForParty` and `assignSeatsForParty` deliberately
 * compose those primitives to recommend ranked adjacent blocks and apply a whole-party move.
 * `tests/seat-party.test.ts` enforces the composition's seating and atomicity rules.
 */

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
 * This primitive moves one passenger; `assignSeatsForParty` composes it for a whole-party move.
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

function consecutiveSeats(seats: Seat[]): boolean {
  if (seats.length < 2) return true
  return seats.every((seat, index) => {
    if (index === 0) return true
    const previous = seats[index - 1]
    if (!previous) return false
    return COLUMNS.indexOf(seat.column) === COLUMNS.indexOf(previous.column) + 1
  })
}

async function resolveSearchParty(
  flightOrReservationId: string,
  party?: readonly string[] | string,
): Promise<{ flightId: string; passengerIds: string[] } | null> {
  if (Array.isArray(party)) {
    return {
      flightId: flightOrReservationId,
      passengerIds: [...party],
    }
  }

  const reservationCode = typeof party === 'string' ? party : flightOrReservationId
  const reservation = await getReservationByCode(reservationCode)
  if (!reservation) return null

  if (typeof party === 'string' && reservation.flight.id !== flightOrReservationId) return null

  return {
    flightId: reservation.flight.id,
    passengerIds: reservation.passengers.map((passenger) => passenger.id),
  }
}

/**
 * Find available adjacent blocks for a party.
 *
 * Every option is in one row, stays on one side of the aisle, satisfies each passenger's
 * restrictions, and is ranked by total extra cost.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: readonly string[],
): Promise<SeatPartyOption[]>
export async function findSeatsForParty(reservationCode: string): Promise<SeatPartyOption[]>
export async function findSeatsForParty(
  flightId: string,
  reservationCode: string,
): Promise<SeatPartyOption[]>
export async function findSeatsForParty(
  flightOrReservationId: string,
  party?: readonly string[] | string,
): Promise<SeatPartyOption[]> {
  const resolved = await resolveSearchParty(flightOrReservationId, party)
  if (!resolved || resolved.passengerIds.length === 0 || resolved.passengerIds.length > 3) return []

  const uniquePassengerIds = new Set(resolved.passengerIds)
  if (uniquePassengerIds.size !== resolved.passengerIds.length) return []

  const [seatMap, availableSeatIds, restrictions] = await Promise.all([
    getSeatMap(resolved.flightId),
    getAvailableSeats(resolved.flightId),
    Promise.all(resolved.passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!seatMap || restrictions.some((restriction) => restriction === null)) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const includesAdult = passengerRestrictions.some(
    (restriction) => restriction.type === 'adult',
  )
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !includesAdult
  ) {
    return []
  }

  const available = new Set(availableSeatIds)
  const options: SeatPartyOption[] = []

  for (const row of seatMap.rows) {
    if (
      row.isExitRow &&
      passengerRestrictions.some((restriction) => !restriction.canUseExitRow)
    ) {
      continue
    }

    for (const side of [row.left, row.right]) {
      for (
        let start = 0;
        start + resolved.passengerIds.length <= side.length;
        start += 1
      ) {
        const block = side.slice(start, start + resolved.passengerIds.length)
        if (
          block.length !== resolved.passengerIds.length ||
          !consecutiveSeats(block) ||
          block.some((seat) => seat.state !== 'available' || !available.has(seat.id))
        ) {
          continue
        }

        const prices = await Promise.all(
          block.map((seat) => calculateSeatPrice(resolved.flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const totalPriceCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )
        const option = {
          row: row.row,
          seatIds: block.map((seat) => seat.id),
          assignments: resolved.passengerIds.map((passengerId, index) => ({
            passengerId,
            seatId: block[index]?.id ?? '',
          })),
          totalPriceCents,
          extraCostCents: totalPriceCents,
        }
        options.push(option)
      }
    }
  }

  return options.sort(
    (first, second) =>
      first.totalPriceCents - second.totalPriceCents ||
      first.row - second.row ||
      first.seatIds.join(',').localeCompare(second.seatIds.join(',')),
  )
}

async function resolveAssignmentReservation(
  identifier: string,
  assignments: readonly SeatPartyAssignment[],
): Promise<Reservation | null> {
  const reservation = await getReservationByCode(identifier)
  if (reservation) return reservation

  const firstAssignment = assignments[0]
  if (!firstAssignment) return null

  const passenger = await getRepository().getPassenger(firstAssignment.passengerId)
  if (!passenger) return null

  const passengerReservation = await getReservationByCode(passenger.reservationCode)
  if (!passengerReservation || passengerReservation.flight.id !== identifier) return null
  return passengerReservation
}

async function resolveReservationFromAssignments(
  assignments: readonly SeatPartyAssignment[],
): Promise<Reservation | null> {
  const firstAssignment = assignments[0]
  if (!firstAssignment) return null

  const passenger = await getRepository().getPassenger(firstAssignment.passengerId)
  if (!passenger) return null

  return getReservationByCode(passenger.reservationCode)
}

function isSeatPartyAssignment(value: unknown): value is SeatPartyAssignment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'passengerId' in value &&
    typeof value.passengerId === 'string' &&
    'seatId' in value &&
    typeof value.seatId === 'string'
  )
}

async function restoreAssignments(
  completed: readonly {
    passengerId: string
    previousSeatId: string | null
  }[],
): Promise<void> {
  for (const assignment of [...completed].reverse()) {
    if (!assignment.previousSeatId) continue
    await assignSeat(assignment.passengerId, assignment.previousSeatId)
  }
}

/**
 * Apply one adjacent seat block to an entire reservation party.
 *
 * The request is validated before any passenger moves. If a write still fails, successful writes
 * are restored in reverse order so every passenger keeps the seat they had before the attempt.
 */
export async function assignSeatsForParty(
  assignments: readonly SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  passengerIds: readonly string[],
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  reservationCode: string,
  assignments: readonly SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightId: string,
  reservationCode: string,
  assignments: readonly SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  identifier: string | readonly string[] | readonly SeatPartyAssignment[],
  assignmentsOrReservationCode?: readonly SeatPartyAssignment[] | readonly string[] | string,
  possibleAssignments?: readonly SeatPartyAssignment[],
): Promise<AssignSeatsForPartyResult> {
  let assignments: readonly SeatPartyAssignment[]
  let reservation: Reservation | null
  let expectedFlightId: string | null = null

  if (typeof identifier === 'string') {
    assignments = Array.isArray(assignmentsOrReservationCode)
      ? assignmentsOrReservationCode.filter(isSeatPartyAssignment)
      : possibleAssignments ?? []
    const reservationIdentifier =
      typeof assignmentsOrReservationCode === 'string'
        ? assignmentsOrReservationCode
        : identifier
    expectedFlightId =
      typeof assignmentsOrReservationCode === 'string' ? identifier : null
    reservation = await resolveAssignmentReservation(reservationIdentifier, assignments)
  } else if (identifier.every(isSeatPartyAssignment)) {
    assignments = identifier
    reservation = await resolveReservationFromAssignments(assignments)
  } else {
    const passengerIds = identifier.filter(
      (passengerId): passengerId is string => typeof passengerId === 'string',
    )
    const seatIds = Array.isArray(assignmentsOrReservationCode)
      ? assignmentsOrReservationCode.filter(
          (seatId): seatId is string => typeof seatId === 'string',
        )
      : []
    assignments = passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
    reservation = await resolveReservationFromAssignments(assignments)
  }

  if (!reservation || (expectedFlightId !== null && reservation.flight.id !== expectedFlightId)) {
    return {
      ok: false,
      reason: 'reservation_not_found',
      message: 'We cannot find that reservation.',
    }
  }

  if (assignments.length === 0 || assignments.length !== reservation.passengers.length) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'Choose one seat for every passenger on this booking.',
    }
  }

  const passengerIds = new Set(reservation.passengers.map((passenger) => passenger.id))
  const assignedPassengerIds = new Set(assignments.map((assignment) => assignment.passengerId))
  const normalizedAssignments = assignments.map((assignment) => ({
    passengerId: assignment.passengerId,
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
  const assignedSeatIds = new Set(normalizedAssignments.map((assignment) => assignment.seatId))

  if (
    assignedPassengerIds.size !== assignments.length ||
    assignedSeatIds.size !== assignments.length ||
    assignedPassengerIds.size !== passengerIds.size ||
    [...assignedPassengerIds].some((passengerId) => !passengerIds.has(passengerId)) ||
    normalizedAssignments.some((assignment) => !parseSeatId(assignment.seatId))
  ) {
    return {
      ok: false,
      reason: 'invalid_assignment',
      message: 'Choose one different seat for each passenger on this booking.',
    }
  }

  const [seatMap, restrictions] = await Promise.all([
    getSeatMap(reservation.flight.id),
    Promise.all(
      normalizedAssignments.map((assignment) =>
        getPassengerRestrictions(assignment.passengerId),
      ),
    ),
  ])
  if (!seatMap || restrictions.some((restriction) => restriction === null)) {
    return {
      ok: false,
      reason: 'invalid_assignment',
      message: 'We could not validate those passenger and seat choices.',
    }
  }

  const seatById = new Map<string, Seat>()
  for (const row of seatMap.rows) {
    for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
  }

  const selectedSeats = normalizedAssignments
    .map((assignment) => seatById.get(assignment.seatId))
    .filter((seat): seat is Seat => seat !== undefined)

  if (selectedSeats.length !== normalizedAssignments.length) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }

  const rows = new Set(selectedSeats.map((seat) => seat.row))
  const selectedColumns = selectedSeats
    .map((seat) => COLUMNS.indexOf(seat.column))
    .sort((first, second) => first - second)
  const oneSideOfAisle =
    selectedSeats.every((seat) => LEFT_COLUMNS.includes(seat.column)) ||
    selectedSeats.every((seat) => RIGHT_COLUMNS.includes(seat.column))
  const consecutive = selectedColumns.every(
    (column, index) => index === 0 || column === selectedColumns[index - 1]! + 1,
  )

  if (rows.size !== 1 || !oneSideOfAisle || !consecutive) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in the same row on one side of the aisle.',
    }
  }

  for (const assignment of normalizedAssignments) {
    const seat = seatById.get(assignment.seatId)
    const restriction = restrictions.find(
      (entry) => entry?.passengerId === assignment.passengerId,
    )
    if (!seat || !restriction) {
      return {
        ok: false,
        reason: 'invalid_assignment',
        message: 'We could not validate those passenger and seat choices.',
      }
    }

    if (seat.baseState === 'blocked') {
      return {
        ok: false,
        reason: 'seat_blocked',
        message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
      }
    }
    if (
      seat.baseState === 'booked' ||
      (seat.occupantPassengerId !== null &&
        seat.occupantPassengerId !== assignment.passengerId)
    ) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another seat.`,
      }
    }
    if (seat.isExitRow && !restriction.canUseExitRow) {
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      }
    }
  }

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !passengerRestrictions.some((restriction) => restriction.type === 'adult')
  ) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'A child under 13 must sit with an adult on the same booking.',
    }
  }

  const passengerById = new Map(
    reservation.passengers.map((passenger) => [passenger.id, passenger]),
  )
  const orderedAssignments = [...normalizedAssignments].sort((first, second) => {
    const firstPassenger = passengerById.get(first.passengerId)
    const secondPassenger = passengerById.get(second.passengerId)
    const firstHasSeat = firstPassenger?.seatId ? 0 : 1
    const secondHasSeat = secondPassenger?.seatId ? 0 : 1
    return firstHasSeat - secondHasSeat
  })
  const completed: {
    passengerId: string
    previousSeatId: string | null
  }[] = []

  for (const assignment of orderedAssignments) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      await restoreAssignments(completed)
      return {
        ok: false,
        reason: result.reason,
        message: result.message,
      }
    }
    completed.push({
      passengerId: result.passengerId,
      previousSeatId: result.previousSeatId,
    })
  }

  return {
    ok: true,
    assignments: normalizedAssignments,
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
