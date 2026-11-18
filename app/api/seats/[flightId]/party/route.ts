import {
  assignSeatsForParty,
  calculateSeatPrice,
  findSeatsForParty,
  getPassengerRestrictions,
  getSeatMap,
  type PartySeatAssignment,
  type PartySeatOption,
} from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function jsonError(error: string, message: string, status: number): Response {
  return Response.json({ error, message }, { status })
}

function readPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const values = [
    ...searchParams.getAll('passengerId'),
    ...searchParams.getAll('passengerIds'),
  ]

  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAssignments(value: unknown): PartySeatAssignment[] | null {
  if (!isRecord(value) || !Array.isArray(value.assignments)) return null

  const assignments: PartySeatAssignment[] = []
  for (const assignment of value.assignments) {
    if (
      !isRecord(assignment) ||
      typeof assignment.passengerId !== 'string' ||
      typeof assignment.seatId !== 'string' ||
      !assignment.passengerId.trim() ||
      !assignment.seatId.trim()
    ) {
      return null
    }

    assignments.push({
      passengerId: assignment.passengerId.trim(),
      seatId: assignment.seatId.trim(),
    })
  }

  return assignments.length > 0 ? assignments : null
}

async function normalizePartyOption(
  flightId: string,
  option: PartySeatOption,
): Promise<PartySeatOption> {
  const parsedRow = Number.parseInt(option.seatIds[0] ?? '', 10)
  const prices = await Promise.all(
    option.seatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
  )
  const extraCostCents = prices.reduce<number>(
    (total, price) => total + (price ?? 0),
    0,
  )

  return {
    seatIds: [...option.seatIds],
    row: Number.isFinite(option.row) ? option.row : parsedRow,
    extraCostCents,
    totalPriceCents: extraCostCents,
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { flightId: rawFlightId } = await context.params
  const flightId = rawFlightId.trim()
  const passengerIds = readPassengerIds(request)

  if (passengerIds.length === 0) {
    return jsonError(
      'passenger_ids_required',
      'Choose the passengers who need seats together.',
      400,
    )
  }

  if (new Set(passengerIds).size !== passengerIds.length) {
    return jsonError(
      'duplicate_passenger',
      'Choose each passenger only once.',
      400,
    )
  }

  const seatMap = await getSeatMap(flightId)
  if (!seatMap) {
    return jsonError('flight_not_found', 'We cannot find that flight.', 404)
  }

  const restrictions = await Promise.all(
    passengerIds.map((passengerId) => getPassengerRestrictions(passengerId)),
  )
  if (restrictions.some((restriction) => restriction === null)) {
    return jsonError('passenger_not_found', 'We cannot find that passenger.', 404)
  }

  const foundOptions = await findSeatsForParty(flightId, passengerIds)
  const options = await Promise.all(
    foundOptions.map((option) => normalizePartyOption(flightId, option)),
  )
  options.sort((left, right) => {
    if (left.extraCostCents !== right.extraCostCents) {
      return left.extraCostCents - right.extraCostCents
    }
    if (left.row !== right.row) return left.row - right.row
    return (left.seatIds[0] ?? '').localeCompare(right.seatIds[0] ?? '')
  })

  return Response.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { flightId: rawFlightId } = await context.params
  const flightId = rawFlightId.trim()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('invalid_json', 'Send a valid JSON request body.', 400)
  }

  const assignments = readAssignments(body)
  if (!assignments) {
    return jsonError(
      'assignments_required',
      'Choose one seat for each passenger in the party.',
      400,
    )
  }

  const result = await assignSeatsForParty(flightId, assignments)
  if (result.ok) {
    return Response.json(result)
  }

  const status =
    result.reason === 'flight_not_found' ||
    result.reason === 'passenger_not_found' ||
    result.reason === 'seat_not_found'
      ? 404
      : result.reason === 'seat_booked' ||
          result.reason === 'seat_blocked' ||
          result.reason === 'assignment_failed'
        ? 409
        : 422

  return jsonError(result.reason, result.message, status)
}
