import {
  assignSeatsForParty,
  findSeatsForParty,
  getPassengerRestrictions,
  getSeatMap,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

interface PartyRequestBody {
  passengerIds?: unknown
  seatIds?: unknown
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  )
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length
}

async function validateFlightAndPassengers(
  flightId: string,
  passengerIds: string[],
): Promise<Response | null> {
  const seatMap = await getSeatMap(flightId)
  if (!seatMap) {
    return Response.json(
      { error: 'flight_not_found', message: 'We cannot find that flight.' },
      { status: 404 },
    )
  }

  const restrictions = await Promise.all(
    passengerIds.map((passengerId) => getPassengerRestrictions(passengerId)),
  )
  if (restrictions.some((restriction) => restriction === null)) {
    return Response.json(
      {
        error: 'passenger_not_found',
        message: 'We cannot find one or more passengers in this booking.',
      },
      { status: 404 },
    )
  }

  return null
}

function getPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const repeatedIds = searchParams.getAll('passengerId')
  if (repeatedIds.length > 0) return repeatedIds.map((passengerId) => passengerId.trim())

  return searchParams
    .getAll('passengerIds')
    .flatMap((value) => value.split(','))
    .map((passengerId) => passengerId.trim())
    .filter(Boolean)
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { flightId } = await context.params
  const passengerIds = getPassengerIds(request)

  if (passengerIds.length === 0 || hasDuplicates(passengerIds)) {
    return Response.json(
      {
        error: 'passengerIds_required',
        message: 'Choose each passenger who needs a seat and try again.',
      },
      { status: 400 },
    )
  }

  const validationError = await validateFlightAndPassengers(flightId, passengerIds)
  if (validationError) return validationError

  const options = await findSeatsForParty(flightId, passengerIds)
  return Response.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { flightId } = await context.params

  let body: PartyRequestBody
  try {
    body = (await request.json()) as PartyRequestBody
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Send a valid seats-together request and try again.' },
      { status: 400 },
    )
  }

  if (
    !isStringArray(body.passengerIds) ||
    !isStringArray(body.seatIds) ||
    body.passengerIds.length !== body.seatIds.length ||
    hasDuplicates(body.passengerIds) ||
    hasDuplicates(body.seatIds.map((seatId) => seatId.trim().toUpperCase()))
  ) {
    return Response.json(
      {
        error: 'invalid_party_assignment',
        message: 'Choose one seat for every passenger and try again.',
      },
      { status: 400 },
    )
  }

  const passengerIds = body.passengerIds.map((passengerId) => passengerId.trim())
  const seatIds = body.seatIds.map((seatId) => seatId.trim().toUpperCase())

  const validationError = await validateFlightAndPassengers(flightId, passengerIds)
  if (validationError) return validationError

  const options = await findSeatsForParty(flightId, passengerIds)
  const selectedOption = options.find(
    (option) =>
      option.seatIds.length === seatIds.length &&
      option.seatIds.every((seatId, index) => seatId === seatIds[index]),
  )

  if (!selectedOption) {
    return Response.json(
      {
        error: 'invalid_seat_block',
        message:
          'Those seats are no longer available together. Find seats together again to see current options.',
      },
      { status: 422 },
    )
  }

  const result = await assignSeatsForParty(passengerIds, seatIds)
  if (!result.ok) {
    const status =
      result.reason === 'passenger_not_found' || result.reason === 'reservation_not_found'
        ? 404
        : result.reason === 'invalid_party' || result.reason === 'invalid_seat_block'
          ? 422
          : 409

    return Response.json(
      { error: result.reason, reason: result.reason, message: result.message },
      { status },
    )
  }

  return Response.json({
    ok: true,
    flightId,
    assignments: result.assignments,
  })
}
