---
id: TASK-15
title: 바이럴 2단계 — 만든 것 갤러리를 첫 화면 위로
status: Done
assignee: []
created_date: '2026-09-28 09:00'
updated_date: '2026-09-28 18:00'
labels:
  - 바이럴
  - 코드
dependencies: []
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
코드가 아니라 «만들어진 물건» 이 먼저 보여야 비개발자가 들어온다.
지금 첫 화면의 «지난 대회 우수작» 은 목록 아래에 있고 동의분이 0 건이라 통째로 숨어 있다.

10/31 회차에서 쇼케이스 동의가 붙은 뒤에 승격한다.

**검사** — «셋부터 위로» 와 iframe 열기는 눈으로만 봤다. 열림·나이는 서버 단위 검사가 덮는다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 쇼케이스 카드에 «지금 열림» 배지와 나이(새싹·풀·나무)가 함께 뜬다
- [ ] #2 동의분이 3건 이상일 때만 첫 화면 위로 올라온다. 그 아래면 지금 자리 그대로
- [ ] #3 카드를 누르면 그 자리에서 iframe 으로 열린다 (이미 있는 동작을 그대로 쓴다)
- [ ] #4 e2e: 동의 안 한 결과물은 갤러리에 안 뜬다
<!-- AC:END -->
