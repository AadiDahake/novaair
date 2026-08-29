'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { Passenger } from '../../lib/seats/types'
import { ArrowRightIcon } from '../ui/icons'

type SectionKey = 'seats' | 'bags' | 'checkin'

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'seats', label: 'Seats' },
  { key: 'bags', label: 'Bags' },
  { key: 'checkin', label: 'Check-in' },
]

/**
 * The trip sections, as a real tab list.
 *
 * The tab named "Seats" and the button named "Change seats" are the two controls the seat-change
 * path runs through, so their names are literal and must not drift.
 */
export function TripSections({
  code,
  passengers,
  departureDateLabel,
}: {
  code: string
  passengers: Passenger[]
  departureDateLabel: string
}) {
  const [active, setActive] = useState<SectionKey>('seats')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = SECTIONS[(index + delta + SECTIONS.length) % SECTIONS.length]
    if (!next) return
    setActive(next.key)
    tabRefs.current[next.key]?.focus()
  }

  return (
    <section aria-labelledby="trip-sections-heading" className="card overflow-hidden">
      <h2 id="trip-sections-heading" className="sr-only">
        Trip sections
      </h2>

      <div role="tablist" aria-label="Trip sections" className="flex gap-1 border-b border-line p-2">
        {SECTIONS.map((section, index) => {
          const isActive = active === section.key
          return (
            <button
              key={section.key}
              ref={(element) => {
                tabRefs.current[section.key] = element
              }}
              type="button"
              role="tab"
              id={`tab-${section.key}`}
              aria-selected={isActive}
              aria-controls={`panel-${section.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(section.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`pill px-6 py-2.5 text-[0.9rem] ${
                isActive ? 'pill-dark' : 'text-ink-muted hover:bg-blue-tint hover:text-navy'
              }`}
            >
              {section.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id="panel-seats"
        aria-labelledby="tab-seats"
        hidden={active !== 'seats'}
        className="p-7"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h3 className="text-lg font-bold text-navy">Your seats</h3>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-ink-muted">
              These are the seats on your booking today. Seats are changed one passenger at a time.
            </p>
          </div>
          <Link
            href={`/trips/${code}/seats`}
            className="pill pill-primary px-7 py-3.5 text-[0.95rem]"
          >
            Change seats
            <ArrowRightIcon size={16} />
          </Link>
        </div>

        <ul className="mt-6 divide-y divide-line border-t border-line">
          {passengers.map((passenger) => (
            <li key={passenger.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-semibold text-navy">
                  {passenger.firstName} {passenger.lastName}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {passenger.type === 'adult' ? 'Adult' : `Child, age ${passenger.age}`}
                </p>
              </div>
              <span className="rounded-[12px] bg-blue-tint px-4 py-2 text-base font-bold text-blue-dark">
                {passenger.seatId ?? 'No seat'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        role="tabpanel"
        id="panel-bags"
        aria-labelledby="tab-bags"
        hidden={active !== 'bags'}
        className="p-7"
      >
        <h3 className="text-lg font-bold text-navy">Bags</h3>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-ink-muted">
          Every passenger on this booking has one personal item and one carry-on bag.
        </p>
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {[
            { label: 'Personal item', detail: 'Included for each passenger', price: 'Free' },
            { label: 'Carry-on bag', detail: 'Included for each passenger', price: 'Free' },
            { label: 'First checked bag', detail: 'Not added', price: '$35' },
            { label: 'Second checked bag', detail: 'Not added', price: '$45' },
          ].map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-semibold text-navy">{row.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{row.detail}</p>
              </div>
              <span className="text-base font-bold text-navy">{row.price}</span>
            </li>
          ))}
        </ul>
        <Link href="/help/baggage-allowance" className="pill pill-outline mt-6 px-6 py-3 text-[0.9rem]">
          Read the baggage rules
        </Link>
      </div>

      <div
        role="tabpanel"
        id="panel-checkin"
        aria-labelledby="tab-checkin"
        hidden={active !== 'checkin'}
        className="p-7"
      >
        <h3 className="text-lg font-bold text-navy">Check-in</h3>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-ink-muted">
          Check-in opens 24 hours before departure on {departureDateLabel}. Change your seats before
          you check in.
        </p>
        <p className="mt-6 rounded-[14px] bg-blue-tint px-5 py-4 text-sm font-medium text-navy">
          Check-in is not open yet for this flight.
        </p>
        <Link href="/help/check-in" className="pill pill-outline mt-6 px-6 py-3 text-[0.9rem]">
          Read the check-in rules
        </Link>
      </div>
    </section>
  )
}
