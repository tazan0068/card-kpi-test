# -*- coding: utf-8 -*-
"""POUR 협약사 데이터북 생성기 (v1, 2026-11-20)

원본 파일들 → 표준 표 5개(CSV) + 데이터북(xlsx) + 검증 결과(txt)를 만든다.
표준 표의 열과 규칙은 같은 폴더의 '데이터_구조_정의서.md'를 따른다.

쓰는 법:
    python3 build_databook.py config.json

config.json 예시(경로는 각자 컴퓨터 기준):
{
  "asof": "2026-10-20",                       # 자료 기준일(원본이 언제까지의 자료인지)
  "out_dir": "./out",                          # 결과 폴더(날짜 폴더가 그 아래 생김)
  "mou_master": "MOU마스터.csv",                # 협약 명부(통합ID·업체명·협약일·구분)
  # (선택) "compare_ledger": "한정정규원장.csv"  # 예전 원장과 건수 비교만 할 때
  "aliases": {"옛상호예시": "B2B000"},          # 상호 변경·표기 차이: 원문 업체명 → 통합ID (실제 목록은 저장소 밖 config에)
  "platform_export": "POUR플랫폼_List.xlsx",    # 플랫폼(앱) 내보내기 — 기술자문문의(L2)·컨설팅요청_통합·공법설명회이력(L3)
  "sales": "판매현황_정리.csv",                  # 판매현황(거래일·거래처·품목·공급가액·기존통합ID)
  "pt_list": "PT목록.xlsx",                     # 잔디 PT 정리 — 시트 'PT 최종 목록'
  "notices": "26년 POUR 공고문 현황.xlsm",       # 공고문 대시보드 원본 — 시트 '26년 전체 공고문'(7행이 머리줄)
  "cohort_rules": {"exclude": {"B2B203": "상호 변경된 기존 업체", "B2B207": "지표 제외"},
                   "add": {"B2B205": "2026-02-02", "B2B215": "2026-04-07"}}
}

※ 결과 파일에는 업체명이 들어간다. 공개 저장소(깃허브)에 올리지 말 것.
"""
import json, os, re, sys, datetime as dt, collections, unicodedata
import pandas as pd, openpyxl
from openpyxl.styles import PatternFill, Font, Alignment

INTERNAL = re.compile('넷폼|알앤디|경남지사|포어')          # 내부 지사·자사 — 협약사 판정에서 뺌
TEST = re.compile('테스트|test', re.I)                      # 시험 등록
mask = lambda s: re.sub(r'\d[\d-]{7,}', '(전화번호 가림)', str(s or '')).strip()   # 이름 칸에 섞인 전화번호는 결과에 남기지 않음
BASE_FROM, BASE_TO = dt.date(2026, 6, 22), dt.date(2026, 8, 31)   # L2 추세 기준선(이관 구간 이후)
CMP_FROM, CMP_TO = dt.date(2026, 9, 1), dt.date(2026, 10, 31)     # L2 추세 비교 구간

def ncorp(s):  # 업체명 비교용: 법인 표기·공백 제거
    return re.sub(r'\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|\s', '', str(s or ''))
def nsite(s):  # 단지키: 유니코드 정규화(Ⅱ→II 등) · 공백 제거 · 소문자(원장과 같은 규칙)
    return re.sub(r'\s', '', unicodedata.normalize('NFKC', str(s or ''))).lower()
def nsite_match(s):  # 공고·요청 대조용 느슨한 키: 공백·괄호·'아파트' 제거
    return re.sub(r'\s|\(.*?\)|아파트|APT|apt', '', str(s or ''))
def d(v):
    if v is None or (isinstance(v, float) and pd.isna(v)): return None
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    try: return pd.to_datetime(v).date()
    except Exception: return None

def gkey(s):  # 공종키: 공백 제거·소문자, '+'·','로 나눠 정렬 후 '+'로 이음(원장과 같은 규칙)
    s = re.sub(r'\s', '', unicodedata.normalize('NFKC', str(s or ''))).lower()
    return '+'.join(sorted(p for p in re.split(r'[+,]', s) if p))

