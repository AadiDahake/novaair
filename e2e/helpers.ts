import { expect, type Page } from '@playwright/test'

/**
 * The steps a customer takes to move a party by hand.
 *
 * They are helpers, not one script, because the same steps drive two jobs: the end-to-end test,
 * and the run that produces real PostHog sessions from this site.
 */

export const DEMO = {
  code: 'NVA7K2',
  lastName: 'Dahake',
  startSeats: ['12A', '18C', '24F'],
  targetSeats: ['21A', '21B', '21C'],
  passengers: ['Aadi', 'Kiran', 'Mira'],
} as const

/** Put the booking back to 12A, 18C and 24F. */
export async function resetDemo(page: Page): Promise<void> {
  const response = await page.request.post('/api/demo/reset')
  expect(response.ok()).toBe(true)
}

/** Find the booking from the My Booking page, and land on Manage Trip. */
export async function findReservation(
  page: Page,
  code: string = DEMO.code,
  lastName: string = DEMO.lastName,
): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'My Booking' }).first().click()
  await expect(page.getByRole('heading', { name: 'My Booking', level: 1 })).toBeVisible()

  await page.getByLabel('Confirmation code').fill(code)
  await page.getByLabel('Last name').fill(lastName)
  await page.getByRole('button', { name: 'Find my booking' }).click()

  await expect(page.getByRole('heading', { name: 'Manage Trip', level: 1 })).toBeVisible()
}

/** Open the Seats section of Manage Trip. */
export async function openSeatsSection(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Seats' }).click()
  await expect(page.getByRole('tab', { name: 'Seats' })).toHaveAttribute('aria-selected', 'true')
}

/** Follow "Change seats" through to the seat map. */
export async function openSeatMap(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Change seats' }).click()
  await expect(page.getByRole('heading', { name: 'Choose Seats', level: 1 })).toBeVisible()
  await expect(page.locator('[data-seat="21A"]')).toBeVisible()
}

/** Pick one passenger by their place in the party, counting from zero. */
export async function selectPassenger(page: Page, index: number): Promise<void> {
  const passenger = page.locator(`[data-passenger-index="${index}"]`)
  await passenger.click()
  await expect(passenger).toHaveAttribute('aria-checked', 'true')
}

/** Select one seat for whichever passenger is chosen now. */
export async function selectSeat(page: Page, seatId: string): Promise<void> {
  await page.locator(`[data-seat="${seatId}"]`).click()
}

/** Move one passenger to one seat. This is the whole manual loop, for one person. */
export async function movePassengerToSeat(
  page: Page,
  passengerIndex: number,
  seatId: string,
): Promise<void> {
  await selectPassenger(page, passengerIndex)
  await selectSeat(page, seatId)
  await expect(page.locator(`[data-seat="${seatId}"]`)).toHaveAttribute('data-state', 'occupied')
}

/** Save the staged seats. */
export async function confirmSeats(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm seats' }).click()
  await expect(page.getByTestId('seat-notice')).toHaveText('Your seats are saved.')
}

/** The seat shown against each passenger on the seat page. */
export async function seatsOnSeatPage(page: Page): Promise<string[]> {
  const labels = await page.locator('[data-passenger-index]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  return labels.map((label) => label.split('seat ')[1]?.trim() ?? '')
}
