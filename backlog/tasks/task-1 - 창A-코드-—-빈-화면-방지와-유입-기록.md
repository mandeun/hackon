---
id: TASK-1
title: 창A 코드 — 빈 화면 방지와 유입 기록
status: Done
assignee: []
created_date: '2026-09-24 11:50'
updated_date: '2026-09-24 12:05'
labels:
  - 코드
  - 창A
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
hackon.kr 에 사람이 왔을 때 열린 대회가 0개면 죽은 사이트로 보인다. 그리고 지금은 누가 어디로 들어와서 어디서 나갔는지 아무 기록이 없다. 이 둘만 고친다. 코드를 건드리는 창은 이 창 하나뿐이다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 열린 대회가 0개일 때 home.html 이 빈 목록 대신 «둘러보기용 예시 대회» 한 개를 보여준다
- [ ] #2 server.js 가 경로별 방문을 sqlite 한 테이블에 센다 (의존성 0 유지)
- [ ] #3 주최자 열쇠로 들어가면 최근 7일 방문을 볼 수 있다
- [ ] #4 npm test 와 npm run check:e2e 둘 다 통과
- [ ] #5 새 파일을 만들었다면 Dockerfile COPY 에 넣었다
<!-- AC:END -->
