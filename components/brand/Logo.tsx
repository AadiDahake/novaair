/**
 * The NovaAir mark: a sun of blue rays turning around a bright core.
 * Drawn as one SVG so it stays sharp at any size and needs no image file.
 */
export function LogoMark({ size = 34, className = '' }: { size?: number; className?: string }) {
  const rays = Array.from({ length: 12 }, (_, index) => index * 30)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="novaair-ray" x1="24" y1="2" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#bcd6ff" />
          <stop offset="100%" stopColor="#3f82ff" />
        </linearGradient>
      </defs>
      {rays.map((angle, index) => {
        const long = index % 2 === 0
        return (
          <rect
            key={angle}
            x={long ? 21.9 : 22.4}
            y={long ? 2.6 : 7.2}
            width={long ? 4.2 : 3.2}
            height={long ? 18 : 13.4}
            rx={long ? 2.1 : 1.6}
            fill="url(#novaair-ray)"
            opacity={long ? 1 : 0.6}
            transform={`rotate(${angle} 24 24)`}
          />
        )
      })}
      <circle cx="24" cy="24" r="6.6" fill="#2f7bff" />
      <circle cx="24" cy="24" r="2.6" fill="#f4f6ff" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={32} />
      <span className="text-[1.35rem] font-bold tracking-tight text-ink">NovaAir</span>
    </span>
  )
}
