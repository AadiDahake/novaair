import { formatUsd } from '../../lib/seats/labels'

const GOVERNMENT_TAX_RATE = 0.075
/** US security fee, for each passenger, in cents. */
const SECURITY_FEE_CENTS = 560

export function TransactionDetails({
  partySize,
  cabinName,
  seats,
  fareCentsEach,
  seatFeeCents,
}: {
  partySize: number
  cabinName: string
  seats: string[]
  fareCentsEach: number
  seatFeeCents: number
}) {
  const priceCents = fareCentsEach * partySize
  const subTotalCents = priceCents + seatFeeCents
  const governmentTaxCents = Math.round(priceCents * GOVERNMENT_TAX_RATE)
  const totalTaxCents = governmentTaxCents + SECURITY_FEE_CENTS * partySize
  const grandTotalCents = subTotalCents + totalTaxCents

  return (
    <section aria-labelledby="transaction-heading" className="card p-6">
      <h2 id="transaction-heading" className="text-lg font-bold text-navy">
        Transaction Details
      </h2>

      <dl className="mt-5 space-y-3 text-sm">
        <Row label="Quantity" value={`${partySize} ${partySize === 1 ? 'person' : 'people'}`} />
        <Row label="Tiers" value={cabinName} />
        <Row label="Seats" value={seats.length > 0 ? seats.join(', ') : 'Not chosen'} />

        <div className="border-t border-line pt-3" />
        <Row label="Price" value={formatUsd(priceCents)} />
        <Row label="Govt. Tax" value={formatUsd(governmentTaxCents)} />
        <Row label="Seat fees" value={formatUsd(seatFeeCents)} />
        <Row label="Sub Total" value={formatUsd(subTotalCents)} strong />

        <div className="border-t border-line pt-3" />
        <Row label="Total Tax" value={formatUsd(totalTaxCents)} />
        <div className="flex items-center justify-between gap-4 pt-1">
          <dt className="text-sm font-semibold text-navy">Grand Total</dt>
          <dd className="text-[1.65rem] font-extrabold leading-none text-blue">
            {formatUsd(grandTotalCents)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={strong ? 'font-bold text-navy' : 'font-semibold text-navy'}>{value}</dd>
    </div>
  )
}
