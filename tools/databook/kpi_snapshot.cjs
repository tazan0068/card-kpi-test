/* 표준 표(01_업체.csv·02_요청활동.csv) → KPI 숫자만 담은 kpi-latest.json
   고객관리카드 KPI 화면 계산(b2b-kpi-chain·refresh)과 같은 함수를 씀. 업체명·단지명은 넣지 않음.
   쓰는 법: node tools/databook/kpi_snapshot.cjs <결과폴더(out/자료기준일)> <config.json> <출력 json> */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const D = require(path.join(root, 'b2b-kpi-detail.js')), Ch = require(path.join(root, 'b2b-kpi-chain.js')), R = require(path.join(root, 'b2b-kpi-refresh.js'));
const [dir, cfgPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const rd = f => D.parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const company = rd('01_업체.csv'), act = rd('02_요청활동.csv');
const rules = { exclude: cfg.cohort_rules.exclude || {}, add: {} };
Object.keys(cfg.cohort_rules.add || {}).forEach(id => { rules.add[id] = { mou: cfg.cohort_rules.add[id], reason: 'MOU 명부 협약일' }; });
const comp = R.compute(Ch, D, { ledgerRows: act, cohortRows: company, rules, asOf: cfg.asof });
const target = company.filter(r => r['KPI1 대상'] === '대상');
const alt = target.length ? { label: '구매 포함', num: target.filter(r => r['KPI1 결과'] && r['KPI1 결과'] !== '미활용').length, den: target.length, note: '판매 기록의 업체 연결분만 셈(최소값)' } : null;
const snap = { asof: comp.asOf, generatedAt: new Date().toISOString(), source: '데이터북 생성기 ' + cfg.asof,
  items: { MK1: comp.items.MK1, MK3: comp.items.MK3, MK2: comp.items.MK2 }, alt: { MK1: alt }, applied: comp.applied, warnings: comp.warnings };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(snap, null, 1));
console.log(JSON.stringify(snap.items), JSON.stringify(snap.alt));
