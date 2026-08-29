import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Schedule' }

const SCHEDULE = [
  { flight: 'NA 214', route: 'SFO to JFK', departs: '08:15', arrives: '16:47', days: 'Every day' },
  { flight: 'NA 318', route: 'SFO to JFK', departs: '11:40', arrives: '20:05', days: 'Every day' },
  { flight: 'NA 402', route: 'SFO to ORD', departs: '07:05', arrives: '13:22', days: 'Mon to Fri' },
  { flight: 'NA 518', route: 'SEA to JFK', departs: '06:30', arrives: '15:02', days: 'Every day' },
  { flight: 'NA 620', route: 'AUS to SFO', departs: '09:45', arrives: '11:38', days: 'Tue to Sun' },
  { flight: 'NA 733', route: 'DEN to MIA', departs: '14:10', arrives: '20:02', days: 'Every day' },
  { flight: 'NA 811', route: 'BOS to SFO', departs: '16:25', arrives: '20:14', days: 'Mon to Sat' },
]

export default function SchedulePage() {
  return (
    <div>
      <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-navy">Schedule</h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-ink-muted">
        The NovaAir timetable for autumn 2026. All times are local to each airport.
      </p>

      <div className="card mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">NovaAir flight timetable for autumn 2026</caption>
          <thead>
            <tr className="border-b border-line">
              {['Flight', 'Route', 'Departs', 'Arrives', 'Days'].map((heading) => (
                <th key={heading} scope="col" className="px-6 py-4 text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCHEDULE.map((row) => (
              <tr key={row.flight} className="border-b border-line last:border-0">
                <th scope="row" className="px-6 py-4 font-bold text-navy">
                  {row.flight}
                </th>
                <td className="px-6 py-4 text-navy-soft">{row.route}</td>
                <td className="px-6 py-4 font-semibold text-navy">{row.departs}</td>
                <td className="px-6 py-4 font-semibold text-navy">{row.arrives}</td>
                <td className="px-6 py-4 text-ink-muted">{row.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
