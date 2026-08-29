import { NextResponse } from 'next/server'
import { calculateSeatPrice } from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

/** GET /api/seats/{flightId}/price?seat=21A - what one seat costs, in cents. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ flightId: string }> },
) {
  const { flightId } = await params
  const seatId = new URL(request.url).searchParams.get('seat')
  if (!seatId) {
    return NextResponse.json({ error: 'seat_query_required' }, { status: 400 })
  }
  const priceCents = await calculateSeatPrice(flightId, seatId)
  if (priceCents === null) {
    return NextResponse.json({ error: 'seat_not_found' }, { status: 404 })
  }
  return NextResponse.json({ flightId, seat: seatId.toUpperCase(), priceCents })
}
