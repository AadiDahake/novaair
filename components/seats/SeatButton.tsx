'use client'

import type { Seat } from '../../lib/seats/types'
import { priceTag, seatAriaLabel } from '../../lib/seats/labels'

const SHELL_BY_STATE: Record<string, string> = {
  available: 'bg-surface-raised border-[2px] border-orange text-ink hover:bg-orange-tint',
  booked: 'bg-seat-booked border-[2px] border-seat-edge text-ink-muted',
  blocked: 'seat-blocked-hatch border-[2px] border-seat-edge text-ink-muted',
  occupied: 'bg-blue border-[2px] border-blue text-white',
}

const TAB_BY_STATE: Record<string, string> = {
  available: 'bg-orange',
  booked: 'bg-seat-edge',
  blocked: 'bg-seat-edge',
  occupied: 'bg-blue-dark',
}

/**
 * One seat, drawn as a seat seen from above: a rounded pad with a small armrest on each side.
 * Every state stays a real button. A seat that cannot be taken is not disabled, because a click on
 * it must be able to explain why.
 */
export function SeatButton({
  seat,
  occupantFirstName,
  onSelect,
  onHover,
}: {
  seat: Seat
  occupantFirstName: string | null
  onSelect: (seat: Seat) => void
  onHover: (seat: Seat) => void
}) {
  const shell = SHELL_BY_STATE[seat.state] ?? SHELL_BY_STATE.available
  const tab = TAB_BY_STATE[seat.state] ?? TAB_BY_STATE.available
  const tag = seat.state === 'available' ? priceTag(seat.priceCents) : ''

  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden="true" className={`h-4 w-[3px] rounded-l-[3px] ${tab}`} />
      <button
        type="button"
        data-seat={seat.id}
        data-row={seat.row}
        data-column={seat.column}
        data-state={seat.state}
        aria-label={seatAriaLabel(seat, occupantFirstName)}
        onClick={() => onSelect(seat)}
        onMouseEnter={() => onHover(seat)}
        onFocus={() => onHover(seat)}
        className={`flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-[0.68rem] font-bold transition-colors ${shell}`}
      >
        {seat.id}
      </button>
      <span aria-hidden="true" className={`h-4 w-[3px] rounded-r-[3px] ${tab}`} />
      {tag ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-[3px] -top-[7px] rounded-full bg-orange px-[5px] py-[1px] text-[0.5rem] font-bold leading-[1.35] text-ink-inverse"
        >
          {tag}
        </span>
      ) : null}
    </span>
  )
}
