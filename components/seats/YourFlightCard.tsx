'use client'

import { useState } from 'react'
import { LogoMark } from '../brand/Logo'
import { RouteLine } from '../flights/RouteLine'
import { ArrowUpIcon } from '../ui/icons'
import { CabinIllustration } from '../ui/PlaneIllustration'
import { formatDuration, formatShortDate } from '../../lib/format'
import type { Flight } from '../../lib/seats/types'

export function YourFlightCard({
  flight,
  partySize,
}: {
  flight: Flight
  partySize: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <section aria-labelledby="your-flight-heading" className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 id="your-flight-heading" className="text-lg font-bold text-navy">
          Your Flight
        </h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="your-flight-body"
          aria-label={open ? 'Hide flight details' : 'Show flight details'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line text-navy transition-colors hover:bg-blue-tint"
        >
          <ArrowUpIcon className={open ? '' : 'rotate-180'} />
        </button>
      </div>

      <div id="your-flight-body" hidden={!open}>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <span className="field-label">Departure</span>
            <p className="field-value mt-1 text-[0.95rem]">
              {flight.originCity} ({flight.originCode})
            </p>
          </div>
          <div>
            <span className="field-label">Arrival</span>
            <p className="field-value mt-1 text-[0.95rem]">
              {flight.destinationCity} ({flight.destinationCode})
            </p>
          </div>
          <div>
            <span className="field-label">Date</span>
            <p className="field-value mt-1 text-[0.95rem]">{formatShortDate(flight.departureDate)}</p>
          </div>
          <div>
            <span className="field-label">Quantity</span>
            <p className="field-value mt-1 text-[0.95rem]">
              {partySize} {partySize === 1 ? 'person' : 'people'}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[16px] border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <LogoMark size={26} />
              <div>
                <p className="text-sm font-bold text-navy">NovaAir</p>
                <p className="text-xs text-ink-muted">{flight.flightNumber}</p>
              </div>
            </div>
            <span className="pill pill-dark px-4 py-1.5 text-[0.72rem]">Details</span>
          </div>

          <p className="mt-4 text-xs text-ink-muted">
            {formatDuration(flight.durationMinutes)} - {flight.aircraft}
          </p>
          <RouteLine
            from={flight.originCode}
            to={flight.destinationCode}
            className="mt-2"
          />
          <p className="mt-2 text-xs text-ink-muted">Direct flight, no transit</p>
          <p className="mt-4 text-xl font-extrabold text-green">
            ${flight.fareUsd}
            <span className="ml-1.5 text-[0.7rem] font-medium text-ink-muted">for each person</span>
          </p>
        </div>

        <div className="mt-4 flex items-center gap-4 rounded-[16px] border border-line p-3">
          <span className="h-16 w-24 shrink-0 overflow-hidden rounded-[12px]">
            <CabinIllustration className="h-full w-full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-navy">{flight.cabinName}</span>
            <span className="block text-xs text-ink-muted">Standard seat, no extra cost</span>
          </span>
          <span className="text-base font-extrabold text-navy">${flight.fareUsd}</span>
        </div>
      </div>
    </section>
  )
}