def build_activity(platform_path, pt_path, to_id, unmatched):
    """플랫폼 내보내기 3개 시트 + 잔디 PT 목록 → 요청 활동(원장과 같은 열)."""
    wb = openpyxl.load_workbook(platform_path, read_only=True, data_only=True)
    ev = []
    spec = [('기술자문문의', 'L2', '협력사명', '현장명', '공종', '접수일자', '낙찰결과'),
            ('컨설팅요청_통합', 'L3요청', '업체', '현장명', '공종별', '등록일자', None),
            ('공법설명회이력', 'L3요청', '시공사', '현장명', '공종', '등록일', None)]
    for tab, kind, cc, sc, gc, dc, rc in spec:
        it = wb[tab].iter_rows(values_only=True); h = [str(x or '') for x in next(it)]
        seen = set()
        for i, r in enumerate(it, 2):
            if not any(r): continue
            r = dict(zip(h, r)); rid = r.get('문의ID(시스템)')
            if rid and rid in seen: continue      # 같은 문의ID가 두 번 나오면 하나만
            seen.add(rid); name = r.get(cc); cid = to_id(name)
            if not cid:
                if name and not INTERNAL.search(str(name)) and not TEST.search(str(name)): unmatched[(tab, mask(name))] += 1
                continue
            ev.append({'event_id': f'{tab}:{rid or i}', '통합ID': cid, '고객명원문': name, '단지원문': r.get(sc), '공종원문': r.get(gc),
                       '사건유형': kind, '사건일': d(r.get(dc)), '출처': '플랫폼 내보내기', '상태원문': r.get('상태') or '',
                       '결과원문': (r.get(rc) or '') if rc else '', '제외사유': ''})
    pt = pd.read_excel(pt_path, sheet_name='PT 최종 목록')
    for _, r in pt.iterrows():
        txt = ' '.join(map(str, r.values))
        if re.search('감리|조현식', txt): continue
        name = r['PT 요청사/요청자']; cid = to_id(name)
        if not cid:
            if isinstance(name, str) and name.strip() and not INTERNAL.search(name) and not TEST.search(name): unmatched[('PT 최종 목록', mask(name))] += 1
            continue
        g = r['공사명']; mixed = bool(re.search(r'참여인원|비교\s*설명|빔', str(g)))
        ev.append({'event_id': f'PT:{r["번호"]}', '통합ID': cid, '고객명원문': name, '단지원문': r['아파트명'], '공종원문': g,
                   '사건유형': 'L3요청', '사건일': d(r['최초 PT 요청일']), '출처': 'PT 일정 정리(잔디)', '상태원문': str(r['PT 상태']).strip(),
                   '결과원문': '', '제외사유': '공종에 일정·인원·비교설명 혼합: 시간KPI 제외' if mixed else ''})
    e = pd.DataFrame(ev)
    e = e[e['사건일'].notna()].copy(); e['사건일'] = pd.to_datetime(e['사건일'])
    e['단지키'] = e['단지원문'].map(nsite); e['공종키'] = e['공종원문'].map(gkey)
    e['시간KPI유효'] = e['제외사유'] == ''
    e['고객활동유효'] = True
    return e

