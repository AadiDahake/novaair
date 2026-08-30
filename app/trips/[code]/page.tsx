import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LogoMark } from '../../../components/brand/Logo'
import { RouteLine } from '../../../components/flights/RouteLine'
import { TripBreadcrumb } from '../../../components/trip/Breadcrumb'
import { TripSections } from '../../../components/trip/TripSections'
import {
  formatDuration,
  formatLongDate,
  passengerFullName,
  passengerInitials,
} from '../../../lib/format'
import { getReservationByCode } from '../../../lib/seats'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Manage Trip' }

export default async function TripPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const reservation = await getReservationByCode(code)
  if (!reservation) notFound()

  const { flight, passengers } = reservation
  const departureDateLabel = formatLongDate(flight.departureDate)

  return (
    <div>
      <TripBreadcrumb code={reservation.code} current="trip" />

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
            Manage Trip
          </h1>
          <p className="mt-3 text-[0.95rem] text-ink-muted">
            Confirmation code{' '}
            <strong className="font-bold tracking-[0.12em] text-ink">{reservation.code}</strong>{' '}
            for {reservation.lastName}
          </p>
        </div>
        <Link href="/my-booking" className="pill pill-outline px-6 py-3 text-[0.9rem]">
          Find another booking
        </Link>
      </div>

      <div className="mt-8 grid gap-7 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-7">
          <section aria-labelledby="itinerary-heading" className="card p-7">
            <div className="flex items-center justify-between gap-4">
              <h2 id="itinerary-heading" className="text-lg font-bold text-ink">
                Your itinerary
              </h2>
              <span className="rounded-full bg-blue-tint px-3.5 py-1.5 text-xs font-semibold text-blue-soft">
                {reservation.fareBrand}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-2.5">
              <LogoMark size={24} />
              <span className="font-bold text-ink">NovaAir {flight.flightNumber}</span>
              <span className="text-sm text-ink-muted">{flight.aircraft}</span>
            </div>

            <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div>
                <span className="field-label">Departure</span>
                <p className="mt-1 text-2xl font-extrabold text-ink">{flight.departureTime}</p>
                <p className="text-sm text-ink-muted">
                  {flight.originCity} ({flight.originCode})
                </p>
              </div>
              <div className="mx-auto w-full min-w-[200px] max-w-[280px]">
                <RouteLine from={flight.originCode} to={flight.destinationCode} />
                <p className="mt-2 text-center text-xs text-ink-muted">
                  {formatDuration(flight.durationMinutes)} - direct
                </p>
              </div>
              <div className="sm:text-right">
                <span className="field-label">Arrival</span>
                <p className="mt-1 text-2xl font-extrabold text-ink">{flight.arrivalTime}</p>
                <p className="text-sm text-ink-muted">
                  {flight.destinationCity} ({flight.destinationCode})
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
              <div>
                <span className="field-label">Date</span>
                <p className="field-value mt-1">{departureDateLabel}</p>
              </div>
              <div>
                <span className="field-label">Quantity</span>
                <p className="field-value mt-1">
                  {passengers.length} {passengers.length === 1 ? 'person' : 'people'}
                </p>
              </div>
              <div>
                <span className="field-label">Cabin</span>
                <p className="field-value mt-1">{flight.cabinName}</p>
              </div>
            </div>
          </section>

          <TripSections
            code={reservation.code}
            passengers={passengers}
            departureDateLabel={departureDateLabel}
          />
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="passengers-heading" className="card p-6">
            <h2 id="passengers-heading" className="text-base font-bold text-ink">
              Passengers
            </h2>
            <ul className="mt-4 space-y-4">
              {passengers.map((passenger) => (
                <li key={passenger.id} className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-sm font-bold text-blue-soft">
                    {passengerInitials(passenger)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {passengerFullName(passenger)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {passenger.type === 'adult' ? 'Adult' : `Child, age ${passenger.age}`} - seat{' '}
                      {passenger.seatId ?? 'not chosen'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="payment-heading" className="card p-6">
            <h2 id="payment-heading" className="text-base font-bold text-ink">
              Payment
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Booked on</dt>
                <dd className="font-semibold text-ink">{formatLongDate(reservation.bookedOn)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Fare</dt>
                <dd className="font-semibold text-ink">{reservation.fareBrand}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-3">
                <dt className="text-ink-muted">Total paid</dt>
                <dd className="text-lg font-extrabold text-blue-soft">${reservation.totalPaidUsd}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="help-heading" className="rounded-[20px] bg-blue-tint p-6">
            <h2 id="help-heading" className="text-base font-bold text-ink">
              Need help?
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/help/how-do-i-change-my-seat"
                  className="font-medium text-ink-soft underline transition-colors hover:text-ink"
                >
                  How do I change my seat?
                </Link>
              </li>
              <li>
                <Link
                  href="/help/traveling-with-children"
                  className="font-medium text-ink-soft underline transition-colors hover:text-ink"
                >
                  Traveling with children
                </Link>
              </li>
              <li>
                <Link
                  href="/help/seat-selection-fees"
                  className="font-medium text-ink-soft underline transition-colors hover:text-ink"
                >
                  Seat selection fees
                </Link>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
