'use client'

import { useMemo, useState, type FormEvent } from 'react'
import type { Passenger } from '../../lib/seats/types'

export interface SeatPartyOption {
  seatIds: string[]
  totalPriceCents: number
}

export interface SeatPartyAssignment {
  passengerId: string
  seatId: string
}

export interface SeatPartySelection {
  assignments: SeatPartyAssignment[]
  totalPriceCents: number
}

interface Props {
  flightId: string
  passengers: Passenger[]
  onSelect: (selection: SeatPartySelection) => void
}

interface PartySearchResponse {
  options?: unknown
  message?: string
}

function testIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isSeatPartyOption(value: unknown): value is SeatPartyOption {
  if (!value || typeof value !== 'object') return false

  const option = value as Record<string, unknown>
  return (
    Array.isArray(option.seatIds) &&
    option.seatIds.length > 0 &&
    option.seatIds.every((seatId) => typeof seatId === 'string') &&
    typeof option.totalPriceCents === 'number' &&
    Number.isFinite(option.totalPriceCents)
  )
}

function formatExtraCost(priceCents: number): string {
  if (priceCents === 0) return 'No extra cost'

  return `${new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(priceCents / 100)} total extra cost`
}

export function SeatPartyFinder({ flightId, passengers, onSelect }: Props) {
  const [selectedPassengerIds, setSelectedPassengerIds] = useState<string[]>(() =>
    passengers.slice(0, 3).map((passenger) => passenger.id),
  )
  const [options, setOptions] = useState<SeatPartyOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedOptionKey, setSelectedOptionKey] = useState<string | null>(null)

  const selectedPassengerSet = useMemo(
    () => new Set(selectedPassengerIds),
    [selectedPassengerIds],
  )

  function togglePassenger(passengerId: string) {
    setSelectedPassengerIds((current) =>
      current.includes(passengerId)
        ? current.filter((id) => id !== passengerId)
        : current.length < 3
          ? [...current, passengerId]
          : current,
    )
    setOptions([])
    setSearched(false)
    setMessage(null)
    setSelectedOptionKey(null)
  }

  async function findSeatsTogether(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedPassengerIds.length < 2) return

    setSearching(true)
    setSearched(false)
    setMessage(null)
    setSelectedOptionKey(null)

    const searchParams = new URLSearchParams()
    for (const passengerId of selectedPassengerIds) {
      searchParams.append('passengerId', passengerId)
    }

    try {
      const response = await fetch(
        `/api/seats/${encodeURIComponent(flightId)}/party?${searchParams.toString()}`,
        { method: 'GET' },
      )
      const payload = (await response.json().catch(() => ({}))) as PartySearchResponse

      if (!response.ok) {
        setOptions([])
        setMessage(payload.message ?? 'We could not find seats together. Please try again.')
        setSearched(true)
        return
      }

      const nextOptions = Array.isArray(payload.options)
        ? payload.options.filter(isSeatPartyOption)
        : []

      setOptions(nextOptions)
      setSearched(true)
      if (nextOptions.length === 0) {
        setMessage(
          'No adjacent seats are available for this group. Try different passengers or choose seats individually.',
        )
      }
    } catch {
      setOptions([])
      setSearched(true)
      setMessage('We could not find seats together. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  function selectOption(option: SeatPartyOption) {
    const optionKey = option.seatIds.join('-')
    setSelectedOptionKey(optionKey)
    setMessage(`${option.seatIds.join(', ')} are ready to confirm.`)

    onSelect({
      assignments: selectedPassengerIds.map((passengerId, index) => ({
        passengerId,
        seatId: option.seatIds[index] ?? '',
      })),
      totalPriceCents: option.totalPriceCents,
    })
  }

  return (
    <section
      aria-labelledby="seat-party-finder-heading"
      className="card p-6"
      data-testid="seat-party-finder"
    >
      <h2 id="seat-party-finder-heading" className="text-lg font-bold text-ink">
        Find seats together
      </h2>
      <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-muted">
        Choose two or three passengers. We will show adjacent seats in one row, with the lowest
        extra cost first.
      </p>

      <form className="mt-5" onSubmit={findSeatsTogether}>
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Passengers traveling together</legend>
          <div className="mt-3 space-y-2">
            {passengers.map((passenger, index) => {
              const checked = selectedPassengerSet.has(passenger.id)
              const selectionLimitReached = !checked && selectedPassengerIds.length >= 3
              const passengerTestId = testIdPart(passenger.id) || String(index + 1)

              return (
                <label
                  key={passenger.id}
                  className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-line-strong px-4 py-3 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={selectionLimitReached}
                    onChange={() => togglePassenger(passenger.id)}
                    aria-label={`Include ${passenger.firstName} in Find seats together`}
                    data-testid={`seat-party-passenger-${passengerTestId}`}
                    className="h-4 w-4 accent-amber-ink"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{passenger.firstName}</span>
                    <span className="ml-2 text-ink-muted">
                      {passenger.type === 'adult' ? 'Adult' : 'Child'}
                    </span>
                  </span>
                  {passenger.seatId ? (
                    <span className="text-xs font-semibold text-ink-soft">
                      Seat {passenger.seatId}
                    </span>
                  ) : null}
                </label>
              )
            })}
          </div>
        </fieldset>

        <p className="mt-3 text-xs text-ink-muted">
          {selectedPassengerIds.length}{' '}
          {selectedPassengerIds.length === 1 ? 'passenger' : 'passengers'} selected
        </p>

        <button
          type="submit"
          disabled={selectedPassengerIds.length < 2 || searching}
          aria-label="Find seats together"
          data-testid="find-seats-together"
          className="pill pill-primary mt-4 w-full px-6 py-3 text-sm"
        >
          {searching ? 'Finding seats together...' : 'Find seats together'}
        </button>
      </form>

      <div aria-live="polite" className="mt-5">
        {message ? (
          <p
            data-testid="seat-party-message"
            className="rounded-[14px] bg-blue-tint px-4 py-3 text-sm leading-relaxed text-ink"
          >
            {message}
          </p>
        ) : null}

        {options.length > 0 ? (
          <div className="mt-5">
            <h3 className="text-sm font-bold text-ink">Adjacent seat options</h3>
            <ol className="mt-3 space-y-3">
              {options.map((option, index) => {
                const optionKey = option.seatIds.join('-')
                const selected = selectedOptionKey === optionKey

                return (
                  <li key={optionKey}>
                    <button
                      type="button"
                      onClick={() => selectOption(option)}
                      aria-label={`Select adjacent seats ${option.seatIds.join(', ')}`}
                      data-testid={`seat-party-option-${index + 1}`}
                      aria-pressed={selected}
                      className={`w-full rounded-[16px] border px-4 py-4 text-left transition ${
                        selected
                          ? 'border-amber-ink bg-orange-tint'
                          : 'border-line-strong bg-surface-raised'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span>
                          <span className="block text-base font-bold text-ink">
                            {option.seatIds.join(', ')}
                          </span>
                          <span className="mt-1 block text-xs text-ink-muted">
                            Together in one row
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm font-semibold text-ink">
                          {formatExtraCost(option.totalPriceCents)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : searched && !message ? (
          <p className="text-sm text-ink-muted">No adjacent seat options found.</p>
        ) : null}
      </div>
    </section>
  )
}
