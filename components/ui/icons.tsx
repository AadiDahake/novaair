type IconProps = { className?: string; size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false as const,
})

export function PhoneIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6.3 3.5h3l1.4 3.5-1.9 1.4a12 12 0 0 0 5.3 5.3l1.4-1.9 3.5 1.4v3a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 4.5 5.5a1.8 1.8 0 0 1 1.8-2Z" />
    </svg>
  )
}

export function TicketIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 8.2V6.4a1.4 1.4 0 0 1 1.4-1.4h14.2a1.4 1.4 0 0 1 1.4 1.4v1.8a2.4 2.4 0 0 0 0 7.6v1.8a1.4 1.4 0 0 1-1.4 1.4H4.9a1.4 1.4 0 0 1-1.4-1.4v-1.8a2.4 2.4 0 0 0 0-7.6Z" />
      <path d="M14 5v14" strokeDasharray="2 2.4" />
    </svg>
  )
}

export function ArrowLeftIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function ArrowUpIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

export function ArrowRightIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function CheckIcon({ className, size = 14 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.6}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

export function SearchIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  )
}

export function WarningIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5 21 19.5H3Z" />
      <path d="M12 10.5v3.4" />
      <path d="M12 16.6h.01" />
    </svg>
  )
}
