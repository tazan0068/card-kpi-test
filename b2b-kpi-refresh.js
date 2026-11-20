/* §B2B KPI 데이터 파일로 최신화(2026-11 시험 사본) — 쌓고 있는 원장 파일을 고르면 3대 KPI를 같은 정의로 다시 세고,
   지금 값과 나란히 보여준 뒤 '반영'하면 kpiOfficial 로 저장한다(이력은 b2b-kpi-official 과 같은 길).
   순수 함수(DOM·저장 없음). 계산은 b2b-kpi-chain(kpi1·kpi2·kpi3)을 그대로 쓴다 — 상세 화면과 같은 숫자가 나와야 한다.
   KPI1 모수 규칙은 업체 통합ID(B2Bxxx)와 날짜·사유만 담는다(업체명 없음). */
(function(){
  'use strict';
  var UNITS = { MK1: '곳', MK3: '기회', MK2: '곳' };
  var OBS_LABEL = '관찰 중 · 분모에 넣지 않음';
  /* 2026-11-19 팀 결정(조재연): 다수건설=에스피플래닝 상호변경(기존 업체), 방수존=지표 제외, 극동·오연=MOU 명부 협약일로 넣음 */
  var DEFAULT_RULES = { exclude: { B2B203: '상호 변경된 기존 업체', B2B207: '지표 제외' }, add: { B2B205: { mou: '2026-02-02', reason: 'MOU 명부 협약일' }, B2B215: { mou: '2026-04-07', reason: 'MOU 명부 협약일' } } };

  function copy(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function isDate(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function round1(v){ return Math.round(v * 10) / 10; }

  /* 규칙 글 ↔ 객체. 한 줄에 하나: "제외 B2B203 사유" / "추가 B2B205 2026-02-02 사유" */
  function rulesToText(r){
    r = r || {}; var out = [];
    Object.keys(r.exclude || {}).sort().forEach(function(id){ out.push('제외 ' + id + (r.exclude[id] ? ' ' + r.exclude[id] : '')); });
    Object.keys(r.add || {}).sort().forEach(function(id){ var a = r.add[id] || {}; out.push('추가 ' + id + ' ' + (a.mou || '') + (a.reason ? ' ' + a.reason : '')); });
    return out.join('\n');
  }
  function parseRules(text){
    var rules = { exclude: {}, add: {} }, errors = [];
    String(text || '').split(/\r?\n/).forEach(function(line, i){
      var s = line.trim(); if(!s) return;
      var m = /^(제외|추가)\s+(B2B\d{3,})\s*(\d{4}-\d{2}-\d{2})?\s*(.*)$/.exec(s);
      if(!m){ errors.push((i + 1) + '번째 줄: "제외 B2B203 사유" 또는 "추가 B2B205 2026-02-02 사유" 모양으로 적어 주세요'); return; }
      if(m[1] === '제외') rules.exclude[m[2]] = m[4].slice(0, 60);
      else if(!m[3]) errors.push((i + 1) + '번째 줄: 추가에는 협약일(YYYY-MM-DD)이 필요합니다');
      else rules.add[m[2]] = { mou: m[3], reason: m[4].slice(0, 60) };
    });
    Object.keys(rules.add).forEach(function(id){ if(rules.exclude[id] !== undefined) errors.push(id + ': 제외와 추가에 함께 있습니다'); });
    return { rules: rules, errors: errors };
  }
  /* 신규 명단 + 규칙 → 계산에 쓸 모수 */
  function applyRules(cohort, rules){
    rules = rules || {}; var ex = rules.exclude || {}, add = rules.add || {}, seen = {}, out = [], applied = { excluded: 0, added: 0, changed: 0 };
    (cohort || []).forEach(function(c){
      var id = String(c.id); if(ex[id] !== undefined){ applied.excluded++; return; }
      if(add[id]){ out.push({ id: id, mou: add[id].mou }); applied.changed++; } else out.push({ id: id, mou: c.mou });
      seen[id] = 1;
    });
    Object.keys(add).forEach(function(id){ if(!seen[id] && ex[id] === undefined){ out.push({ id: id, mou: add[id].mou }); applied.added++; } });
    return { cohort: out, applied: applied };
  }
  /* 표준 표 01_업체.csv(데이터북 생성기) — 구분이 'YYYY 신규'이고 협약일이 있는 업체가 KPI1 모수 */
  function isStdCompany(rows){ var r = rows && rows[0]; return !!(r && '통합ID' in r && '구분' in r && '협약일' in r); }
  function stdCohort(rows){
    return rows.filter(function(r){ return /신규$/.test(String(r['구분'] || '').trim()) && r['통합ID']; })
      .map(function(r){ var m = String(r['협약일'] || '').trim().slice(0, 10); return { id: String(r['통합ID']).trim(), mou: isDate(m) ? m : null }; });
  }
  function lastDate(events){ var m = ''; (events || []).forEach(function(e){ if(e.date > m) m = e.date; }); return m || null; }

  /* 계산 — Ch: B2BKpiChain, D: B2BKpiDetail. ledgerRows 필수, cohortRows 는 KPI1 에만 필요 */
  function compute(Ch, D, a){
    var warnings = [], led = Ch.ledgerEvents(a.ledgerRows), ev = led.events, asOf = a.asOf || lastDate(ev);
    if(!asOf) throw new Error('원장에서 날짜가 있는 기록을 찾지 못했습니다');
    if(led.skipped) warnings.push('원장에서 단지·공종·날짜가 확인되지 않은 ' + led.skipped + '건은 세지 않았습니다');
    var res = { asOf: asOf, events: ev.length, items: {}, warnings: warnings, applied: null };
    var k2 = Ch.kpi2(ev, asOf), k3 = Ch.kpi3(ev, asOf);
    res.items.MK3 = { num: k2.num, den: k2.den, observing: k2.observing };
    res.items.MK2 = { num: k3.num, den: k3.den, observing: k3.observing };
    if(a.cohortRows && a.cohortRows.length){
      var an = isStdCompany(a.cohortRows) ? { cohort: stdCohort(a.cohortRows) } : D.analyze('MK1', a.cohortRows), ap = applyRules(an.cohort, a.rules);
      var k1 = Ch.kpi1(ap.cohort, ev, asOf);
      res.items.MK1 = { num: k1.num, den: k1.den, observing: k1.observing, unconfirmed: k1.unconfirmed };
      res.applied = ap.applied;
      if(k1.unconfirmed) warnings.push('KPI1: 협약일이 없는 ' + k1.unconfirmed + '곳은 모수에서 뺐습니다');
    } else warnings.push('신규 협약 명단 파일이 없어 KPI1은 지금 값을 그대로 둡니다');
    return res;
  }

  /* 계산 결과 → 새 kpiOfficial. 기준일이 같으면 메모·참고값·집계 내역을 남기고, 바뀌면 옛 기준이라 지운다. */
  function toOfficial(cur, comp, nowIso, by, files){
    cur = copy(cur) || {}; var same = (cur.cutoff || '') === comp.asOf, items = {}, ci = cur.items || {}, dropped = [];
    Object.keys(UNITS).forEach(function(id){
      var c = comp.items[id];
      if(!c){ if(ci[id]) items[id] = ci[id]; return; }
      var o = ci[id] || {}, it = { num: c.num, den: c.den, value: c.den ? round1(c.num / c.den * 100) : 0, unit: UNITS[id] };
      var obsNote = id === 'MK1' && comp.applied ? '모수 규칙: 제외 ' + comp.applied.excluded + ' · 추가 ' + comp.applied.added + ' · 협약일 정정 ' + comp.applied.changed : '';
      it.breakdown = [{ key: 'observing', label: OBS_LABEL, n: c.observing, unit: UNITS[id], note: obsNote }];
      if(same){ if(o.memo) it.memo = o.memo; if(o.alt) it.alt = o.alt; }
      else { if(o.alt) dropped.push(id + ' 참고값'); if(o.memo) dropped.push(id + ' 메모'); }
      items[id] = it;
    });
    var next = { cutoff: comp.asOf, note: '파일 계산 · ' + (files || []).join(', '), items: items, source: 'file',
      rev: (typeof cur.rev === 'number' ? cur.rev : 0) + 1, updatedAt: nowIso, updatedBy: String(by || '').trim().slice(0, 40) };
    return { next: next, dropped: dropped };
  }

  var api = { isStdCompany: isStdCompany, stdCohort: stdCohort, DEFAULT_RULES: DEFAULT_RULES, rulesToText: rulesToText, parseRules: parseRules, applyRules: applyRules, lastDate: lastDate, compute: compute, toOfficial: toOfficial };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiRefresh = api;
})();
