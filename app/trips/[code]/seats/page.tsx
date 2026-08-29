import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChooseSeatsView } from '../../../../components/seats/ChooseSeatsView'
import { TripBreadcrumb } from '../../../../components/trip/Breadcrumb'
import { getReservationByCode, getSeatMap } from '../../../../lib/seats'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Choose Seats' }

export default async function SeatsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const reservation = await getReservationByCode(code)
  if (!reservation) notFound()

  const seatMap = await getSeatMap(reservation.flight.id)
  if (!seatMap) notFound()

  return (
    <div>
      <TripBreadcrumb code={reservation.code} current="seats" />
      <ChooseSeatsView reservation={reservation} seatMap={seatMap} />
    </div>
  )
}
