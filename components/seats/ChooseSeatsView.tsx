'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { capture } from '../../lib/analytics/client'
import {
  SEAT_HOVER_THROTTLE_MS,
  seatsAreContiguous,
  seatsAreSameRow,
} from '../../lib/analytics/events'
import type { Passenger, Reservation, Seat, SeatMap } from '../../lib/seats/types'
import { ArrowLeftIcon, WarningIcon } from '../ui/icons'
import { PlaneNose } from '../ui/PlaneIllustration'
import { PassengerSelector } from './PassengerSelector'
import { SeatButton } from './SeatButton'
import { SeatLegend } from './SeatLegend'
import { TransactionDetails } from './TransactionDetails'
import { YourFlightCard } from './YourFlightCard'

type Staged = Record<string, string | null>

interface SeatPartyBlock {
  row: number
  seatIds: string[]
  extraCostCents: number
}

type PartyFeedback = {
  kind: 'loading' | 'success' | 'empty' | 'error'
  text: string
}

interface Props {
  reservation: Reservation
  seatMap: SeatMap
}

function isSeatPartyBlock(value: unknown): value is SeatPartyBlock {
  if (!value || typeof value !== 'object') return false

  const block = value as Record<string, unknown>
  return (
    typeof block.row === 'number' &&
    Number.isInteger(block.row) &&
    Array.isArray(block.seatIds) &&
    block.seatIds.every((seatId): seatId is string => typeof seatId === 'string') &&
    typeof block.extraCostCents === 'number' &&
    Number.isFinite(block.extraCostCents)
  )
}

function formatSeatPrice(priceCents: number): string {
  if (priceCents === 0) return 'No extra cost'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(priceCents / 100)
}

