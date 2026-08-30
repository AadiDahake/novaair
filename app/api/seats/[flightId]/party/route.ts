import { assignSeatsForParty, findSeatsForParty } from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

interface AssignmentInput {
  passengerId: string
  seatId: string
}

function readPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const values = [
    ...searchParams.getAll('passengerId'),
    ...searchParams.getAll('passengerIds'),
  ]

  return values
    .flatMap((value) => value.split(','))
    .map((passengerId) => passengerId.trim())
    .filter(Boolean)
}

function isAssignmentInput(value: unknown): value is AssignmentInput {
  if (!value || typeof value !== 'object') return false

  const assignment = value as Record<string, unknown>
  return (
    typeof assignment.passengerId === 'string' &&
    assignment.passengerId.trim().length > 0 &&
    typeof assignment.seatId === 'string' &&
    assignment.seatId.trim().length > 0
  )
}

function failureStatus(reason: string): number {
  if (
    reason === 'flight_not_found' ||
    reason === 'passenger_not_found' ||
    reason === 'seat_not_found'
  ) {
    return 404
  }

  if (
    reason === 'seat_booked' ||
    reason === 'seat_blocked' ||
    reason === 'seat_swap_not_supported' ||
    reason === 'current_seat_required'
  ) {
    return 409
  }

  if (
    reason === 'adult_required' ||
    reason === 'exit_row_child' ||
    reason === 'seats_not_together'
  ) {
    return 422
  }

  return 400
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const passengerIds = readPassengerIds(request)

  if (passengerIds.length === 0) {
    return Response.json(
      {
        error: 'passenger_ids_required',
        message: 'Choose an adult and the children who need seats together.',
      },
      { status: 400 },
    )
  }

  if (new Set(passengerIds).size !== passengerIds.length) {
    return Response.json(
      {
        error: 'invalid_passenger_ids',
        message: 'Choose each passenger once.',
      },
      { status: 400 },
    )
  }

  const options = await findSeatsForParty(flightId, passengerIds)
  return Response.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      {
        error: 'invalid_json',
        message: 'We could not read those family seat choices.',
      },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return Response.json(
      {
        error: 'assignments_required',
        message: 'Choose seats for your family before saving.',
      },
      { status: 400 },
    )
  }

  const assignments = (body as Record<string, unknown>).assignments
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return Response.json(
      {
        error: 'assignments_required',
        message: 'Choose seats for your family before saving.',
      },
      { status: 400 },
    )
  }

  if (!assignments.every(isAssignmentInput)) {
    return Response.json(
      {
        error: 'invalid_assignments',
        message: 'Each passenger must have one seat.',
      },
      { status: 400 },
    )
  }

  const result = await assignSeatsForParty(flightId, assignments)
  if (!result.ok) {
    return Response.json(
      {
        error: result.reason,
        reason: result.reason,
        message: result.message,
      },
      { status: failureStatus(result.reason) },
    )
  }

  return Response.json(result)
}
