'use client'

import { CheckIcon } from '../ui/icons'

/**
 * A checkbox that keeps the real input. The input stays in the DOM and stays focusable, so a
 * keyboard and a screen reader work normally. Only the box is drawn by hand.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  trailing,
  leading,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  trailing?: React.ReactNode
  leading?: React.ReactNode
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3 py-1.5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue ${
          checked ? 'border-navy bg-navy text-white' : 'border-line bg-white text-transparent'
        }`}
      >
        <CheckIcon />
      </span>
      {leading}
      <span className="flex-1 text-[0.9rem] font-medium text-navy">{label}</span>
      {trailing}
    </label>
  )
}
