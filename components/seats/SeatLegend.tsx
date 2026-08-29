const ITEMS = [
  { label: 'Available', box: 'border-[2px] border-orange bg-white' },
  { label: 'Booked', box: 'bg-seat-booked' },
  { label: 'Selected', box: 'bg-blue' },
  { label: 'Blocked', box: 'seat-blocked-hatch border-[1.5px] border-[#d9dbe4]' },
]

export function SeatLegend() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden="true" className={`h-4 w-4 rounded-[5px] ${item.box}`} />
          <span className="text-[0.78rem] font-medium text-ink-muted">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
