---
id: TASK-32
title: 프로젝트 — 지원자 카드와 수락·거절(선발형 신청)
status: To Do
assignee: []
created_date: '2026-09-29 18:00'
labels:
  - 코드
  - 프로젝트
dependencies: []
priority: high
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
조사(9/29)에서 찾은 틈: **지원하는 순간 그 사람의 완주·노쇼·매너 기록을 보여 주는 곳이 없다.** 홀라·인프런·렛플은 지원이 오픈카톡·구글폼으로 빠져 기록이 안 남고, 동아리는 «책임감» 을 인재상에 적고도 서류·면접으로만 본다.
만들 것: 신청을 «바로 확정» 대신 «지원 → 리더가 수락/거절» 로 받는 옵션. 리더 화면에 지원자마다 완주율·안 온 횟수·매너(3건 이상일 때 숫자)·받은 칭찬·밖에서 만든 것을 한 장으로.
선행 수정: 완주율 0% 대신 «—»(모름) — TASK 매너 커밋에서 이미 고쳤다.
레퍼런스: Contra 지원→«In review» https://mobbin.com/flows/5f34e873-1d74-4560-b80b-d45680109274 · Homerun 지원자 단계 https://mobbin.com/screens/230cc038-4794-49b0-a01b-dcfa81b698be
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 지원자 카드에 연락처가 안 실린다(리더는 수락 뒤에만 받는다)
- [ ] #2 거절은 공개 기록에 안 남는다
- [ ] #3 기록이 없는 지원자는 «처음» 으로, 0% 로 그리지 않는다
<!-- AC:END -->
