import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTokenExpiry, tokenExpiryWarning } from '../../lib/token-expiry'

const DAY = 86_400_000
const HEADER = '2027-10-03 00:00:00 UTC'
const EXPIRES = Date.parse('2027-10-03T00:00:00Z')

test('parses the UTC form GitHub sends', () => {
  assert.deepEqual(parseTokenExpiry(HEADER), { at: EXPIRES, date: '2027-10-03' })
})

test('an offset moves the instant but keeps the date as written', () => {
  assert.deepEqual(parseTokenExpiry('2027-10-03 00:00:00 -0700'), {
    at: Date.parse('2027-10-03T07:00:00Z'),
    date: '2027-10-03',
  })
  assert.deepEqual(parseTokenExpiry('2027-10-03 00:00:00 +0100'), {
    at: Date.parse('2027-10-02T23:00:00Z'),
    date: '2027-10-03',
  })
  assert.equal(parseTokenExpiry('2027-10-03 00:00:00 +05:30')?.at, Date.parse('2027-10-02T18:30:00Z'))
})

test('tolerates ISO 8601, missing seconds or zone, lower case and padding', () => {
  for (const header of [
    '2027-10-03T00:00:00Z',
    '2027-10-03T00:00:00.000Z',
    '2027-10-03 00:00 UTC',
    '2027-10-03 00:00:00',
    '2027-10-03 00:00:00 gmt',
    '  2027-10-03 00:00:00 utc \n',
  ]) {
    assert.deepEqual(parseTokenExpiry(header), { at: EXPIRES, date: '2027-10-03' }, header)
  }
})

test('missing or odd input gives null, never a throw', () => {
  const odd: unknown[] = [
    null,
    undefined,
    '',
    '   ',
    'never',
    '2027-10-03',
    '03/10/2027 00:00:00',
    'Sun, 03 Oct 2027 00:00:00 GMT',
    '2027-10-03 00:00:00 PST',
    '2027-10-03 00:00:00 UTC, 2027-10-03 00:00:00 UTC',
    '2027-13-01 00:00:00 UTC',
    '2027-02-30 00:00:00 UTC',
    '2027-10-03 24:00:00 UTC',
    '2027-10-03 12:60:00 UTC',
    42,
    {},
    [HEADER],
  ]
  for (const header of odd) {
    assert.equal(parseTokenExpiry(header), null, String(header))
    assert.equal(tokenExpiryWarning(header, EXPIRES - DAY), null, String(header))
  }
})

test('warns only within 30 days of expiry', () => {
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES - 90 * DAY), null)
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES - 30 * DAY - 1), null)
  assert.deepEqual(tokenExpiryWarning(HEADER, EXPIRES - 30 * DAY), { days: 30, date: '2027-10-03' })
  assert.deepEqual(tokenExpiryWarning(HEADER, EXPIRES - 12 * DAY), { days: 12, date: '2027-10-03' })
})

test('a part day counts as a whole one, and 0 means expired', () => {
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES - 12 * DAY - 1)?.days, 13)
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES - 1)?.days, 1)
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES)?.days, 0)
  assert.equal(tokenExpiryWarning(HEADER, EXPIRES + 5 * DAY)?.days, 0)
})

test('counts days to the real instant when GitHub gives an offset', () => {
  // 00:00 at -0700 is 07:00 UTC, so at 06:00 UTC the day before there is 1 day and an hour left.
  const now = Date.parse('2027-10-02T06:00:00Z')
  assert.deepEqual(tokenExpiryWarning('2027-10-03 00:00:00 -0700', now), { days: 2, date: '2027-10-03' })
  assert.deepEqual(tokenExpiryWarning(HEADER, now), { days: 1, date: '2027-10-03' })
})

test('a custom window and an unusable clock', () => {
  assert.deepEqual(tokenExpiryWarning(HEADER, EXPIRES - 45 * DAY, 60), { days: 45, date: '2027-10-03' })
  assert.equal(tokenExpiryWarning(HEADER, Number.NaN), null)
})
