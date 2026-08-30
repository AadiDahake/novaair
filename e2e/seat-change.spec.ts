import { expect, test } from '@playwright/test'
import {
  DEMO,
  confirmSeats,
  findReservation,
  movePassengerToSeat,
  openSeatMap,
  openSeatsSection,
  resetDemo,
  seatsOnSeatPage,
  selectPassenger,
  selectSeat,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

test('a customer moves a party of three to 21A, 21B and 21C by hand, and the seats stay', async ({
  page,
}) => {
  await findReservation(page)

  // The party starts scattered.
  for (const seat of DEMO.startSeats) {
    await expect(page.getByText(seat, { exact: true }).first()).toBeVisible()
  }

  await openSeatsSection(page)
  await openSeatMap(page)

  // One passenger at a time. There is no other way to do this on NovaAir.
  await movePassengerToSeat(page, 0, '21A')
  await movePassengerToSeat(page, 1, '21B')
  await movePassengerToSeat(page, 2, '21C')

  expect(await seatsOnSeatPage(page)).toEqual([...DEMO.targetSeats])

  await confirmSeats(page)

  // Reload, and the seats are still there.
  await page.reload()
  await expect(page.locator('[data-seat="21A"]')).toHaveAttribute('data-state', 'occupied')
  expect(await seatsOnSeatPage(page)).toEqual([...DEMO.targetSeats])

  // The trip page agrees.
  await page.goto(`/trips/${DEMO.code}`)
  await expect(page.getByRole('heading', { name: 'Manage Trip', level: 1 })).toBeVisible()
  for (const seat of DEMO.targetSeats) {
    await expect(page.getByText(seat, { exact: true }).first()).toBeVisible()
  }
})

test('the seat map refuses a taken seat, a blocked seat and a child in an exit row', async ({
  page,
}) => {
  await findReservation(page)
  await openSeatsSection(page)
  await openSeatMap(page)

  // A seat held for accessible seating.
  await selectPassenger(page, 0)
  await selectSeat(page, '20D')
  await expect(page.getByTestId('seat-notice')).toContainText('accessible seating')

  // A child cannot sit in an exit row.
  await selectPassenger(page, 1)
  await selectSeat(page, '16D')
  await expect(page.getByTestId('seat-notice')).toContainText('exit row')
  await expect(page.getByTestId('seat-notice')).toContainText('adults only')

  // A seat another customer already has.
  const booked = page.locator('[data-state="booked"]').first()
  await booked.click()
  await expect(page.getByTestId('seat-notice')).toContainText('already taken')
})

test('the path Manage Trip, Seats, Change seats exists with those exact names', async ({ page }) => {
  await findReservation(page)
  await expect(page.getByRole('link', { name: 'Manage Trip' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Seats' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Change seats' })).toBeVisible()
})

test('NovaAir offers no control that seats a party together', async ({ page }) => {
  await findReservation(page)
  await openSeatsSection(page)
  await openSeatMap(page)

  for (const name of [/find seats together/i, /seats together/i, /move everyone/i, /seat my family/i]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
    await expect(page.getByRole('link', { name })).toHaveCount(0)
  }
})

test('every seat carries an accessible name that says its state', async ({ page }) => {
  await findReservation(page)
  await openSeatsSection(page)
  await openSeatMap(page)

  await expect(page.locator('[data-seat="21A"]')).toHaveAccessibleName(
    'Seat 21A, available, no extra cost',
  )
  await expect(page.locator('[data-seat="20D"]')).toHaveAccessibleName(
    'Seat 20D, blocked for accessibility',
  )
  await expect(page.locator('[data-seat="16D"]')).toHaveAccessibleName(
    'Seat 16D, exit row, adults only, 39 dollars',
  )
  await expect(page.locator('[data-seat="16C"]')).toHaveAccessibleName(
    'Seat 16C, exit row, adults only, booked',
  )
  await expect(page.locator('[data-seat="12A"]')).toHaveAccessibleName('Seat 12A, chosen for Sam')
})

test('a help article opens from the help center', async ({ page }) => {
  await page.goto('/help')
  await page.getByRole('link', { name: 'How do I change my seat?' }).click()
  await expect(page.getByRole('heading', { name: 'How do I change my seat?', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Change a seat online', level: 2 })).toBeVisible()
})
