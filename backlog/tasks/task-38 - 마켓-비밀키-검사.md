---
id: TASK-38
title: 마켓 — 판매 저장소 비밀키 검사(gitleaks)
status: To Do
assignee: []
created_date: '2026-09-29 19:00'
labels:
  - 코드
  - 마켓
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
남이 산 코드에 API 키가 박혀 있으면 판매자도 구매자도 다친다. 판매 등록에 공개 저장소 주소를 받으면 gitleaks(MIT)로 한 번 훑고, 걸리면 판매 링크를 끄고 본인에게만 알린다. 이미 CI 에서 gitleaks 를 쓰고 있으니 같은 판을 쓴다.
서버에서 남의 저장소를 받는 일이라 시간·용량 상한을 건다(얕은 clone, 50MB, 60초). Fly 기계가 꺼져 있는 설계라 요청 때 돌리지 않고 운영자 확인 단계에서 돌린다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 테스트 저장소에 가짜 키를 넣으면 판매 링크가 꺼진다
- [ ] #2 상한을 넘으면 «검사 못 함»(모름)으로 남고 판매는 운영자 판단
<!-- AC:END -->
