import {
  assignSeatsForParty,
  findSeatsForParty,
  getReservationByCode,
} from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ flightId: string }>
}

async function resolveBooking(flightId: string, code: string) {
  if (!code.trim()) {
    return {
      error: Response.json(
        { error: 'reservation_code_required', message: 'Please provide your reservation code.' },
        { status: 400 },
      ),
    }
  }

  const reservation = await getReservationByCode(code.trim())
  if (!reservation || reservation.flight.id !== flightId) {
    return {
      error: Response.json(
        { error: 'reservation_not_found', message: 'We cannot find this booking for the flight.' },
        { status: 404 },
      ),
    }
  }

  if (reservation.passengers.length !== 3) {
    return {
      error: Response.json(
        {
          error: 'party_size_not_supported',
          message: 'Finding three seats together is available for bookings with three passengers.',
        },
        { status: 422 },
      ),
    }
  }

  return { reservation }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const searchParams = new URL(request.url).searchParams
  const code = searchParams.get('reservationCode') ?? searchParams.get('code') ?? ''
  const booking = await resolveBooking(flightId, code)
  if (booking.error) return booking.error

  const passengerIds = booking.reservation.passengers.map((passenger) => passenger.id)
  const blocks = await findSeatsForParty(flightId, passengerIds)

  return Response.json({ flightId, blocks })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const body: unknown = await request.json().catch(() => null)

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json(
      { error: 'invalid_request', message: 'Please choose three seats together.' },
      { status: 400 },
    )
  }

  const fields = body as Record<string, unknown>
  const code = fields.reservationCode ?? fields.code
  const seatIds = fields.seatIds

  if (typeof code !== 'string') {
    return Response.json(
      { error: 'reservation_code_required', message: 'Please provide your reservation code.' },
      { status: 400 },
    )
  }

  if (
    !Array.isArray(seatIds) ||
    seatIds.length !== 3 ||
    !seatIds.every((seatId): seatId is string => typeof seatId === 'string' && seatId.trim() !== '')
  ) {
    return Response.json(
      { error: 'three_seats_required', message: 'Please choose three seats together.' },
      { status: 400 },
    )
  }

  const booking = await resolveBooking(flightId, code)
  if (booking.error) return booking.error

  const passengerIds = booking.reservation.passengers.map((passenger) => passenger.id)
  const result = await assignSeatsForParty(flightId, passengerIds, seatIds)

  if (!result.ok) {
    return Response.json(
      { error: result.reason, message: result.message },
      { status: 409 },
    )
  }

  return Response.json(result)
}
