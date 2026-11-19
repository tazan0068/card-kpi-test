/* §B2B KPI 확인분 입력(2026-11 시험 사본) — 팀원 누구나 3대 KPI 최신 숫자를 넣고, 바꾼 이력을 남기고, 이전 값으로 되돌린다.
   순수 함수(DOM·저장 없음). 저장 위치: kpiOfficial(현재 값) + kpiOfficialHistory/{id}(바뀐 내역, 전·후 값 통째로).
   업체명은 받지 않는다 — 숫자·라벨·메모만. 값 저장소는 로그인 없이 읽히는 곳이기 때문이다. */
(function(){
  'use strict';
  var IDS = ['MK1', 'MK3', 'MK2'];
  var UNITS = { MK1: '곳', MK3: '기회', MK2: '곳' };
  var OBS_LABEL = '관찰 중 · 분모에 넣지 않음';

  function isNum(v){ return typeof v === 'number' && isFinite(v); }
  function copy(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function intOrNull(v){
    if(v === null || v === undefined) return null;
    var s = String(v).replace(/[,\s]/g, ''); if(s === '') return null;
    return /^\d+$/.test(s) ? +s : NaN;
  }
  function round1(v){ return Math.round(v * 10) / 10; }
  function trim(s, n){ s = String(s == null ? '' : s).trim(); return n ? s.slice(0, n) : s; }
  function bdArr(raw){
    var arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw).sort(function(a, b){ return a - b; }).map(function(k){ return raw[k]; }) : [];
    return arr.filter(function(x){ return x && typeof x === 'object'; });
  }
  function validDate(s){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if(!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  /* 저장된 값 → 입력창 기본값 */
  function formFrom(off){
    off = off || {}; var items = off.items || {}, f = { cutoff: off.cutoff || '', note: off.note || '', items: {} };
    IDS.forEach(function(id){
      var o = items[id] || {}, obs = bdArr(o.breakdown).filter(function(x){ return x.key === 'observing'; })[0], alt = o.alt || {};
      f.items[id] = { num: isNum(o.num) ? String(o.num) : '', den: isNum(o.den) ? String(o.den) : '', observing: obs && isNum(obs.n) ? String(obs.n) : '',
        memo: o.memo || '', altLabel: alt.label || '', altNum: isNum(alt.num) ? String(alt.num) : '', altDen: isNum(alt.den) ? String(alt.den) : '', altNote: alt.note || '' };
    });
    return f;
  }

  /* 입력값 → 저장할 새 kpiOfficial. 마감일이 바뀌면 이전 집계 내역(관찰 중 제외)은 옛 기준이라 지운다. */
  function plan(cur, input, nowIso, by, reason, names){
    cur = cur || {}; input = input || {}; names = names || {};
    var errors = [], next = { cutoff: trim(input.cutoff), note: trim(input.note, 200), items: {} };
    if(!validDate(next.cutoff)) errors.push('마감일을 YYYY-MM-DD 형식으로 넣어 주세요');
    if(!trim(by)) errors.push('입력한 사람을 골라 주세요');
    if(!trim(reason)) errors.push('바꾼 이유를 한 줄 적어 주세요');
    var sameCut = next.cutoff === (cur.cutoff || ''), curItems = cur.items || {}, filled = 0;
    IDS.forEach(function(id){
      var x = (input.items || {})[id] || {}, nm = names[id] || id, o = copy(curItems[id]) || {};
      var num = intOrNull(x.num), den = intOrNull(x.den), obs = intOrNull(x.observing);
      if(num === null && den === null){ if(curItems[id]) errors.push(nm + ': 숫자를 비우면 저장할 수 없습니다(이전 값을 지우지 않음)'); return; }
      if(num === null || den === null || isNaN(num) || isNaN(den)){ errors.push(nm + ': 분자와 분모를 0 이상의 정수로 넣어 주세요'); return; }
      if(den === 0){ errors.push(nm + ': 분모는 0보다 커야 합니다'); return; }
      if(num > den){ errors.push(nm + ': 분자(' + num + ')가 분모(' + den + ')보다 큽니다'); return; }
      if(isNaN(obs)){ errors.push(nm + ': 관찰 중 건수는 0 이상의 정수로 넣어 주세요'); return; }
      var bd = bdArr(o.breakdown), oldObs = bd.filter(function(b){ return b.key === 'observing'; })[0];
      var rest = sameCut ? bd.filter(function(b){ return b.key !== 'observing'; }) : [];
      var nb = (obs !== null ? [{ key: 'observing', label: (oldObs && oldObs.label) || OBS_LABEL, n: obs, unit: UNITS[id], note: sameCut && oldObs && oldObs.note ? oldObs.note : '' }] : []).concat(rest);
      var item = { num: num, den: den, value: round1(num / den * 100), unit: UNITS[id] };
      if(nb.length) item.breakdown = nb;
      var memo = trim(x.memo, 300); if(memo) item.memo = memo;
      var an = intOrNull(x.altNum), ad = intOrNull(x.altDen), al = trim(x.altLabel, 60);
      if(an !== null || ad !== null || al){
        if(an === null || ad === null || isNaN(an) || isNaN(ad) || ad === 0 || an > ad || !al) errors.push(nm + ': 참고값은 이름·분자·분모를 모두 넣어 주세요(분자 ≤ 분모)');
        else item.alt = { label: al, num: an, den: ad, value: round1(an / ad * 100), note: trim(x.altNote, 120) };
      }
      next.items[id] = item; filled++;
    });
    if(!filled && !errors.length) errors.push('KPI 숫자를 하나 이상 넣어 주세요');
    next.rev = (isNum(cur.rev) ? cur.rev : 0) + 1; next.updatedAt = nowIso; next.updatedBy = trim(by, 40);
    return { errors: errors, next: next, changes: diff(cur, next, names) };
  }

  /* 바뀐 칸 요약(이력 화면용) */
  function diff(a, b, names){
    a = a || {}; b = b || {}; names = names || {}; var out = [];
    if((a.cutoff || '') !== (b.cutoff || '')) out.push({ f: '마감일', from: a.cutoff || '—', to: b.cutoff || '—' });
    IDS.forEach(function(id){
      var x = (a.items || {})[id] || {}, y = (b.items || {})[id] || {}, nm = names[id] || id;
      var fx = isNum(x.num) ? x.num + '/' + x.den + ' (' + x.value + '%)' : '—', fy = isNum(y.num) ? y.num + '/' + y.den + ' (' + y.value + '%)' : '—';
      if(fx !== fy) out.push({ f: nm, from: fx, to: fy });
      var ax = x.alt ? x.alt.label + ' ' + x.alt.num + '/' + x.alt.den : '—', ay = y.alt ? y.alt.label + ' ' + y.alt.num + '/' + y.alt.den : '—';
      if(ax !== ay) out.push({ f: nm + ' 참고값', from: ax, to: ay });
    });
    return out;
  }

  /* 이력 → 최신순 목록 */
  function history(shape){
    var h = (shape && shape.kpiOfficialHistory) || {};
    return Object.keys(h).map(function(k){ return h[k]; }).filter(function(x){ return x && x.at; })
      .sort(function(x, y){ return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });
  }
  /* 되돌리기: 그 이력의 '바꾸기 전' 값을 새 현재 값으로(이력은 지우지 않고 '되돌림' 1건을 더 남긴다) */
  function planRevert(cur, entry, nowIso, by){
    var errors = [];
    if(!entry || !entry.before) errors.push('되돌릴 이전 값이 없습니다(처음 입력된 기록)');
    if(!trim(by)) errors.push('되돌린 사람을 골라 주세요');
    var next = copy(entry && entry.before) || {};
    next.rev = (cur && isNum(cur.rev) ? cur.rev : 0) + 1; next.updatedAt = nowIso; next.updatedBy = trim(by, 40);
    return { errors: errors, next: next };
  }

  var api = { IDS: IDS, UNITS: UNITS, formFrom: formFrom, plan: plan, diff: diff, history: history, planRevert: planRevert, validDate: validDate };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiOfficial = api;
})();
