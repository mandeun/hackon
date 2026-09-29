---
id: TASK-26
title: 지원서 미리 채우기 — 두 번째 신청부터 다시 안 쓰게
status: Done
assignee: []
created_date: '2026-09-29 15:30'
labels:
  - 코드
  - 10/31 전
dependencies: []
priority: medium
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
가짜연구소(pseudo-lab.com)는 지원서를 시즌당 하나로 두고, 다른 프로젝트에 지원할 때 그대로 다시 쓴다. hackon 의 신청 폼(`joinTeam`, hack-on.html 약 1470~1510)은 대회마다 처음부터 새로 쓴다. 10/31 에 16명을 모으려면 신청 마찰을 줄여야 한다.

**가져오지 않는 것:** 가짜연구소의 1·2·3지망 고르기. 16주짜리 시즌에 맞는 구조이고, hackon 대회는 하루짜리다.

**보안 — 서버에서 채우지 않는다**
- «이메일을 넣으면 지난 신청 내용을 불러오는» 길은 만들지 않는다.
- 남의 이메일만 알아도 그 사람의 연락처·소개를 꺼내 볼 수 있게 되기 때문이다(감사 10 과 같은 이유).
- 대신 신청에 성공한 브라우저의 localStorage 에만 지난 입력을 남긴다.
  - 남기는 칸: 이름, 역할, 링크, 가져올 것, 한 줄 소개.
  - 연락처는 남기지 않는다. 공용 PC 에서 다음 사람에게 보이면 안 된다.
- 폼 위에 «지난 신청 내용으로 채움 · 지우기» 한 줄을 둔다.
- localStorage 읽기·쓰기는 전부 try/catch 로 감싼다. 사생활 보호 모드에서는 던질 수 있다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 두 번째 대회 신청 화면에 지난 이름·역할이 채워져 있다 — e2e
- [x] #2 localStorage 에 연락처 칸이 없다 — e2e 단언, 연락처를 일부러 저장하게 바꿔 빨간 줄 확인
- [x] #3 «지우기» 를 누르면 다음 신청 화면이 비어 있다
검사: node server.js --test 985가지 · python3 check-e2e.py 152단계 (2026-09-29), 새 단언은 전부 깨뜨려 빨간 줄 확인
<!-- AC:END -->
