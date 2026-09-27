---
id: TASK-14
title: 바이럴 2단계 — 순위 시즌제와 내비 노출
status: Done
assignee: []
created_date: '2026-09-28 09:00'
updated_date: '2026-09-28 18:00'
labels:
  - 바이럴
  - 코드
dependencies: []
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
티어·XP·/rank 는 이미 있는데 첫 화면 어디에서도 안 보인다. 그리고 XP 가 영구 누적이라
1등이 굳으면 아무도 안 온다. 10/31 회차가 끝나 /api/rank 에 줄이 생긴 뒤에 켠다.

지금 켜면 빈 화면을 내비에 거는 것이 된다.

**검사** — 화면(칩·남은 날·첫 화면 입구)은 눈으로만 봤다. 단위 검사는 seasonOf·seasonEnd·seasonLeft·xpOf(season)·rank() 두 줄까지.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 분기 시즌. 시즌 종료까지 남은 날이 순위 화면 맨 위에 뜬다
- [x] #2 지난 시즌 기록은 안 지우고 따로 남는다 (이번 시즌 / 통산 두 줄)
- [ ] #3 첫 화면에서 순위로 가는 입구가 하나 있다. 아래 탭은 넷 그대로 둔다
- [ ] #4 줄이 0 개인 동안에는 입구를 안 건다 — 없음과 모름을 가른다
- [ ] #5 e2e: 시즌이 바뀌면 이번 시즌 XP 가 0 으로 시작하고 통산은 그대로다
<!-- AC:END -->