export function ChooseSeatsView({ reservation, seatMap }: Props) {
  const router = useRouter()
  const { passengers, flight } = reservation

  const [staged, setStaged] = useState<Staged>(() =>
    Object.fromEntries(passengers.map((passenger) => [passenger.id, passenger.seatId])),
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [partyBlocks, setPartyBlocks] = useState<SeatPartyBlock[]>([])
  const [partyFeedback, setPartyFeedback] = useState<PartyFeedback | null>(null)
  const [selectedFamilySeatIds, setSelectedFamilySeatIds] = useState<string[] | null>(null)

  const interactions = useRef(0)
  const openedAt = useRef(Date.now())
  const lastHoverAt = useRef(0)
  const lastHoveredSeat = useRef<string | null>(null)

  const partyIds = useMemo(() => new Set(passengers.map((p) => p.id)), [passengers])
  const passengerById = useMemo(
    () => new Map(passengers.map((passenger) => [passenger.id, passenger])),
    [passengers],
  )
  const seatById = useMemo(() => {
    const seats = new Map<string, Seat>()
    for (const row of seatMap.rows) {
      for (const seat of [...row.left, ...row.right]) seats.set(seat.id, seat)
    }
    return seats
  }, [seatMap])

  useEffect(() => {
    capture('seat_map_opened', {
      reservation_code: reservation.code,
      flight_id: flight.id,
      party_size: passengers.length,
      current_seats: passengers.map((passenger) => passenger.seatId ?? ''),
    })
    // The event describes the map as it was opened, so it is sent once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Who holds each seat right now, taking the staged choices into account. */
  const ownerBySeat = useMemo(() => {
    const owners = new Map<string, string>()
    for (const row of seatMap.rows) {
      for (const seat of [...row.left, ...row.right]) {
        // A seat held by somebody outside this booking is simply taken.
        if (seat.occupantPassengerId && !partyIds.has(seat.occupantPassengerId)) {
          owners.set(seat.id, seat.occupantPassengerId)
        }
      }
    }
    for (const [passengerId, seatId] of Object.entries(staged)) {
      if (seatId) owners.set(seatId, passengerId)
    }
    return owners
  }, [seatMap, staged, partyIds])

  const viewSeat = useCallback(
    (seat: Seat): Seat => {
      if (seat.baseState === 'blocked') return { ...seat, state: 'blocked', occupantPassengerId: null }
      if (seat.baseState === 'booked') return { ...seat, state: 'booked', occupantPassengerId: null }
      const owner = ownerBySeat.get(seat.id) ?? null
      if (!owner) return { ...seat, state: 'available', occupantPassengerId: null }
      if (partyIds.has(owner)) return { ...seat, state: 'occupied', occupantPassengerId: owner }
      return { ...seat, state: 'booked', occupantPassengerId: null }
    },
    [ownerBySeat, partyIds],
  )

  const stagedList = useMemo(
    () =>
      passengers
        .map((passenger) => staged[passenger.id])
        .filter((seatId): seatId is string => Boolean(seatId)),
    [passengers, staged],
  )

  const seatFeeCents = useMemo(
    () =>
      stagedList.reduce(
        (total, seatId) => total + (seatById.get(seatId)?.priceCents ?? 0),
        0,
      ),
    [seatById, stagedList],
  )

  const hasChanges = passengers.some((passenger) => staged[passenger.id] !== passenger.seatId)

  function reject(seat: Seat, reason: string, text: string) {
    interactions.current += 1
    setNotice({ kind: 'error', text })
    capture('seat_selection_rejected', { seat: seat.id, reason })
  }

  function onSeatSelect(rawSeat: Seat) {
    const seat = viewSeat(rawSeat)
    const passenger = passengers[selectedIndex]
    if (!passenger) return

    if (seat.state === 'booked') {
      reject(seat, 'seat_booked', `Seat ${seat.id} is already taken. Please pick another seat.`)
      return
    }
    if (seat.state === 'blocked') {
      reject(
        seat,
        'seat_blocked',
        `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
      )
      return
    }
    if (seat.state === 'occupied') {
      const owner = seat.occupantPassengerId
      if (owner === passenger.id) return
      const other = owner ? passengerById.get(owner) : null
      reject(
        seat,
        'seat_taken_by_party',
        other
          ? `Seat ${seat.id} is chosen for ${other.firstName}. Select ${other.firstName} first to move them.`
          : `Seat ${seat.id} is already chosen.`,
      )
      return
    }
    if (seat.isExitRow && passenger.type !== 'adult') {
      reject(
        seat,
        'exit_row_child',
        `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger.firstName} cannot sit there.`,
      )
      return
    }

    interactions.current += 1
    setSelectedFamilySeatIds(null)
    setStaged((current) => ({ ...current, [passenger.id]: seat.id }))
    setNotice(null)
    capture('seat_selected', {
      seat: seat.id,
      row: seat.row,
      column: seat.column,
      passenger_index: passenger.index,
      state: 'available',
      price: seat.priceCents,
    })

    const next = (selectedIndex + 1) % passengers.length
    setSelectedIndex(next)
    const nextPassenger = passengers[next]
    if (nextPassenger) {
      capture('passenger_selected', {
        passenger_index: nextPassenger.index,
        passenger_type: nextPassenger.type,
      })
    }
  }

  function onSeatHover(rawSeat: Seat) {
    const now = Date.now()
    if (lastHoveredSeat.current === rawSeat.id && now - lastHoverAt.current < SEAT_HOVER_THROTTLE_MS) {
      return
    }
    if (now - lastHoverAt.current < SEAT_HOVER_THROTTLE_MS) return
    lastHoverAt.current = now
    lastHoveredSeat.current = rawSeat.id
    const seat = viewSeat(rawSeat)
    capture('seat_hovered', {
      seat: seat.id,
      row: seat.row,
      column: seat.column,
      state: seat.state,
    })
  }

  function onPassengerSelect(index: number) {
    const passenger = passengers[index]
    if (!passenger) return
    interactions.current += 1
    setSelectedIndex(index)
    capture('passenger_selected', {
      passenger_index: passenger.index,
      passenger_type: passenger.type,
    })
  }

  async function findFamilySeats() {
    if (passengers.length !== 3) {
      setPartyFeedback({
        kind: 'error',
        text: 'Find three seats together is available for bookings with three passengers.',
      })
      return
    }

    setPartyFeedback({
      kind: 'loading',
      text: 'Searching for three adjacent seats...',
    })

    const searchParams = new URLSearchParams()
    for (const passenger of passengers) {
      searchParams.append('passengerId', passenger.id)
    }

    try {
      const response = await fetch(
        `/api/seats/${encodeURIComponent(flight.id)}/party?${searchParams.toString()}`,
      )
      const payload = (await response.json().catch(() => ({}))) as {
        blocks?: unknown
        message?: string
      }

      if (!response.ok) {
        setPartyBlocks([])
        setPartyFeedback({
          kind: 'error',
          text: payload.message ?? 'We could not search for seats together. Please try again.',
        })
        return
      }

      const blocks = Array.isArray(payload.blocks)
        ? payload.blocks
            .filter(isSeatPartyBlock)
            .filter((block) => block.seatIds.length === passengers.length)
            .sort(
              (left, right) =>
                left.extraCostCents - right.extraCostCents ||
                left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
            )
        : []

      setPartyBlocks(blocks)
      if (blocks.length === 0) {
        setPartyFeedback({
          kind: 'empty',
          text: 'No three adjacent seats are available right now. You can still choose seats individually.',
        })
        return
      }

      setPartyFeedback({
        kind: 'success',
        text: `Found ${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'} of three adjacent seats, cheapest first.`,
      })
    } catch {
      setPartyBlocks([])
      setPartyFeedback({
        kind: 'error',
        text: 'Something went wrong while searching for seats together. Please try again.',
      })
    }
  }

  function selectFamilyBlock(block: SeatPartyBlock) {
    if (block.seatIds.length !== passengers.length) return

    interactions.current += 1
    setStaged((current) => {
      const next = { ...current }
      passengers.forEach((passenger, index) => {
        next[passenger.id] = block.seatIds[index] ?? null
      })
      return next
    })
    setSelectedFamilySeatIds([...block.seatIds])
    setNotice({
      kind: 'success',
      text: `Seats ${block.seatIds.join(', ')} are selected for your family. Confirm seats to save them.`,
    })
    setPartyFeedback({
      kind: 'success',
      text: `Selected seats ${block.seatIds.join(', ')} for all three passengers. Total extra cost: ${formatSeatPrice(block.extraCostCents)}.`,
    })

    block.seatIds.forEach((seatId, index) => {
      const seat = seatById.get(seatId)
      const passenger = passengers[index]
      if (!seat || !passenger) return
      capture('seat_selected', {
        seat: seat.id,
        row: seat.row,
        column: seat.column,
        passenger_index: passenger.index,
        state: 'available',
        price: seat.priceCents,
      })
    })
  }

  /**
   * Write the staged choices, one passenger at a time.
   *
   * A passenger can only move into a seat that is free in the store. When one passenger is moving
   * out of the seat another passenger wants, the first move has to be written first, so the writes
   * are ordered before they are sent.
   */
  async function confirm() {
    const movers = passengers.filter(
      (passenger) => staged[passenger.id] && staged[passenger.id] !== passenger.seatId,
    )
    if (movers.length === 0) return

    setConfirming(true)
    setNotice(null)

    const familySeatIds = selectedFamilySeatIds
    const familySelectionIsStaged =
      familySeatIds !== null &&
      familySeatIds.length === passengers.length &&
      passengers.every(
        (passenger, index) => staged[passenger.id] === familySeatIds[index],
      )

    try {
      if (familySeatIds && familySelectionIsStaged) {
        const response = await fetch(
          `/api/seats/${encodeURIComponent(flight.id)}/party`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              assignments: passengers.map((passenger, index) => ({
                passengerId: passenger.id,
                seatId: familySeatIds[index] ?? '',
              })),
            }),
          },
        )

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string
          }
          setNotice({
            kind: 'error',
            text:
              payload.message ??
              'We could not save all three seats together. No passengers were moved.',
          })
          return
        }
      } else {
        const occupancy = new Map<string, string>()
        for (const passenger of passengers) {
          if (passenger.seatId) occupancy.set(passenger.seatId, passenger.id)
        }

        const order: Passenger[] = []
        const remaining = [...movers]
        while (remaining.length > 0) {
          const index = remaining.findIndex((passenger) => {
            const target = staged[passenger.id]
            if (!target) return false
            const holder = occupancy.get(target)
            return !holder || holder === passenger.id
          })
          if (index === -1) {
            order.push(...remaining)
            break
          }
          const [passenger] = remaining.splice(index, 1)
          if (!passenger) break
          const target = staged[passenger.id]
          if (target) {
            for (const [seatId, holder] of occupancy) {
              if (holder === passenger.id) occupancy.delete(seatId)
            }
            occupancy.set(target, passenger.id)
          }
          order.push(passenger)
        }

        for (const passenger of order) {
          const seatId = staged[passenger.id]
          if (!seatId) continue
          const response = await fetch('/api/assignments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ passengerId: passenger.id, seatId }),
          })
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { message?: string }
            setNotice({
              kind: 'error',
              text:
                payload.message ??
                `We could not move ${passenger.firstName} to seat ${seatId}. Please pick another seat.`,
            })
            return
          }
        }
      }

      capture('seat_assignment_confirmed', {
        seats: stagedList,
        party_size: passengers.length,
        same_row: seatsAreSameRow(stagedList),
        contiguous: seatsAreContiguous(stagedList),
        additional_cost: seatFeeCents,
        interactions: interactions.current,
        elapsed_ms: Date.now() - openedAt.current,
      })

      setNotice({
        kind: 'success',
        text: familySelectionIsStaged
          ? 'Your three seats together are saved.'
          : 'Your seats are saved.',
      })
      router.refresh()
    } catch {
      setNotice({ kind: 'error', text: 'Something went wrong. Please try again.' })
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="grid gap-7 xl:grid-cols-[340px_minmax(0,1fr)_320px] xl:items-start">
      <div className="space-y-6">
        <Link
          href={`/trips/${reservation.code}`}
          aria-label="Back to Manage Trip"
          data-testid="back-to-manage-trip"
          className="pill pill-light px-6 py-3 text-[0.9rem]"
        >
          <ArrowLeftIcon size={16} />
          Back to Manage Trip
        </Link>

        <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
          Choose Seats
        </h1>

        <YourFlightCard flight={flight} partySize={passengers.length} />

        <TransactionDetails
          partySize={passengers.length}
          cabinName={flight.cabinName}
          seats={stagedList}
          fareCentsEach={flight.fareUsd * 100}
          seatFeeCents={seatFeeCents}
        />
      </div>

      <section
        aria-labelledby="seat-map-heading"
        className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_24px_54px_-36px_rgba(0,0,0,0.9)]"
      >
        <div className="flex justify-center pt-7">
          <PlaneNose className="h-[112px] w-[336px]" />
        </div>

        <div className="px-6 pb-4 text-center">
          <h2 id="seat-map-heading" className="text-xl font-bold text-ink">
            {seatMap.cabinName}
          </h2>
          <p className="mt-1 text-[0.8rem] text-ink-muted">
            Select a passenger, then select a seat. One passenger moves at a time.
          </p>
          <div className="mt-4">
            <SeatLegend />
          </div>
        </div>

        <div className="max-h-[560px] overflow-y-auto border-b border-line px-4 pb-6 pt-2">
          <div className="mx-auto w-fit">
            <div
              aria-hidden="true"
              className="mb-2 flex items-center gap-[6px] pl-8 pr-8 text-[0.65rem] font-semibold text-ink-muted"
            >
              {['A', 'B', 'C'].map((column) => (
                <span key={column} className="w-[44px] text-center">
                  {column}
                </span>
              ))}
              <span className="w-[34px]" />
              {['D', 'E', 'F'].map((column) => (
                <span key={column} className="w-[44px] text-center">
                  {column}
                </span>
              ))}
            </div>

            {seatMap.rows.map((row, rowIndex) => (
              <div key={row.row}>
                {row.isExitRow && !seatMap.rows[rowIndex - 1]?.isExitRow ? (
                  <div className="my-2 flex items-center gap-3">
                    <span className="h-px flex-1 bg-amber-ink/30" />
                    <span className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-amber-ink">
                      Exit row
                    </span>
                    <span className="h-px flex-1 bg-amber-ink/30" />
                  </div>
                ) : null}

                <div
                  role="group"
                  aria-label={`Row ${row.row}`}
                  className={`flex items-center gap-[6px] ${
                    row.isExtraLegroom
                      ? 'mb-[4px] rounded-[14px] bg-orange-tint pb-[6px] pt-[13px]'
                      : 'py-[3px]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="w-8 text-right text-[0.68rem] font-semibold text-ink-muted"
                  >
                    {row.row}
                  </span>
                  {row.left.map((seat) => {
                    const view = viewSeat(seat)
                    const owner = view.occupantPassengerId
                    return (
                      <span key={seat.id} className="flex w-[44px] justify-center">
                        <SeatButton
                          seat={view}
                          occupantFirstName={
                            owner ? (passengerById.get(owner)?.firstName ?? null) : null
                          }
                          onSelect={onSeatSelect}
                          onHover={onSeatHover}
                        />
                      </span>
                    )
                  })}
                  <span aria-hidden="true" className="w-[34px]" />
                  {row.right.map((seat) => {
                    const view = viewSeat(seat)
                    const owner = view.occupantPassengerId
                    return (
                      <span key={seat.id} className="flex w-[44px] justify-center">
                        <SeatButton
                          seat={view}
                          occupantFirstName={
                            owner ? (passengerById.get(owner)?.firstName ?? null) : null
                          }
                          onSelect={onSeatSelect}
                          onHover={onSeatHover}
                        />
                      </span>
                    )
                  })}
                  <span
                    aria-hidden="true"
                    className="w-8 text-left text-[0.68rem] font-semibold text-ink-muted"
                  >
                    {row.row}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          <div aria-live="polite" className="min-h-[46px]">
            {notice ? (
              <p
                role={notice.kind === 'error' ? 'alert' : undefined}
                data-testid="seat-notice"
                className={`flex items-start gap-2 rounded-[14px] px-4 py-3 text-sm font-medium ${
                  notice.kind === 'error'
                    ? 'bg-orange-tint text-ink'
                    : 'bg-blue-tint text-ink'
                }`}
              >
                {notice.kind === 'error' ? (
                  <WarningIcon className="mt-0.5 shrink-0 text-amber-ink" />
                ) : null}
                {notice.text}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={confirm}
            disabled={!hasChanges || confirming}
            aria-label="Confirm seats"
            data-testid="confirm-seats"
            className="pill pill-primary mt-3 w-full px-7 py-4 text-[1rem]"
          >
            {confirming ? 'Saving...' : 'Confirm seats'}
          </button>
        </div>
      </section>

      <aside className="space-y-6">
        <section aria-labelledby="passenger-selector-heading" className="card p-6">
          <h2 id="passenger-selector-heading" className="text-lg font-bold text-ink">
            Passengers
          </h2>
          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-muted">
            Select a passenger, then select a seat on the map.
          </p>
          <div className="mt-4">
            <PassengerSelector
              passengers={passengers}
              stagedSeats={staged}
              selectedIndex={selectedIndex}
              onSelect={onPassengerSelect}
            />
          </div>
        </section>

        <section aria-labelledby="family-seats-heading" className="card p-6">
          <h2 id="family-seats-heading" className="text-lg font-bold text-ink">
            Find three seats together
          </h2>
          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-muted">
            Search for three adjacent seats in one row on the same side of the aisle. Results are
            ordered by lowest total extra cost.
          </p>

          <button
            type="button"
            onClick={findFamilySeats}
            disabled={partyFeedback?.kind === 'loading' || passengers.length !== 3}
            aria-label="Find three seats together"
            data-testid="find-three-seats-together"
            className="pill pill-outline mt-4 w-full px-5 py-3 text-[0.85rem]"
          >
            {partyFeedback?.kind === 'loading'
              ? 'Searching...'
              : 'Find three seats together'}
          </button>

          {passengers.length !== 3 ? (
            <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-muted">
              This option is available for bookings with three passengers.
            </p>
          ) : null}

          <div
            aria-live="polite"
            aria-busy={partyFeedback?.kind === 'loading'}
            data-testid="family-seat-status"
            className="mt-3 min-h-[20px]"
          >
            {partyFeedback ? (
              <p
                role={partyFeedback.kind === 'error' ? 'alert' : 'status'}
                className={`text-[0.78rem] leading-relaxed ${
                  partyFeedback.kind === 'error' ? 'text-amber-ink' : 'text-ink-soft'
                }`}
              >
                {partyFeedback.text}
              </p>
            ) : null}
          </div>

          {partyBlocks.length > 0 ? (
            <ol
              aria-label="Three adjacent seat options"
              data-testid="family-seat-results"
              className="mt-4 space-y-3"
            >
              {partyBlocks.map((block, index) => {
                const selected =
                  selectedFamilySeatIds?.join(',') === block.seatIds.join(',')

                return (
                  <li key={block.seatIds.join('-')}>
                    <button
                      type="button"
                      onClick={() => selectFamilyBlock(block)}
                      disabled={confirming}
                      aria-label={`Select three seats together: ${block.seatIds.join(', ')}, total extra cost ${formatSeatPrice(block.extraCostCents)}`}
                      aria-pressed={selected}
                      data-testid={`family-seat-option-${index + 1}`}
                      className={`w-full rounded-[14px] border px-4 py-3 text-left ${
                        selected
                          ? 'border-line-strong bg-blue-tint'
                          : 'border-line bg-surface'
                      }`}
                    >
                      <span className="block text-sm font-bold text-ink">
                        {index + 1}. Seats {block.seatIds.join(', ')}
                      </span>
                      <span className="mt-1 block text-[0.78rem] text-ink-muted">
                        Total extra cost: {formatSeatPrice(block.extraCostCents)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </section>

        <section aria-labelledby="seat-rules-heading" className="rounded-[20px] bg-blue-tint p-6">
          <h2 id="seat-rules-heading" className="text-base font-bold text-ink">
            Seat rules
          </h2>
          <ul className="mt-3 space-y-2 text-[0.82rem] leading-relaxed text-ink-soft">
            <li>Rows 15 and 16 are exit rows. Adults only.</li>
            <li>Rows 1 to 3, 15 and 16 have extra legroom and cost more.</li>
            <li>A child under 13 must sit next to an adult on this booking.</li>
            <li>The aisle is between seat C and seat D.</li>
          </ul>
          <Link
            href="/help/how-do-i-change-my-seat"
            aria-label="Read the seat help"
            data-testid="read-seat-help"
            className="pill pill-outline mt-5 px-5 py-2.5 text-[0.82rem]"
          >
            Read the seat help
          </Link>
        </section>
      </aside>
    </div>
  )
}
