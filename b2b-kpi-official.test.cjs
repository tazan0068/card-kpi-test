const test = require('node:test'); const assert = require('node:assert');
const O = require('./b2b-kpi-official.js'); const S = require('./b2b-kpi-store.js');
const names = { MK1: 'KPI1 신규 협약 활용', MK3: 'KPI2 문의별 L3 도달', MK2: 'KPI3 다른 단지 재사용' };
const cur = () => ({ cutoff: '2026-10-20', note: '확인분', items: {
  MK1: { num: 8, den: 25, value: 32, unit: '곳', breakdown: [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 8, unit: '곳', note: '이미 요청 3곳' }, { label: '협약일 불확정 · 제외', n: 3, unit: '곳' }] },
  MK3: { num: 315, den: 1025, value: 30.73, unit: '기회' }, MK2: { num: 44, den: 79, value: 55.7, unit: '곳' } } });
const form = c => { const f = O.formFrom(c); f.by = '조재연'; f.reason = '시험'; return f; };

test('formFrom_roundtrip_keeps_values', () => {
  const f = O.formFrom(cur());
  assert.equal(f.items.MK1.num, '8'); assert.equal(f.items.MK1.observing, '8'); assert.equal(f.items.MK3.den, '1025');
  const p = O.plan(cur(), form(cur()), '2026-11-19T10:00:00Z', '조재연', '시험', names);
  assert.deepEqual(p.errors, []); assert.equal(p.changes.length, 0); // 반올림 차이(30.73→30.7)는 바뀐 것으로 치지 않음
  assert.equal(p.next.items.MK1.breakdown.length, 2); // 같은 마감일이면 집계 내역 유지
  assert.equal(p.next.rev, 1); assert.equal(p.next.updatedBy, '조재연');
});
test('new_cutoff_drops_old_breakdown_but_keeps_observing', () => {
  const f = form(cur()); f.cutoff = '2026-11-19'; f.items.MK1.observing = '6';
  const p = O.plan(cur(), f, 'now', 'a', 'b', names);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.next.items.MK1.breakdown, [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 6, unit: '곳', note: '' }]);
  assert.ok(p.changes.some(c => c.f === '마감일' && c.to === '2026-11-19'));
});
test('alt_value_for_kpi1', () => {
  const f = form(cur()); Object.assign(f.items.MK1, { altLabel: '구매 포함', altNum: '12', altDen: '25', altNote: '최소값' });
  const p = O.plan(cur(), f, 'now', 'a', 'b', names);
  assert.deepEqual(p.next.items.MK1.alt, { label: '구매 포함', num: 12, den: 25, value: 48, note: '최소값' });
  assert.ok(p.changes.some(c => c.f.endsWith('참고값')));
});
test('validation_errors', () => {
  const f = form(cur()); f.by = ''; f.reason = ''; f.cutoff = '2026-13-40';
  f.items.MK1.num = '30'; f.items.MK3.num = 'x'; f.items.MK2.num = ''; f.items.MK2.den = '';
  f.items.MK1.altLabel = '구매 포함';
  const e = O.plan(cur(), f, 'now', f.by, f.reason, names).errors.join('|');
  assert.match(e, /마감일/); assert.match(e, /입력한 사람/); assert.match(e, /바꾼 이유/);
  assert.match(e, /KPI1.*분자\(30\)가 분모\(25\)보다/); assert.match(e, /KPI2.*정수/); assert.match(e, /KPI3.*비우면/);
});
test('alt_incomplete_is_error', () => {
  const f = form(cur()); f.items.MK1.altLabel = '구매 포함'; f.items.MK1.altNum = '12';
  assert.match(O.plan(cur(), f, 'now', 'a', 'b', names).errors.join(), /참고값/);
});
test('history_sorted_and_revert', () => {
  const shape = { kpiOfficialHistory: { a: { id: 'a', at: '2026-11-18T01:00:00Z', before: null }, b: { id: 'b', at: '2026-11-19T01:00:00Z', before: cur() }, c: null } };
  assert.deepEqual(O.history(shape).map(x => x.id), ['b', 'a']);
  const r = O.planRevert({ rev: 3 }, shape.kpiOfficialHistory.b, 'now', '김팀원');
  assert.deepEqual(r.errors, []); assert.equal(r.next.rev, 4); assert.equal(r.next.items.MK1.num, 8); assert.equal(r.next.updatedBy, '김팀원');
  assert.match(O.planRevert({}, shape.kpiOfficialHistory.a, 'now', 'x').errors.join(), /이전 값이 없습니다/);
  assert.match(O.planRevert({}, shape.kpiOfficialHistory.b, 'now', '').errors.join(), /사람/);
});
function fakeStore(db){
  const calls = [];
  const fetchFn = async (url, o) => { calls.push([url, (o && o.method) || 'GET', o && o.body]);
    if(o && o.method === 'PATCH'){ const b = JSON.parse(o.body); Object.keys(b).forEach(k => { db[k] = b[k]; }); return { ok: true, json: async () => ({}) }; }
    const k = url.replace(S.TEST + '/', '').replace('.json', ''); return { ok: true, json: async () => db[k] === undefined ? null : db[k] }; };
  return { store: S.createStore({ fetch: fetchFn, base: S.TEST }), calls };
}
test('store_saveOfficial_writes_value_and_history_with_before', async () => {
  const db = { kpiOfficial: Object.assign(cur(), { rev: 2 }) };
  const { store, calls } = fakeStore(db);
  const next = Object.assign(cur(), { rev: 3, updatedAt: 't', updatedBy: '조재연' });
  const r = await store.saveOfficial(next, 2, { reason: '반영', changes: [{ f: 'x' }] });
  assert.equal(r.ok, true);
  const patch = JSON.parse(calls.find(c => c[1] === 'PATCH')[2]);
  assert.equal(patch.kpiOfficial.rev, 3);
  const hk = Object.keys(patch).find(k => k.startsWith('kpiOfficialHistory/')); const h = patch[hk];
  assert.equal(h.before.rev, 2); assert.equal(h.after.rev, 3); assert.equal(h.by, '조재연'); assert.equal(h.reason, '반영');
  assert.ok(calls.every(([u]) => u.indexOf(S.TEST) === 0), '시험 위치에만 접근');
});
test('store_saveOfficial_conflict_does_not_write', async () => {
  const db = { kpiOfficial: Object.assign(cur(), { rev: 5 }) };
  const { store, calls } = fakeStore(db);
  const r = await store.saveOfficial(Object.assign(cur(), { rev: 3 }), 2, {});
  assert.deepEqual(r, { ok: false, reason: 'conflict' });
  assert.ok(!calls.some(c => c[1] === 'PATCH'));
});
