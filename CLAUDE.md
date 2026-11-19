# [시험 사본] tazan0068/card-kpi-test

이 저장소는 bridgeone-m/card(운영)를 2026-11-19 커밋 14841ee 기준으로 복사한 **시험용 사본**임.
B2B KPI 홈(3대 KPI·선행지표) 개편을 시험하고, 확정된 변경만 운영 저장소에 PR로 옮김.

## 사본에서 바뀐 안전장치 (운영으로 옮길 때 되돌릴 것)
- b2b-kpi-store.js: KPI 값 저장 위치를 `shared/b2bOpsTracker_test`로 바꿈. 처음 읽을 때 운영 값을 한 번 복사해 옴. 운영 위치에는 쓰지 않음.
- index.html: Firestore 쓰기(setDoc·writeBatch·runTransaction)와 Storage 업로드·삭제를 막음. 고객 데이터는 읽기만 함. 상단에 시험 사본 띠를 표시함.
- .github/workflows/pages.yml: KAKAO 키가 없어도 배포함(지도 팝업만 꺼짐).
- 운영 URL·Firebase projectId·고객 데이터 규칙은 아래 원본 기준을 그대로 따름.

---

# 프로젝트 기준

메인 저장소:
bridgeone-m/card

메인 브랜치:
main

운영 URL:
https://bridgeone-m.github.io/card/

Firebase:
pour-dashboard

GitHub Pages:
GitHub Actions 방식 유지

Secret:
KAKAO_MAP_JS_KEY 유지

# 작업 원칙

- 고객관리 관련 모든 작업은 bridgeone-m/card 기준
- hansol941201/card 수정 금지
- tazan0068/customer-card 수정 금지
- 작업 시작 전 main 최신 상태 확인
- 기존 Firebase 고객 데이터 초기화/삭제 금지
- 기존 고객정보, 미팅, MOU, 활동이력, 메모, 매출, 시공실적 보존
- Firebase projectId 변경 금지
- KAKAO_MAP_JS_KEY 구조 유지
- 기존 Pages 배포 방식 유지
- 기능 수정 시 기존 운영 데이터와 호환성 우선
- 배포 후 운영 URL 확인
