/* §B2B KPI 탭 — 업무트래커(Firebase Realtime Database, shared/b2bOpsTracker) 읽기·쓰기.
   쓰기는 PATCH 로 "컬렉션/ID" 단위만 보낸다(트래커와 같은 방식, 문서 전체 덮어쓰기 없음).
   이 탭이 쓰는 위치: members(새 사람)·leadDefs·lagDefs·perfMonthly(세부업무 진행률)·perfHistory·kpiTeamChecks·kpiBuild·kpiTabConfig·kpiOfficial·kpiOfficialHistory.
   삭제(null)는 보내지 않는다. 고객관리카드 Firestore 는 건드리지 않는다. */
(function(){
  'use strict';
  var PROD = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app/shared/b2bOpsTracker';
  /* [시험 사본] 쓰기는 시험 위치에만 한다. 운영 위치는 처음 한 번 읽어서 복사(seed)할 때만 쓴다. */
  var TEST = PROD + '_test';

  /* 운영 주소가 기본. 로컬(localhost) 시험에서만 ?kpiTracker=<주소> 로 모의 저장소를 쓸 수 있다. */
  function resolveBase(loc){
    var host = loc && loc.hostname;
    if(host === 'localhost' || host === '127.0.0.1'){
      var m = /[?&]kpiTracker=([^&]+)/.exec((loc && loc.search) || '');
      if(m) return decodeURIComponent(m[1]).replace(/\/+$/, '');
    }
    return TEST;
  }
  function copy(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function hid(){ return 'H' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function createStore(opt){
    var fetchFn = opt.fetch, base = opt.base;
    function get(path){
      return fetchFn(base + (path ? '/' + path : '') + '.json', { cache: 'no-store' }).then(function(r){
        if(!r.ok) throw new Error('읽기 실패 HTTP ' + r.status);
        return r.json();
      });
    }
    function patch(body){
      Object.keys(body).forEach(function(k){ if(body[k] === null || body[k] === undefined) throw new Error('삭제 값은 보내지 않습니다: ' + k); });
      return fetchFn(base + '.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(r){
        if(!r.ok) throw new Error('저장 실패 HTTP ' + r.status);
      });
    }
    /* 새로 만들기(openedRev=null): 이미 있으면 'exists'. 수정: 원격 rev 가 연 때와 다르면 'conflict'. */
    function saveDef(col, def, openedRev){
      return get(col + '/' + encodeURIComponent(def.id)).then(function(remote){
        if(openedRev === null || openedRev === undefined){ if(remote) return { ok: false, reason: 'exists' }; }
        else if(!remote || (remote.rev || 0) !== openedRev) return { ok: false, reason: 'conflict' };
        var body = {}; body[col + '/' + def.id] = def;
        return patch(body).then(function(){ return { ok: true }; });
      });
    }
    /* 세부업무 진행률 — 트래커 b2bSubSet 과 같은 레코드 모양 + 변경 이력 1건 */
    /* 쓰기 직전에 그 레코드만 새로 읽어 그 위에서 고친다(화면 사본이 최대 30초 묵어 트래커 입력값을 지우지 않도록) */
    function setTaskProg(shape, defId, month, i, pct, actor){
      var id = defId + '_' + month;
      return get('perfMonthly/' + encodeURIComponent(id)).then(function(cur){ return writeTaskProg(shape, cur, id, defId, month, i, pct, actor); });
    }
    function writeTaskProg(shape, cur, id, defId, month, i, pct, actor){
      var def = ((shape && shape.leadDefs) || {})[defId] || {}, name = (def.tasks || [])[i] || ('업무' + (i + 1));
      var k = 't' + (i + 1), before = cur && cur.prog && typeof cur.prog[k] === 'number' ? cur.prog[k] : cur && cur.checks && cur.checks[k] ? 100 : 0;
      var next = cur ? copy(cur) : { id: id, ref: defId, month: month, mode: 'auto' };
      next.prog = next.prog || {}; next.prog[k] = pct;
      if(next.checks) delete next.checks[k];
      next.updatedAt = new Date().toISOString(); next.updatedBy = actor; next.rev = (next.rev || 0) + 1;
      var h = { id: hid(), ref: defId, month: month, kind: 'task', by: actor, summary: '세부업무 진행률 변경', changes: [{ f: name, from: before + '%', to: pct + '%' }], at: next.updatedAt };
      var body = {}; body['perfMonthly/' + id] = next; body['perfHistory/' + h.id] = h;
      return patch(body).then(function(){ return next; });
    }
    function toggleTeamCheck(shape, kpiId, month, i, actor){
      var id = kpiId + '_' + month;
      return get('kpiTeamChecks/' + encodeURIComponent(id)).then(function(cur){ return writeTeamCheck(cur, id, kpiId, month, i, actor); });
    }
    function writeTeamCheck(cur, id, kpiId, month, i, actor){
      var next = cur ? copy(cur) : { id: id, ref: kpiId, month: month };
      next.id = id; next.ref = kpiId; next.month = month;
      next.checks = next.checks || {};
      var k = 'c' + (i + 1); next.checks[k] = !(next.checks[k] === true);
      next.updatedAt = new Date().toISOString(); next.by = actor;
      var body = {}; body['kpiTeamChecks/' + id] = next;
      return patch(body).then(function(){ return next; });
    }
    /* openedAt(세 번째 값)를 주면, 화면이 연 뒤 다른 관리자가 먼저 저장했는지(updatedAt 다름) 확인하고 멈춘다 */
    function saveConfig(cfg, actor, openedAt){
      var check = arguments.length >= 3;
      return (check ? get('kpiTabConfig') : Promise.resolve(null)).then(function(remote){
        if(check && ((remote && remote.updatedAt) || null) !== (openedAt || null)) return { ok: false, reason: 'conflict' };
        var v = copy(cfg) || {}; v.updatedAt = new Date().toISOString(); v.by = actor;
        return patch({ kpiTabConfig: v }).then(function(){ return { ok: true, value: v }; });
      });
    }
    /* 탭에 보일 팀원 추가 — 최신 설정을 읽어 그 위에 더한다(다른 관리자의 변경 보존, 개인 몫 값은 그대로) */
    function addTabMember(memberId, defaults, actor){
      return get('kpiTabConfig').then(function(remote){
        var v = copy(remote) || {}, ids = (v.members && v.members.length ? v.members : (defaults || [])).slice();
        if(ids.indexOf(memberId) >= 0) return { ok: true, value: remote };
        v.members = ids.concat([memberId]); v.updatedAt = new Date().toISOString(); v.by = actor;
        return patch({ kpiTabConfig: v }).then(function(){ return { ok: true, value: v }; });
      });
    }
    /* 구축 체크(○▶✓) — 팀 공동·고객 정보 없음. kpiBuild/Bxx 한 칸만 쓴다 */
    function setBuildState(id, state, actor){
      if(!/^B[1-3][1-4]$/.test(String(id))) return Promise.reject(new Error('구축 항목이 올바르지 않습니다'));
      if(['todo', 'doing', 'done'].indexOf(state) < 0) return Promise.reject(new Error('상태가 올바르지 않습니다'));
      var v = { id: id, state: state, updatedAt: new Date().toISOString(), by: actor }, body = {}; body['kpiBuild/' + id] = v;
      return patch(body).then(function(){ return v; });
    }
    /* 3대 KPI 확인분 저장 — 연 때의 rev 와 원격 rev 가 다르면 멈춘다(다른 팀원이 먼저 저장). 바꾸기 전 값을 통째로 이력에 남긴다.
       kind: 'edit' | 'revert'. 이력은 지우지 않는다. */
    function saveOfficial(next, openedRev, meta){
      return get('kpiOfficial').then(function(remote){
        var rrev = (remote && typeof remote.rev === 'number') ? remote.rev : 0;
        if(rrev !== (openedRev || 0)) return { ok: false, reason: 'conflict' };
        var h = { id: hid(), kind: (meta && meta.kind) || 'edit', at: next.updatedAt, by: next.updatedBy, reason: (meta && meta.reason) || '',
          changes: (meta && meta.changes) || [], before: remote || null, after: next, revertOf: (meta && meta.revertOf) || null };
        var body = { kpiOfficial: next }; body['kpiOfficialHistory/' + h.id] = h;
        return patch(body).then(function(){ return { ok: true, value: next, history: h }; });
      });
    }
    /* 시험 위치가 비어 있으면 운영 값을 한 번 복사해 온다(운영 위치에는 쓰지 않음). opt.seedFrom 이 없으면(테스트) 그냥 읽는다. */
    function read(){
      return get('').then(function(cur){
        if(!opt.seedFrom || (cur && cur._seededAt)) return cur;
        return fetchFn(opt.seedFrom + '.json', { cache: 'no-store' }).then(function(r){
          if(!r.ok) throw new Error('운영 값 읽기 실패 HTTP ' + r.status);
          return r.json();
        }).then(function(prod){
          var body = copy(prod) || {}; Object.keys(cur || {}).forEach(function(k){ body[k] = cur[k]; });
          body._seededAt = new Date().toISOString();
          return patch(body).then(function(){ return body; });
        });
      });
    }
    return { setBuildState: setBuildState, saveOfficial: saveOfficial, read: read, saveDef: saveDef, setTaskProg: setTaskProg, toggleTeamCheck: toggleTeamCheck, saveConfig: saveConfig, addTabMember: addTabMember };
  }

  var api = { PROD: PROD, TEST: TEST, resolveBase: resolveBase, createStore: createStore };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined'){
    window.B2BKpiStoreLib = api;
    window.B2BKpiStore = createStore({ fetch: window.fetch.bind(window), base: resolveBase(window.location), seedFrom: PROD });
  }
})();
