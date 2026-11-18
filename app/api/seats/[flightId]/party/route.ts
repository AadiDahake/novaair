import {
  assignSeatsForParty,
  findSeatsForParty,
  getSeatMap,
} from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function passengerIdsFromUrl(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const individualIds = searchParams.getAll('passengerId')
  const values =
    individualIds.length > 0
      ? individualIds
      : searchParams
          .getAll('passengerIds')
          .flatMap((value) => value.split(','))

  return values.map((value) => value.trim()).filter(Boolean)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export async function GET(request: Request, context: RouteContext) {
  const { flightId } = await context.params
  const passengerIds = passengerIdsFromUrl(request)

  if (passengerIds.length === 0) {
    return Response.json(
      {
        error: 'passengerIds_required',
        message: 'Choose at least one passenger to find seats together.',
      },
      { status: 400 },
    )
  }

  const seatMap = await getSeatMap(flightId)
  if (!seatMap) {
    return Response.json(
      {
        error: 'flight_not_found',
        message: 'We cannot find that flight.',
      },
      { status: 404 },
    )
  }

  const options = await findSeatsForParty(flightId, passengerIds)
  return Response.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, context: RouteContext) {
  const { flightId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      {
        error: 'invalid_json',
        message: 'Send the passengers and seats as valid JSON.',
      },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return Response.json(
      {
        error: 'passengerIds_and_seatIds_required',
        message: 'Choose one seat for every passenger in the party.',
      },
      { status: 400 },
    )
  }

  const payload = body as Record<string, unknown>
  if (
    !isStringArray(payload.passengerIds) ||
    !isStringArray(payload.seatIds) ||
    payload.passengerIds.length === 0 ||
    payload.passengerIds.length !== payload.seatIds.length
  ) {
    return Response.json(
      {
        error: 'passengerIds_and_seatIds_required',
        message: 'Choose one seat for every passenger in the party.',
      },
      { status: 400 },
    )
  }

  const passengerIds = payload.passengerIds.map((passengerId) => passengerId.trim())
  const seatIds = payload.seatIds.map((seatId) => seatId.trim().toUpperCase())

  if (passengerIds.some((passengerId) => passengerId.length === 0) || seatIds.some((seatId) => seatId.length === 0)) {
    return Response.json(
      {
        error: 'passengerIds_and_seatIds_required',
        message: 'Choose one seat for every passenger in the party.',
      },
      { status: 400 },
    )
  }

  const seatMap = await getSeatMap(flightId)
  if (!seatMap) {
    return Response.json(
      {
        error: 'flight_not_found',
        message: 'We cannot find that flight.',
      },
      { status: 404 },
    )
  }

  const options = await findSeatsForParty(flightId, passengerIds)
  const selectedOption = options.find(
    (option) =>
      option.seatIds.length === seatIds.length &&
      option.seatIds.every((seatId, index) => seatId === seatIds[index]),
  )

  if (!selectedOption) {
    return Response.json(
      {
        ok: false,
        reason: 'seats_unavailable',
        message: 'Those seats are no longer available together. Search again.',
      },
      { status: 409 },
    )
  }

  const result = await assignSeatsForParty(passengerIds, seatIds)
  if (result.ok) return Response.json(result)

  const status =
    result.reason === 'passenger_not_found' ||
    result.reason === 'reservation_not_found' ||
    result.reason === 'seat_map_not_found' ||
    result.reason === 'seat_not_found'
      ? 404
      : result.reason === 'adult_required' || result.reason === 'exit_row_child'
        ? 422
        : result.reason === 'party_and_seats_required' ||
            result.reason === 'seats_not_together'
          ? 400
          : 409

  return Response.json(result, { status })
}
