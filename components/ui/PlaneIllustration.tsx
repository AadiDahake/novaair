/** A wide, calm cabin-window scene. Drawn, so the site ships no photograph. */
export function CabinIllustration({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 180"
      className={className}
      role="img"
      aria-label="Illustration of a NovaAir cabin window with sky outside"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="cabin-sky" x1="0" y1="0" x2="0" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7fb2ff" />
          <stop offset="60%" stopColor="#cfe0ff" />
          <stop offset="100%" stopColor="#f2ebff" />
        </linearGradient>
        <clipPath id="cabin-window">
          <rect x="86" y="26" width="148" height="128" rx="62" />
        </clipPath>
      </defs>
      <rect width="320" height="180" fill="#eef2ff" />
      <g clipPath="url(#cabin-window)">
        <rect x="86" y="26" width="148" height="128" fill="url(#cabin-sky)" />
        <circle cx="196" cy="60" r="17" fill="#fff3d6" />
        <ellipse cx="120" cy="112" rx="44" ry="15" fill="#ffffff" opacity="0.85" />
        <ellipse cx="176" cy="128" rx="56" ry="17" fill="#ffffff" opacity="0.7" />
        <ellipse cx="220" cy="102" rx="30" ry="11" fill="#ffffff" opacity="0.6" />
      </g>
      <rect
        x="86"
        y="26"
        width="148"
        height="128"
        rx="62"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
      />
      <rect
        x="86"
        y="26"
        width="148"
        height="128"
        rx="62"
        fill="none"
        stroke="#dfe4f5"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** The nose of the aircraft, drawn above the seat map so the panel reads as a fuselage. */
export function PlaneNose({ className = '' }: { className?: string }) {
  const outline =
    'M34 128 C34 98 58 56 100 26 C120 12 140 4 160 4 C180 4 200 12 220 26 C262 56 286 98 286 128 Z'
  return (
    <svg viewBox="0 0 320 128" className={className} aria-hidden="true" focusable="false">
      <path d={outline} fill="#eef2ff" />
      <path d={outline} fill="none" stroke="#dbe1f5" strokeWidth="1.6" />
      <path
        d="M134 62c-10 4-17 9-22 15-1.6 2-.2 4.3 2.3 4.3H134c1.9 0 3.4-1.4 3.4-3.2V65.2c0-2.2-1.6-3.7-3.4-3.2Z"
        fill="#ffffff"
        stroke="#c9d3ee"
        strokeWidth="1.4"
      />
      <path
        d="M186 62c10 4 17 9 22 15 1.6 2 .2 4.3-2.3 4.3H186c-1.9 0-3.4-1.4-3.4-3.2V65.2c0-2.2 1.6-3.7 3.4-3.2Z"
        fill="#ffffff"
        stroke="#c9d3ee"
        strokeWidth="1.4"
      />
      <path d="M160 34v56" stroke="#dbe1f5" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
