// Run with `npm test`. The FBT vehicle report must stay laid out exactly like the one the managers already get.
// The vehicle and trips here are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fbtDate, fbtFileName, fbtReport, FBT_REASON } from '../src/utils/fbtReport.js'
import { describeQuarter } from '../src/utils/outOfTown.js'

const quarter = describeQuarter(2026, 3) // Q2 (Jul-Sep) 2026
const generated = new Date(2026, 9, 5)   // Monday 5 October 2026

test('dates read like "6 Jul 2026", and September is "Sept"', () => {
  assert.equal(fbtDate('2026-07-06'), '6 Jul 2026')
  assert.equal(fbtDate('2026-09-14'), '14 Sept 2026')
  assert.equal(fbtDate('2027-01-02'), '2 Jan 2027')
  assert.equal(fbtDate('2026-12-31'), '31 Dec 2026')
})

test('the report is laid out exactly like the one already being sent', () => {
  const text = fbtReport({
    vehicle: '2024 Example Car (ABC123)',
    quarter,
    trips: [
      { notes: 'Napier', dates: ['2026-07-06', '2026-07-07'] },
      { notes: 'Queenstown', dates: ['2026-09-30'] },
    ],
    generated,
  })
  assert.equal(text, [
    'FBT VEHICLE UNAVAILABILITY REPORT',
    '='.repeat(50),
    'Vehicle: 2024 Example Car (ABC123)',
    'Quarter: Q2 (Jul-Sep) 2026',
    'Total Unavailable Days: 3',
    '',
    'DETAILED RECORDS',
    '-'.repeat(50),
    '',
    'Reason: Away from home - car not available for personal use',
    'Notes: Napier',
    'Dates (2 days):',
    '  - 6 Jul 2026',
    '  - 7 Jul 2026',
    '',
    'Reason: Away from home - car not available for personal use',
    'Notes: Queenstown',
    'Dates (1 day):',
    '  - 30 Sept 2026',
    '',
    '='.repeat(50),
    'Report generated: Monday, 5 October 2026',
    '',
  ].join('\n'))
})

test('plain text: LF line endings, one newline at the end, no byte-order mark', () => {
  const text = fbtReport({ vehicle: 'Car', quarter, trips: [{ notes: 'Napier', dates: ['2026-07-06'] }], generated })
  assert.ok(!text.includes('\r'))
  assert.ok(text.endsWith('2026\n') && !text.endsWith('\n\n'))
  assert.ok(!text.startsWith('﻿'))
})

test('the total adds up every record', () => {
  const trips = [
    { notes: 'A', dates: ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'] },
    { notes: 'B', dates: ['2026-07-13', '2026-07-14'] },
    { notes: 'C', dates: ['2026-07-22'] },
  ]
  const text = fbtReport({ vehicle: 'Car', quarter, trips, generated })
  assert.match(text, /^Total Unavailable Days: 7$/m)
  assert.equal(text.split('\n').filter(l => l === `Reason: ${FBT_REASON}`).length, 3)
  assert.match(text, /^Dates \(4 days\):$/m)
  assert.match(text, /^Dates \(1 day\):$/m)
})

test('a quarter with no days still produces a report', () => {
  const text = fbtReport({ vehicle: 'Car', quarter, trips: [], generated })
  assert.match(text, /^Total Unavailable Days: 0$/m)
  assert.match(text, /^No days recorded for this quarter\.$/m)
  assert.ok(!text.includes('Reason:'))
})

test('the file is named like the one already being sent', () => {
  assert.equal(fbtFileName(quarter), 'FBT-Report-Q2--Jul-Sep--2026.txt')
  assert.equal(fbtFileName(describeQuarter(2027, 1)), 'FBT-Report-Q4--Jan-Mar--2027.txt')
})
