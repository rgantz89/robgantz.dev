// Unit tests for the change risk playground rules engine. Run: node --test tests/playground.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../site/playground.js');

const base = (o) => Object.assign({
  id: 'CHG-9001', team: 'Edge', group: 'Tools-Eng', device: 'edge-lb-01.den', action: 'Test change',
  start: '02:00', end: '03:00', rollback: true, impact: true, ticket: true,
  serviceImpacting: false, ticketRegion: 'West',
}, o);
const keys = (c, q) => E.screen(c, q || E.seedQueue()).flags.map((f) => f.key);

test('a clean change passes every check and ranks low', () => {
  const r = E.screen(base(), E.seedQueue());
  assert.deepEqual(r.flags, []);
  assert.equal(r.level, 'low');
});

test('overnight times wrap past midnight', () => {
  assert.ok(E.nightMinutes('23:00') < E.nightMinutes('00:30'));
  assert.ok(E.overlaps({ start: '23:30', end: '01:00' }, { start: '00:30', end: '02:00' }));
  assert.ok(!E.overlaps({ start: '01:00', end: '02:00' }, { start: '02:00', end: '03:00' }), 'touching windows do not overlap');
});

test('maintenance window is enforced at both ends', () => {
  assert.ok(keys(base({ start: '23:30', end: '01:00' })).includes('window'));
  assert.ok(keys(base({ start: '05:30', end: '06:30' })).includes('window'));
  assert.ok(!keys(base({ start: '00:00', end: '06:00' })).includes('window'));
});

test('same device at the same time conflicts regardless of team or impact', () => {
  const q = [base({ id: 'A', team: 'Voice', device: 'sbc-01.kcy', ticketRegion: 'Central' })];
  assert.ok(keys(base({ team: 'Voice', device: 'sbc-01.kcy', ticketRegion: 'Central', start: '02:30', end: '03:30' }), q).includes('conflict'));
});

test('same site conflicts only when two different teams both take service-impacting work', () => {
  const other = base({ id: 'A', team: 'Core', device: 'core-rtr-01.stl', serviceImpacting: true, ticketRegion: 'Central' });
  const mine = base({ team: 'Metro', device: 'agg-sw-11.stl', serviceImpacting: true, ticketRegion: 'Central' });
  assert.ok(keys(mine, [other]).includes('conflict'));
  assert.ok(!keys(Object.assign({}, mine, { serviceImpacting: false }), [other]).includes('conflict'));
  assert.ok(!keys(Object.assign({}, mine, { team: 'Core' }), [other]).includes('conflict'), 'same team coordinates its own work');
  assert.ok(!keys(Object.assign({}, mine, { start: '04:00', end: '05:00' }), [other]).includes('conflict'), 'no time overlap');
});

test('a change never conflicts with itself', () => {
  const c = base();
  assert.ok(!E.conflictsWith(c, c));
});

test('documentation, region and lockdown checks', () => {
  assert.deepEqual(keys(base({ rollback: false, impact: false, ticket: false })), ['rollback', 'impact', 'ticket']);
  assert.ok(keys(base({ ticketRegion: 'East' })).includes('region'));
  assert.ok(keys(base({ device: 'cmts-09.dal', ticketRegion: 'South', start: '05:00', end: '06:00' })).includes('lockdown'));
});

test('score is the device tier plus the weight of each failed check', () => {
  const r = E.screen(base({ rollback: false, impact: false }), []);
  assert.equal(r.score, 10 + 20 + 15); // edge tier + rollback + impact
  assert.equal(r.level, 'medium');
});

test('validation catches bad input', () => {
  assert.ok(E.validate(base({ start: '03:00', end: '02:00' })).length);
  assert.ok(E.validate(base({ action: '   ' })).length);
  assert.ok(E.validate(base({ device: 'nope' })).length);
  assert.deepEqual(E.validate(base()), []);
});

test('the seed queue tells a balanced story', () => {
  const s = E.summarize(E.screenAll(E.seedQueue()));
  assert.equal(s.pending, 24);
  assert.ok(s.clean >= 5, 'some changes pass');
  assert.ok(s.conflicts > 0 && s.conflicts < s.pending / 2, 'conflicts are notable, not universal');
  E.REASONS.forEach((r) => assert.ok(s.byReason[r.key] > 0, r.key + ' appears at least once'));
});

test('screenAll ranks by score, highest first', () => {
  const ranked = E.screenAll(E.seedQueue());
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].result.score >= ranked[i].result.score);
});