def main(cfg_path):
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    here = os.path.dirname(os.path.abspath(cfg_path))
    P = lambda k: os.path.join(here, cfg[k]) if cfg.get(k) and not os.path.isabs(cfg[k]) else cfg.get(k)
    asof = pd.Timestamp(cfg['asof']); out = os.path.join(P('out_dir'), cfg['asof']); os.makedirs(out, exist_ok=True)
    rules = cfg.get('cohort_rules', {'exclude': {}, 'add': {}})
    log = []

    # ---------- 01 업체 ----------
    m = pd.read_csv(P('mou_master'), encoding='utf-8-sig')
    m['협약일'] = pd.to_datetime(m['협약일'], errors='coerce')
    name2id = {ncorp(n): i for n, i in zip(m['업체명'], m['통합ID']) if pd.notna(i)}

    # 상호 변경·표기 차이로 명부 이름과 다른 업체명 → 통합ID (config 'aliases')
    aliases = {ncorp(k): v for k, v in cfg.get('aliases', {}).items()}
    def to_id(name):
        k = ncorp(name)
        return name2id.get(k) or aliases.get(k)

    # ---------- 02 요청 활동 ----------
    # 기본: 플랫폼(앱) 내보내기 + 잔디 PT 목록에서 직접 만든다(원장 불필요).
    # 예전 원장 파일을 쓰려면 config에 "activity_source": "ledger" 와 "activity_ledger" 경로를 넣는다.
    unmatched = collections.Counter()
    if cfg.get('activity_source', 'platform') == 'ledger':
        e = pd.read_csv(P('activity_ledger'), encoding='utf-8-sig')
        e['사건일'] = pd.to_datetime(e['사건일']); e['출처'] = e['원본파일'].astype(str).map(lambda x: '플랫폼 내보내기' if 'sales' in x else ('PT 일정 정리(잔디)' if '잔디' in x else '통합 자료'))
        e['상태원문'] = ''; e['결과원문'] = ''
    else:
        e = build_activity(P('platform_export'), P('pt_list'), to_id, unmatched)
    e = e[e['사건일'] <= asof]
    act = pd.DataFrame({
        '활동ID': e['event_id'], '날짜': e['사건일'].dt.date, '통합ID': e['통합ID'],
        '단계': e['사건유형'].map({'L2': 'L2 문의', 'L3요청': 'L3 요청'}).fillna(e['사건유형']),
        '단지': e['단지원문'], '공종': e['공종원문'], '출처': e['출처'],
        '상태': e['상태원문'], '종료 사유': e['결과원문'],   # 플랫폼 상태 버튼 값(진행중·완료·종료). 업체가 안 누르면 '진행중'으로 남음
        # 아래 6개 열은 KPI 계산용(고객관리카드 'KPI 데이터 파일로 최신화'가 읽음). 이름을 바꾸지 말 것.
        '단지키': e['단지키'], '공종키': e['공종키'], '사건유형': e['사건유형'], '사건일': e['사건일'].dt.date,
        '시간KPI유효': e['시간KPI유효'], '제외사유': e['제외사유'].fillna('')})
    act = act.merge(m[['통합ID', '업체명']], on='통합ID', how='left')
    act = act[['활동ID', '날짜', '업체명', '통합ID', '단계', '단지', '공종', '출처', '상태', '종료 사유',
               '단지키', '공종키', '사건유형', '사건일', '시간KPI유효', '제외사유']].sort_values('날짜', ascending=False)

    # ---------- 03 판매 ----------
    s = pd.read_csv(P('sales'), encoding='utf-8-sig', low_memory=False)
    s['거래일'] = pd.to_datetime(s['거래일'], errors='coerce')
    s = s[s['거래일'] <= asof]
    sale = pd.DataFrame({'거래일': s['거래일'].dt.date, '통합ID': s['기존통합ID'], '거래처명(판매 기록)': s['거래처명_원문'],
        '전표번호': s['전표번호'], '품목': s['품목명_원문'], '수량': s['수량'], '공급가액(원)': s['공급가액'],
        '명부 연결': s['기존통합ID'].notna().map({True: '연결됨', False: '연결 안 됨'}),
        '운반비': s['품목명_원문'].astype(str).str.contains('운반').map({True: '운반비', False: ''})})
    sale = sale.merge(m[['통합ID', '업체명']].rename(columns={'업체명': '업체명(명부)'}), on='통합ID', how='left')
    sale = sale[['거래일', '업체명(명부)', '통합ID', '거래처명(판매 기록)', '전표번호', '품목', '수량', '공급가액(원)', '명부 연결', '운반비']].sort_values('거래일', ascending=False)

    # ---------- 04 PT ----------
    pt = pd.read_excel(P('pt_list'), sheet_name='PT 최종 목록')
    txt = pd.Series([' '.join(map(str, v)) for v in pt.values], index=pt.index)
    pt['감리'] = txt.str.contains('감리|조현식')
    ptt = pd.DataFrame({'PT번호': pt['번호'], '요청일': pd.to_datetime(pt['최초 PT 요청일'], errors='coerce').dt.date,
        '예정일': pd.to_datetime(pt['최종 PT 예정일'], errors='coerce').dt.date, '단지': pt['아파트명'],
        '요청사(원문)': pt['PT 요청사/요청자'], '통합ID': pt['PT 요청사/요청자'].map(lambda x: name2id.get(ncorp(x))),
        '공법(원문)': pt['공법명(원문 키워드)'], '담당': pt['PT 담당자(배정)'], 'PT 상태': pt['PT 상태'].astype(str).str.strip(),
        '실제 진행': '',  # 채울 칸: 진행 완료 / 취소 / 일정 변경 / 미진행
        '감리 PT': pt['감리'].map({True: '감리', False: ''}), '단지키': pt['아파트명'].map(nsite)})
    ptt = ptt.sort_values('요청일', ascending=False)

    # ---------- 05 공고 ----------
    ws = openpyxl.load_workbook(P('notices'), read_only=True, data_only=True)['26년 전체 공고문']
    rows = list(ws.iter_rows(min_row=7, values_only=True)); hdr = [str(x or '').strip() for x in rows[0]]
    nt = pd.DataFrame([r for r in rows[1:] if any(r)], columns=hdr)
    nt = nt[nt['고유번호'].notna()]
    kind_cols = ['옥상방수', '재도장', '주차장', '도로', '기타']
    def kind(r):
        for k in kind_cols:
            if pd.notna(r.get(k)) and str(r.get(k)).strip() not in ('', 'None'): return k, str(r.get(k)).strip()
        return '', ''
    kk = nt.apply(kind, axis=1)
    pat_cols = [c for c in hdr if c.startswith('특허번호')]
    notice = pd.DataFrame({'공고번호': nt['고유번호'], '공고일': nt['공고일'].map(d), '개찰일': nt['개찰일'].map(d),
        '단지': nt['단지명'], '대표공종': [k[0] for k in kk], '세부공종': [k[1] for k in kk], '구분': nt['구분'],
        '특허번호': nt[pat_cols].apply(lambda r: ', '.join(str(x) for x in r if pd.notna(x) and str(x) not in ('', 'None')), axis=1),
        '공법사': nt['업체명'], '공사명': nt['공사명'], '지역': nt['지역'], '도시': nt['도시'], '상태': nt['상태'],
        '낙찰업체': nt['낙찰업체'], '낙찰금액': nt['낙찰금액'], '단지키': nt['단지명'].map(nsite)})
    notice = notice[notice['공고일'].notna() & (notice['공고일'] <= asof.date())]
    # 요청 ↔ 공고 대조(이름 기준 추정): 공고일 전 365일 안에 같은 단지 요청이 있었는지
    req = collections.defaultdict(list)
    for _, r in e.iterrows(): req[nsite_match(r['단지원문'])].append((r['사건일'].date(), r['통합ID']))
    def match(r):
        hits = [(t, i) for t, i in req.get(nsite_match(r['단지']), []) if r['공고일'] and r['공고일'] - dt.timedelta(days=365) <= t <= r['공고일']]
        return pd.Series({'앞선 요청': '있음' if hits else '', '요청 업체 통합ID': ', '.join(sorted({str(i) for _, i in hits}))})
    notice = pd.concat([notice, notice.apply(match, axis=1)], axis=1).sort_values('공고일', ascending=False)

    # ---------- 업체 한 줄 요약 ----------
    g = e.groupby('통합ID')
    y = asof.year
    agg = pd.DataFrame({'누적L2': g.apply(lambda x: (x['사건유형'] == 'L2').sum()), '누적L3': g.apply(lambda x: (x['사건유형'] == 'L3요청').sum()),
        'L2y': g.apply(lambda x: ((x['사건유형'] == 'L2') & (x['사건일'].dt.year == y)).sum()),
        'L3y': g.apply(lambda x: ((x['사건유형'] == 'L3요청') & (x['사건일'].dt.year == y)).sum()), '최근': g['사건일'].max()})
    s2 = s[~s['품목명_원문'].astype(str).str.contains('운반') & s['기존통합ID'].notna()]
    pg = s2.groupby('기존통합ID')
    pur = pd.DataFrame({'py': pg.apply(lambda x: x.loc[x['거래일'].dt.year == y, '공급가액'].sum()),
        'py1': pg.apply(lambda x: x.loc[x['거래일'].dt.year == y - 1, '공급가액'].sum()),
        '마지막': pg.apply(lambda x: x.loc[x['공급가액'] > 0, '거래일'].max())})
    # L2 추세(플랫폼 기술자문 등록 기준, 업체명으로 연결)
    trend = {}
    if cfg.get('platform_export'):
        wb = openpyxl.load_workbook(P('platform_export'), read_only=True, data_only=True)
        it = wb['기술자문문의'].iter_rows(values_only=True); h0 = [str(x or '') for x in next(it)]
        reg = collections.defaultdict(list)
        for r in it:
            r = dict(zip(h0, r)); t = d(r.get('접수일자'))
            if t and r.get('현장명'): reg[ncorp(r.get('협력사명'))].append(t)
        for p, ts in reg.items():
            if INTERNAL.search(p): continue
            a = sum(BASE_FROM <= t <= BASE_TO for t in ts); b = sum(CMP_FROM <= t <= CMP_TO for t in ts)
            if a == 0 and b == 0: k = '이관 구간만' if any(t < BASE_FROM for t in ts) else '기간 밖'
            elif a == 0: k = '신규 활동'
            else:
                ch = (b / ((CMP_TO - CMP_FROM).days + 1)) / (a / ((BASE_TO - BASE_FROM).days + 1)) - 1
                k = ('중단(확실)' if a >= 3 else '중단(소수)') if b == 0 else ('감소' if a >= 3 and ch < -.25 else '증가' if a >= 3 and ch > .25 else '유지' if a >= 3 else '판정 보류')
            trend[p] = (k, a, b)
    ev = e[e['고객활동유효'] == True]
    def kpi1(r):
        if r['신규기존구분'] != f'{y} 신규': return '', ''
        i = r['통합ID']
        if i in rules.get('exclude', {}): return '제외: ' + rules['exclude'][i], ''
        d0 = pd.Timestamp(rules.get('add', {}).get(i, r['협약일']))
        if pd.isna(d0) or d0 + pd.Timedelta(days=89) > asof: return '관찰 중', ''
        lo, hi = d0 - pd.Timedelta(days=90), d0 + pd.Timedelta(days=89)
        if len(ev[(ev['통합ID'] == i) & (ev['사건일'] >= lo) & (ev['사건일'] <= hi)]): return '대상', '활용(L2·L3)'
        p = s2[(s2['기존통합ID'] == i) & (s2['거래일'] >= lo) & (s2['거래일'] <= hi) & (s2['공급가액'] > 0)]
        return '대상', '구매로만 활용' if len(p) else '미활용'
    # 추가 모수(명부에서 신규로 안 잡힌 업체)도 KPI1에 넣기
    for i, mou in rules.get('add', {}).items():
        mm = m['통합ID'] == i
        if mm.any(): m.loc[mm, '신규기존구분'] = f'{y} 신규'; m.loc[mm, '협약일'] = pd.Timestamp(mou)
    up = []
    for _, r in m.iterrows():
        i = r['통합ID']; a = agg.loc[i] if i in agg.index else None; p = pur.loc[i] if i in pur.index else None
        tr = trend.get(ncorp(r['업체명'])); k1 = kpi1(r); memo = []
        if r['신규기존구분'] == '협약일 미확인': memo.append('협약일 미확인')
        if pd.isna(i): memo.append('통합ID 없음')
        if a is None and p is None: memo.append('활동·구매 기록 연결 안 됨')
        if i in rules.get('add', {}): memo.append('KPI1 협약일 정정(' + rules['add'][i] + ')')
        up.append([r['업체명'], i if pd.notna(i) else None, r['신규기존구분'], r['협약일'].date() if pd.notna(r['협약일']) else None,
            a['최근'].date() if a is not None else None, tr[0] if tr else '플랫폼 기록 없음', tr[1] if tr else None, tr[2] if tr else None,
            int(a['L2y']) if a is not None else 0, int(a['L3y']) if a is not None else 0, int(a['누적L2']) if a is not None else 0, int(a['누적L3']) if a is not None else 0,
            int(round(p['py'])) if p is not None else 0, int(round(p['py1'])) if p is not None else 0,
            p['마지막'].date() if p is not None and pd.notna(p['마지막']) else None, k1[0], k1[1], r.get('지역'), ', '.join(memo)])
    UH = ['업체명', '통합ID', '구분', '협약일', '최근 활동일', 'L2 추세(9~10월)', '기준선 L2(6/22~8/31)', '비교 L2(9/1~10/31)',
          f'{y} L2 문의', f'{y} L3 요청', '누적 L2 문의', '누적 L3 요청', f'{y} 구매액(원)', f'{y-1} 구매액(원)', '마지막 구매일', 'KPI1 대상', 'KPI1 결과', '지역', '확인 메모']
    U = pd.DataFrame(up, columns=UH).sort_values('최근 활동일', ascending=False, na_position='last')

    # ---------- 검증(공식 숫자 재현) ----------
    k1 = U[U['KPI1 대상'] == '대상']; n_use = (k1['KPI1 결과'] == '활용(L2·L3)').sum(); n_buy = (k1['KPI1 결과'] != '미활용').sum()
    log.append(f'KPI1: 활용 {n_use}/{len(k1)} = {n_use/len(k1)*100:.1f}% · 구매 포함 {n_buy}/{len(k1)} = {n_buy/len(k1)*100:.1f}%')
    s26 = s2[s2['거래일'].dt.year == y]; s26a = s[(s['거래일'].dt.year == y) & (s['공급가액'] > 0) & ~s['품목명_원문'].astype(str).str.contains('운반')]
    link_rows = s26a['기존통합ID'].notna().mean(); link_amt = s26a.loc[s26a['기존통합ID'].notna(), '공급가액'].sum() / s26a['공급가액'].sum()
    ptx = ptt[ptt['감리 PT'] == '']; ptu = ptx['PT 상태'].str.startswith('진행 여부 미확인').sum()
    pour = notice[notice['구분'] == 'POUR']; pour_req = (pour['앞선 요청'] == '있음').mean() if len(pour) else 0
    C = [['협약 명부 업체', f'{len(m)}곳', f'통합ID 있음 {m["통합ID"].notna().sum()}곳, 협약일 미확인 {(m["신규기존구분"] == "협약일 미확인").sum()}곳', '협약일 미확인 업체는 MOU 원본으로 채우기'],
         ['L2·L3 기록이 이어진 업체', f'{U["최근 활동일"].notna().sum()}곳 / {len(m)}곳', '원장에서 업체명이 명부와 정확히 맞은 기록만 이어짐', '앱 등록 때 업체를 통합ID로 고르게 하기'],
         [f'{y} 판매 기록의 업체 연결', f'{link_rows*100:.0f}% (행) / {link_amt*100:.0f}% (금액)', '거래처명이 명부 이름과 정확히 같을 때만 연결됨', '판매 기록에 사업자번호 남기기'],
         ['PT 실제 진행 확인', f'{len(ptx):,}건 중 "진행 완료 확인" {(ptx["PT 상태"] == "진행 완료 확인").sum()}건', f'"진행 여부 미확인" {ptu:,}건({ptu/len(ptx)*100:.0f}%), 취소 {(ptx["PT 상태"] == "취소").sum()}건', 'PT 표의 "실제 진행" 칸을 담당자가 채우기'],
         ['L2 추세 판정 업체', f'{len(trend)}곳 중 명부 연결 {int((U["L2 추세(9~10월)"] != "플랫폼 기록 없음").sum())}곳', '플랫폼 협력사명 표기가 명부와 다르면 안 이어짐', '앱 전환 때 통합ID로 고르게 하기'],
         [f'{y} POUR 공고 중 앞선 요청 확인', f'{len(pour)}건 중 {int((pour["앞선 요청"] == "있음").sum())}건 ({pour_req*100:.0f}%)', '공고 단지명과 요청 단지명을 이름으로 대조한 추정값(공고 전 365일)', '앱 요청에 단지 코드(K-APT 단지코드) 남기기'],
         ['같은 지표의 다른 정의', 'KPI마다 2개 이상', '예: KPI1 = 운영기준서(90일 L3 50%) vs 현재(협약 전후 90일 L2·L3, 목표 70%) vs 구매 포함 참고값', '지표 정의서 1장으로 통일']]
    um = pd.DataFrame([(t, n, c) for (t, n), c in unmatched.most_common()], columns=['원본 시트', '업체명(원문)', '건수'])
    if len(um):
        C.insert(2, ['명부에 없는 업체명(요청 기록)', f'{um["업체명(원문)"].nunique()}개 이름 · {int(um["건수"].sum())}건', '상호 변경·표기 차이이거나 비협약 업체. 이 요청은 업체 표에 이어지지 않음', '00_명부에_없는_업체명.csv를 보고 같은 업체면 config의 aliases에 추가'])
    if cfg.get('compare_ledger'):   # 예전 원장과 비교(전환 확인용)
        L = pd.read_csv(P('compare_ledger'), encoding='utf-8-sig'); L = L[pd.to_datetime(L['사건일']) <= asof]
        log.append(f'예전 원장 비교: 원장 {len(L)}건(L2 {(L["사건유형"]=="L2").sum()}·L3 {(L["사건유형"]=="L3요청").sum()}) / 새로 만든 활동 {len(act)}건(L2 {(act["사건유형"]=="L2").sum()}·L3 {(act["사건유형"]=="L3요청").sum()})')
    log += [' · '.join(c[:2]) for c in C]

    # ---------- 저장: 표준 표 CSV ----------
    std = {'01_업체.csv': U, '02_요청활동.csv': act, '03_판매.csv': sale, '04_PT.csv': ptt, '05_공고.csv': notice}
    for fn, df in std.items(): df.to_csv(os.path.join(out, fn), index=False, encoding='utf-8-sig')
    um.to_csv(os.path.join(out, '00_명부에_없는_업체명.csv'), index=False, encoding='utf-8-sig')
    # ---------- 데이터북 xlsx ----------
    readme = [[f'POUR 협약사 데이터북 (자료 기준일 {cfg["asof"]})'], [''], ['이 파일로 할 수 있는 것'],
        ['- 업체 한 줄에서 협약, 문의(L2), 요청(L3), 구매, 9~10월 추세, KPI1 결과를 함께 봄'], ['- 통합ID로 필터하면 요청활동·판매·PT·공고 시트에서 그 업체의 실제 기록을 봄'], [''],
        ['시트 안내'], ['업체: 협약 명부 한 줄씩. 최근 활동일 순'], ['요청활동: L2 문의·L3 요청 기록. 오른쪽 회색 열은 KPI 계산용'], [f'판매: 자재 판매 기록 {y-1}~{y}년(반품·운반비 포함, 표시로 구분). 전체 기간은 03_판매.csv'],
        ['PT: 공법설명회 요청과 상태. "실제 진행" 칸을 앞으로 채움'], ['공고: 공고문 대시보드의 공고. "앞선 요청"은 같은 단지 요청이 있었는지 이름으로 대조한 추정'],
        ['연결 현황: 자료끼리 어디가 이어지고 어디가 끊겼는지'], ['데이터 사전: 열의 뜻과 출처'], [''],
        ['세는 규칙'], ['- L2 문의 = 플랫폼 기술자문 등록(영업 진행 보고). L3 요청 = 내역서(컨설팅) 요청 또는 공법설명회(PT) 요청'],
        ['- 같은 현장이라도 시공사가 다르면 따로 셈. 감리 PT는 세지 않음. 취소된 PT는 PT 시트의 상태로 구분'], ['- 구매액 = 공급가액 합계(반품 차감, 운반비 행 제외). 명부 이름과 정확히 맞은 거래처만'],
        ['- L2 추세 = 6/22~8/31 일평균 대비 9/1~10/31 일평균. ±25% 넘으면 증가·감소. 기준선 3건 이상만 판정'],
        ['- KPI1 = 신규 협약사 중 협약 전 90일~후 89일에 L2·L3가 있으면 활용. 모수 규칙은 정의서 참고'], [''],
        ['알고 볼 것'], ['- 구매·활동은 이름이 맞은 것만 이어져 실제보다 적을 수 있음(최소값)'], ['- 이 데이터북은 생성기로 다시 만듦. 시트에서 직접 고친 내용은 다음 갱신 때 사라짐. 고칠 것은 원본이나 규칙에 반영']]
    dic = [['업체', '통합ID', '업체 고유 번호(B2Bxxx). 모든 표를 잇는 열쇠', 'MOU 마스터'], ['업체', '구분', '신규(그 해 협약) / 기존 / 협약일 미확인', 'MOU 마스터'],
        ['업체', 'L2 추세', '증가·유지·감소·중단(확실/소수)·판정 보류·신규 활동·이관 구간만', '플랫폼 내보내기'], ['업체', '구매액', '공급가액 합계(반품 차감, 운반비 제외)', '판매현황'],
        ['업체', 'KPI1 대상/결과', '대상·관찰 중·제외 / 활용(L2·L3)·구매로만 활용·미활용', '원장 + 판매현황'],
        ['요청활동', '단계', 'L2 문의 / L3 요청', '원장'], ['요청활동', '상태·종료 사유', '플랫폼 상태 버튼 값: 진행중 / 완료(지원마감요청=L4 도달) / 종료(영업 철수·타공법 전략 수정·타공법 공고·동일공법 타사 낙찰·등록 실수). 업체가 안 누르면 진행중으로 남으므로 공고 시트로 확인', '플랫폼(앱) 내보내기'],
        ['요청활동', '단지키·공종키·사건유형·사건일·시간KPI유효·제외사유', 'KPI 계산용. 이름 바꾸지 말 것', '원장'],
        ['판매', '명부 연결', '연결됨 = 거래처명이 명부와 같아 통합ID가 붙음', '판매현황'], ['PT', 'PT 상태', '잔디 기록에서 읽은 상태(요청·예정·취소·진행 여부 미확인 등)', 'PT 목록'],
        ['PT', '실제 진행', '담당자가 채울 칸: 진행 완료 / 취소 / 일정 변경 / 미진행', '담당자 입력'], ['PT', '통합ID', '요청사 이름이 명부와 맞을 때만 붙음', 'PT 목록 + 명부'],
        ['공고', '구분', 'POUR / 타사 / 다특허 등 (공고문 대시보드 기준)', '공고문 원본'], ['공고', '앞선 요청', '공고 전 365일 안에 같은 단지 요청이 있었는지(이름 대조 추정)', '공고 + 원장'],
        ['공고', '낙찰업체·낙찰금액', 'L5 확인용(원본에 있을 때)', '공고문 원본']]
    xl = os.path.join(out, f'POUR_협약사_데이터북_{cfg["asof"]}.xlsx')
    with pd.ExcelWriter(xl, engine='openpyxl') as W:
        pd.DataFrame(readme).to_excel(W, sheet_name='읽는 법', index=False, header=False)
        U.to_excel(W, sheet_name='업체', index=False); act.to_excel(W, sheet_name='요청활동', index=False)
        # 판매는 시트 칸 수 한도 때문에 최근 2년만(전체는 03_판매.csv)
        sale[pd.to_datetime(sale['거래일']).dt.year >= y - 1].to_excel(W, sheet_name='판매', index=False)
        ptt.to_excel(W, sheet_name='PT', index=False); notice.to_excel(W, sheet_name='공고', index=False)
        pd.DataFrame(C, columns=['확인 항목', '현재', '무슨 뜻인지', '다음에 할 일']).to_excel(W, sheet_name='연결 현황', index=False)
        pd.DataFrame(dic, columns=['표', '열', '뜻', '출처']).to_excel(W, sheet_name='데이터 사전', index=False)
        fill = PatternFill('solid', fgColor='F3F3F3'); gray = PatternFill('solid', fgColor='E8E8E8')
        for name, ws in W.sheets.items():
            if name == '읽는 법':
                ws.column_dimensions['A'].width = 110; continue
            for c in ws[1]: c.fill = fill; c.font = Font(bold=True); c.alignment = Alignment(wrap_text=True, vertical='top')
            ws.freeze_panes = 'B2' if name not in ('연결 현황', '데이터 사전') else 'A2'
            for col in ws.columns:
                head = str(col[0].value or ''); w = min(max(len(head) * 1.6 + 2, 9), 40)
                ws.column_dimensions[col[0].column_letter].width = w
                if name == '요청활동' and head in ('단지키', '공종키', '사건유형', '사건일', '시간KPI유효', '제외사유'): col[0].fill = gray
                for c in col[1:]:
                    if isinstance(c.value, (dt.date, dt.datetime)): c.number_format = 'yyyy-mm-dd'
                    elif '원)' in head or head == '낙찰금액': c.number_format = '#,##0'
                    if name in ('연결 현황', '데이터 사전'): c.alignment = Alignment(wrap_text=True, vertical='top')
            if name in ('연결 현황', '데이터 사전'):
                for k, w in zip('ABCD', (24, 30, 60, 40)): ws.column_dimensions[k].width = w
    open(os.path.join(out, '검증.txt'), 'w', encoding='utf-8').write('\n'.join(log) + '\n')
    print('\n'.join(log)); print('→', out)

if __name__ == '__main__':
    main(sys.argv[1])
