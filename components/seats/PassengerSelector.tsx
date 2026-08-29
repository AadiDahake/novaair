'use client'

import type { Passenger } from '../../lib/seats/types'

/**
 * The party, as a single-choice list. One passenger is selected at a time, and a seat click moves
 * that one passenger. There is no way to select more than one passenger.
 */
export function PassengerSelector({
  passengers,
  stagedSeats,
  selectedIndex,
  onSelect,
}: {
  passengers: Passenger[]
  stagedSeats: Record<string, string | null>
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby="passenger-selector-heading"
      className="space-y-2.5"
    >
      {passengers.map((passenger, index) => {
        const isSelected = index === selectedIndex
        const seat = stagedSeats[passenger.id] ?? null
        const changed = seat !== passenger.seatId
        return (
          <button
            key={passenger.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${passenger.firstName} ${passenger.lastName}, ${
              passenger.type === 'adult' ? 'adult' : `child age ${passenger.age}`
            }, seat ${seat ?? 'not chosen'}`}
            data-passenger-index={index}
            data-passenger-id={passenger.id}
            onClick={() => onSelect(index)}
            className={`flex w-full items-center gap-3 rounded-[16px] border-[1.5px] px-4 py-3 text-left transition-colors ${
              isSelected
                ? 'border-blue bg-blue-tint'
                : 'border-line bg-white hover:border-[#c9cbe0]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isSelected ? 'bg-blue text-white' : 'bg-blue-tint text-blue'
              }`}
            >
              {passenger.firstName.slice(0, 1)}
              {passenger.lastName.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-navy">
                {passenger.firstName} {passenger.lastName}
              </span>
              <span className="block text-xs text-ink-muted">
                {passenger.type === 'adult' ? 'Adult' : `Child, age ${passenger.age}`}
              </span>
            </span>
            <span className="text-right">
              <span
                className={`block text-base font-extrabold ${changed ? 'text-blue' : 'text-navy'}`}
              >
                {seat ?? '--'}
              </span>
              {changed ? (
                <span className="block text-[0.65rem] font-semibold text-blue">changed</span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
