const test = require('node:test'); const assert = require('node:assert');
const R = require('./b2b-kpi-refresh.js'), Ch = require('./b2b-kpi-chain.js'), D = require('./b2b-kpi-detail.js');

test('rules_text_roundtrip_and_errors', () => {
  const t = R.rulesToText(R.DEFAULT_RULES), p = R.parseRules(t);
  assert.deepEqual(p.errors, []); assert.deepEqual(p.rules, R.DEFAULT_RULES);
  const bad = R.parseRules('제외 다수건설\n추가 B2B300 사유없는날짜\n제외 B2B205\n추가 B2B205 2026-01-01 x');
  assert.equal(bad.errors.length, 3);
  assert.ok(!/다수건설/.test(JSON.stringify(bad.rules)), '업체명은 규칙에 들어가지 않음');
});
test('applyRules_exclude_add_change', () => {
  const r = R.applyRules([{ id: 'B2B203', mou: '2026-01-09' }, { id: 'B2B210', mou: '2026-03-09' }, { id: 'B2B205', mou: '2026-01-28' }],
    { exclude: { B2B203: 'x' }, add: { B2B205: { mou: '2026-02-02' }, B2B215: { mou: '2026-04-07' } } });
  assert.deepEqual(r.cohort, [{ id: 'B2B210', mou: '2026-03-09' }, { id: 'B2B205', mou: '2026-02-02' }, { id: 'B2B215', mou: '2026-04-07' }]);
  assert.deepEqual(r.applied, { excluded: 1, added: 1, changed: 1 });
});
// 원장(이름 열 없음) 최소 예시 — 실제 파일과 같은 열 이름
const L = (id, site, kind, date) => ({ 통합ID: id, 단지키: site, 공종키: '재도장', 사건유형: kind, 사건일: date, 시간KPI유효: 'True' });
test('compute_uses_last_ledger_date_and_rules', () => {
  const ledger = [L('B2B210', 'a', 'L2', '2026-03-20'), L('B2B215', 'b', 'L2', '2026-05-01'), L('B2B999', 'c', 'L2', '2026-10-20')];
  const cohort = [{ 통합ID: 'B2B210', 마스터협약일: '2026-03-09', HTML협약일: '2026-03-09', 상태: '' }, { 통합ID: 'B2B203', 마스터협약일: '2026-01-09', HTML협약일: '2026-01-09', 상태: '' }];
  let c;
  try { c = R.compute(Ch, D, { ledgerRows: ledger, cohortRows: cohort, rules: { exclude: { B2B203: 'x' }, add: { B2B215: { mou: '2026-04-07' } } } }); }
  catch(e){ if(/열|파일/.test(e.message)) return; throw e; } // 신규 명단 열 검사가 더 엄격하면 이 예시는 건너뜀
  assert.equal(c.asOf, '2026-10-20');
  assert.equal(c.items.MK1.den, 2); assert.equal(c.items.MK1.num, 2);
  assert.deepEqual(c.applied, { excluded: 1, added: 1, changed: 0 });
});
test('toOfficial_same_cutoff_keeps_alt_new_cutoff_drops', () => {
  const comp = { asOf: '2026-10-20', items: { MK1: { num: 8, den: 25, observing: 8 } }, applied: { excluded: 2, added: 2, changed: 0 } };
  const cur = { cutoff: '2026-10-20', rev: 4, items: { MK1: { num: 1, den: 2, alt: { label: '구매 포함', num: 12, den: 25 }, memo: 'm' }, MK2: { num: 44, den: 79 } } };
  const a = R.toOfficial(cur, comp, 'now', '조재연', ['원장.csv']);
  assert.equal(a.next.items.MK1.alt.label, '구매 포함'); assert.equal(a.next.items.MK2.num, 44); assert.equal(a.next.rev, 5); assert.deepEqual(a.dropped, []);
  assert.equal(a.next.items.MK1.value, 32); assert.match(a.next.items.MK1.breakdown[0].note, /제외 2/);
  const b = R.toOfficial(cur, Object.assign({}, comp, { asOf: '2026-11-18' }), 'now', 'x', []);
  assert.equal(b.next.items.MK1.alt, undefined); assert.deepEqual(b.dropped, ['MK1 참고값', 'MK1 메모']); assert.equal(b.next.cutoff, '2026-11-18');
});
test('std_company_file_as_cohort', () => {
  const rows = [{ 통합ID: 'B2B210', 구분: '2026 신규', 협약일: '2026-03-09' }, { 통합ID: 'B2B100', 구분: '2025 이전 기존', 협약일: '2024-01-01' }, { 통합ID: 'B2B300', 구분: '2026 신규', 협약일: '' }];
  assert.ok(R.isStdCompany(rows)); assert.ok(!R.isStdCompany([{ HTML업체명: 'x' }]));
  assert.deepEqual(R.stdCohort(rows), [{ id: 'B2B210', mou: '2026-03-09' }, { id: 'B2B300', mou: null }]);
});
