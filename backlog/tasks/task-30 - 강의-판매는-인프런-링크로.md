---
id: TASK-30
title: 교육 — 강의 판매는 외부 링크(인프런)로
status: Done
assignee: []
created_date: '2026-09-29 18:00'
labels:
  - 코드
  - 교육
dependencies: []
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
사업자등록 없이 HACK:ON 이 직접 돈을 받을 길은 없다(PG 계약은 사업자만). 판매는 이미 정산을 해 주는 곳에 맡긴다.
- 인프런: 개인 등록 가능(주민번호·계좌), 독점 계약 70%, **본인이 퍼뜨린 링크·쿠폰으로 팔리면 90%**, 원천세 3.3% 뗀 뒤 익월 지급(인프런 지식공유자 문서, 9/29 확인).
- 대면 유료 모임은 탈잉(원데이 15%)·문토(20%, 원천징수 안 해 줌 → 5월 종소세 본인 신고).

만들 것: lectures 에 buy(외부 판매 주소) 한 칸. /learn 에서 «전체 강의 보기(인프런)» 단추. 주소는 webUrl 로 거르고 rel=noopener.
함정: 평생교육법 — 학습비를 받고 불특정 10명 이상에게 30시간 이상 온라인 과정이면 원격평생교육시설 신고 대상. 묶어 팔 때 시간을 센다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 buy 주소가 https 가 아니면 저장 안 됨 — 단위 검사
- [ ] #2 buy 가 없는 강의에는 단추가 없다 — 판매처 없는 강의에 단추가 없는지는 검사 없음
검사: node server.js --test · python3 check-e2e.py (2026-09-29), 체크한 항목은 지키는 코드를 깨뜨려 빨간 줄 확인
<!-- AC:END -->
