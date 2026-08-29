/** The route drawn as "SFO o--o JFK", with the stop count marked on the line. */
export function RouteLine({
  from,
  to,
  stops = 0,
  className = '',
}: {
  from: string
  to: string
  stops?: number
  className?: string
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="text-base font-bold text-navy">{from}</span>
      <span aria-hidden="true" className="flex flex-1 items-center gap-1">
        <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-blue bg-white" />
        <span className="h-px flex-1 bg-line" />
        {Array.from({ length: stops }, (_, index) => (
          <span key={index} className="flex items-center gap-1">
            <span className="h-[5px] w-[5px] rounded-full bg-orange" />
            <span className="h-px flex-1 bg-line" />
          </span>
        ))}
        <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-blue bg-blue" />
      </span>
      <span className="text-base font-bold text-navy">{to}</span>
    </div>
  )
}
