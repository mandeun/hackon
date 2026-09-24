---
id: TASK-7
title: 2차 창1 코드 — 자리별 가격표와 협찬 안내 페이지
status: In Progress
assignee: []
created_date: '2026-09-24 12:17'
labels:
  - 코드
dependencies: []
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
협찬을 «도와주세요»가 아니라 «이 자리 10만원, 벽에 로고»로 판다. needs 에 price 를 붙이고 공개 가격표 한 장을 만든다. 격리된 worktree 에서 작업 중.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 needs 에 price 추가, 기존 DB 는 ALTER 로 올린다
- [ ] #2 자리별 가격표가 폰에서 읽힌다
- [ ] #3 맡기 흐름은 기존 pledge 를 쓴다 — 새로 만들지 않는다
- [ ] #4 로고가 어디에 뜨는지 가격표에 적혀 있다
- [ ] #5 npm test 와 check:e2e 둘 다 통과, 새 점검 6가지 이상
<!-- AC:END -->
