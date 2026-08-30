'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { LogoMark } from '../brand/Logo'
import { ArrowRightIcon } from '../ui/icons'
import { Checkbox } from './Checkbox'
import { RouteLine } from './RouteLine'
import { FACILITY_OPTIONS, FLIGHT_RESULTS, STOP_OPTIONS } from './flight-results'

interface Props {
  from: { code: string; city: string }
  to: { code: string; city: string }
  dateLabel: string
  passengers: number
}

export function FlightSearchView({ from, to, dateLabel, passengers }: Props) {
  const [stopFilters, setStopFilters] = useState<string[]>([])
  const [airlineChecked, setAirlineChecked] = useState(true)
  const [facilityFilters, setFacilityFilters] = useState<string[]>([])

  const results = useMemo(() => {
    if (!airlineChecked) return []
    const allowedStops = STOP_OPTIONS.filter((option) => stopFilters.includes(option.key)).map(
      (option) => option.stops as number,
    )
    return FLIGHT_RESULTS.filter((result) => {
      if (allowedStops.length > 0 && !allowedStops.includes(result.stops)) return false
      return facilityFilters.every((facility) => result.facilities.includes(facility))
    })
  }, [stopFilters, airlineChecked, facilityFilters])

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
          Flight Search
        </h1>
        <p className="mt-3 text-[0.95rem] text-ink-muted">
          {results.length} {results.length === 1 ? 'flight' : 'flights'} for {passengers}{' '}
          {passengers === 1 ? 'person' : 'people'}
        </p>
      </div>

      <section aria-label="Search summary" className="card grid gap-6 p-6 sm:grid-cols-3">
        <div>
          <span className="field-label">Departure</span>
          <p className="field-value mt-1">
            {from.city} ({from.code})
          </p>
        </div>
        <div>
          <span className="field-label">Arrival</span>
          <p className="field-value mt-1">
            {to.city} ({to.code})
          </p>
        </div>
        <div>
          <span className="field-label">Date</span>
          <p className="field-value mt-1">{dateLabel}</p>
        </div>
      </section>

      <div className="grid gap-7 lg:grid-cols-[300px_1fr] lg:items-start">
        <section aria-labelledby="filters-heading" className="card p-6">
          <h2 id="filters-heading" className="text-lg font-bold text-ink">
            Filters Ticket
          </h2>

          <fieldset className="mt-5 border-t border-line pt-4">
            <legend className="field-label mb-1">Flights</legend>
            {STOP_OPTIONS.map((option) => (
              <Checkbox
                key={option.key}
                label={option.label}
                checked={stopFilters.includes(option.key)}
                onChange={() => setStopFilters((current) => toggle(current, option.key))}
              />
            ))}
          </fieldset>

          <fieldset className="mt-4 border-t border-line pt-4">
            <legend className="field-label mb-1">Airlines</legend>
            <Checkbox
              label="NovaAir"
              checked={airlineChecked}
              onChange={setAirlineChecked}
              leading={<LogoMark size={20} />}
              trailing={
                <span className="rounded-full bg-blue-tint px-2.5 py-1 text-[0.7rem] font-semibold text-blue-soft">
                  Available
                </span>
              }
            />
          </fieldset>

          <fieldset className="mt-4 border-t border-line pt-4">
            <legend className="field-label mb-1">Facilities</legend>
            {FACILITY_OPTIONS.map((facility) => (
              <Checkbox
                key={facility}
                label={facility}
                checked={facilityFilters.includes(facility)}
                onChange={() => setFacilityFilters((current) => toggle(current, facility))}
              />
            ))}
          </fieldset>
        </section>

        <section aria-label="Flight results" className="space-y-4">
          {results.length === 0 ? (
            <p className="card p-8 text-center text-sm text-ink-muted">
              No flights match these filters. Clear a filter to see more results.
            </p>
          ) : (
            results.map((result) => (
              <article key={result.id} className="card p-6">
                <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <LogoMark size={22} />
                      <span className="text-sm font-bold text-ink">NovaAir</span>
                      <span className="text-sm text-ink-muted">{result.flightNumber}</span>
                      <span className="rounded-full bg-blue-tint px-2.5 py-1 text-[0.7rem] font-semibold text-blue-soft">
                        {result.cabin}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center gap-6">
                      <div>
                        <span className="field-label">Departs</span>
                        <p className="text-xl font-bold text-ink">{result.departureTime}</p>
                      </div>
                      <div className="mx-auto w-full min-w-[180px] max-w-[300px]">
                        <RouteLine from={from.code} to={to.code} stops={result.stops} />
                        <p className="mt-1.5 text-center text-xs text-ink-muted">
                          {result.durationLabel}
                        </p>
                      </div>
                      <div>
                        <span className="field-label">Arrives</span>
                        <p className="text-xl font-bold text-ink">{result.arrivalTime}</p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-ink-muted">{result.transitLabel}</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {result.facilities.map((facility) => (
                        <li
                          key={facility}
                          className="rounded-full border border-line px-3 py-1 text-[0.72rem] font-medium text-ink-muted"
                        >
                          {facility}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col items-end gap-3 lg:min-w-[170px]">
                    <p className="text-[1.75rem] font-extrabold text-green">${result.priceUsd}</p>
                    <p className="-mt-2 text-xs text-ink-muted">for each person</p>
                    <Link href="/my-booking" className="pill pill-primary px-6 py-3 text-[0.9rem]">
                      Select flight
                      <ArrowRightIcon size={16} />
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
