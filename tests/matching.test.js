import assert from 'node:assert';
import { roundTo15Min, calculateZeitabschnitt, secondsToDecimalHours } from '../src/utils/time.js';
import { parseTicketAndTitle, matchProject, matchBookingTag, calculateSimilarity } from '../src/utils/matching.js';

console.log('🧪 Running TMetric to Portal Sync Unit Tests...\n');

// --- 1. Test Time Utilities ---
console.log('1. Testing Time Utilities...');

// Test 15 min rounding
assert.strictEqual(roundTo15Min(0.1), '0,25', '0.1h should round to 0,25');
assert.strictEqual(roundTo15Min(0.3), '0,25', '0.3h should round to 0,25');
assert.strictEqual(roundTo15Min(0.4), '0,50', '0.4h should round to 0,50');
assert.strictEqual(roundTo15Min(1.15), '1,25', '1.15h should round to 1,25');
assert.strictEqual(roundTo15Min(1.78), '1,75', '1.78h should round to 1,75');
assert.strictEqual(roundTo15Min(1.9), '2,00', '1.9h should round to 2,00');

console.log('   ✓ 15-minute interval rounding passed');

// Test getPastDates
import { getPastDates } from '../src/utils/time.js';
const pastDates = getPastDates(3, '2026-08-13');
assert.deepStrictEqual(pastDates, ['2026-08-11', '2026-08-12', '2026-08-13'], 'getPastDates(3) should return last 3 days ending on baseDate');

console.log('   ✓ Past dates generator passed');

// Test Zeitabschnitt calculation
const sampleEntries = [
  {
    startTime: '2026-05-26T08:00:00Z',
    endTime: '2026-05-26T12:00:00Z',
    duration: 14400, // 4 hours = 240 mins
  },
  {
    startTime: '2026-05-26T13:00:00Z',
    endTime: '2026-05-26T17:00:00Z',
    duration: 14400, // 4 hours = 240 mins
  }
];
const za = calculateZeitabschnitt(sampleEntries);
assert.ok(za, 'Zeitabschnitt should be calculated');
assert.strictEqual(za.breakTimeMins, 60, 'Break time should be 60 minutes (9h span - 8h worked)');
assert.strictEqual(za.totalWorkedMins, 480, 'Total worked should be 480 mins');

console.log('   ✓ Zeitabschnitt and break time calculation passed');


// --- 2. Test Ticket & Title Parsing ---
console.log('\n2. Testing Ticket & Title Parsing...');

const testCases = [
  {
    input: { note: '#17 Security Assessment (delivered by Defenced)' },
    expectedTicketId: '17',
    expectedTitle: 'Security Assessment (delivered by Defenced)',
  },
  {
    input: { task: { name: 'JIRA-104 Fix authentication issue', issueId: 'JIRA-104' } },
    expectedTicketId: 'JIRA-104',
    expectedTitle: 'Fix authentication issue',
  },
  {
    input: { note: 'General meeting with client' },
    expectedTicketId: '',
    expectedTitle: 'General meeting with client',
  }
];

testCases.forEach((tc, idx) => {
  const result = parseTicketAndTitle(tc.input);
  assert.strictEqual(result.ticketId, tc.expectedTicketId, `Test Case ${idx + 1} Ticket ID mismatch`);
  assert.strictEqual(result.title, tc.expectedTitle, `Test Case ${idx + 1} Title mismatch`);
});

console.log('   ✓ Ticket and title parsing passed');

// Test Profile Project Name & Role parsing
import { parseProfileProjectName } from '../src/utils/matching.js';
const p1 = parseProfileProjectName('DVG - Konzeptsprint (IT-Architekt*in (Level 1+))');
assert.strictEqual(p1.name, 'DVG - Konzeptsprint');
assert.strictEqual(p1.role, 'IT-Architekt*in (Level 1+)');

const p2 = parseProfileProjectName('Vislift Operations (Senior Developer)');
assert.strictEqual(p2.name, 'Vislift Operations');
assert.strictEqual(p2.role, 'Senior Developer');

console.log('   ✓ Profile project name and role parsing passed');


// --- 3. Test Project Matching ---
console.log('\n3. Testing Project Matching...');

const portalProjects = [
  { id: '826', name: 'Vislift Interim Operations Support (Vislift)' },
  { id: '1', name: 'Beyonder Portal (Beyonder | DE)' },
  { id: '606', name: 'AKA-Portal Erweiterung (eAKITA) (HÄVG Rechenzentrum)' },
  { id: '770', name: 'Alltagshelfer ERP (Beyonder | DE)' },
];

const match1 = matchProject('Vislift Operations', portalProjects);
assert.ok(match1.bestMatch, 'Should find match for Vislift Operations');
assert.strictEqual(match1.bestMatch.id, '826', 'Vislift Operations should match ID 826');

const match2 = matchProject('Beyonder Portal', portalProjects);
assert.ok(match2.bestMatch, 'Should find match for Beyonder Portal');
assert.strictEqual(match2.bestMatch.id, '1', 'Beyonder Portal should match ID 1');

// Test saved mapping override
const matchSaved = matchProject('Random Name', portalProjects, { '1234': '606' }, '1234');
assert.strictEqual(matchSaved.bestMatch.id, '606', 'Saved mapping should override fuzzy match');

console.log('   ✓ Project matching passed');


// --- 4. Test Booking Tag Matching ---
console.log('\n4. Testing Booking Tag Matching...');

const availableBookingTags = [
  { id: '101', name: 'Standard' },
  { id: '102', name: '#[TICKET-ID] Ticket' },
  { id: '103', name: 'Meeting' },
];

const tagMatchTicket = matchBookingTag({ ticketId: '17' }, availableBookingTags);
assert.strictEqual(tagMatchTicket, '102', 'Ticket ID present should match #[TICKET-ID] tag');

console.log('   ✓ Booking tag matching passed');

console.log('\n✅ ALL UNIT TESTS PASSED SUCCESSFULLY!\n');
