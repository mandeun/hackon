---
id: TASK-31
title: 프로젝트 — 몇 주짜리 프로젝트 종류와 주차별 체크인
status: Done
assignee: []
created_date: '2026-09-29 18:00'
labels:
  - 코드
  - 프로젝트
dependencies: []
priority: high
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
가짜연구소(시즌 16주)·모두연 LAB·YAPP 같은 «몇 주짜리» 를 HACK:ON 안에서 굴린다. 표를 새로 만들지 않고 대회의 한 종류로 둔다(kind='프로젝트', 주 수·정기 모임 시간).
주차별 체크인은 기존 came 한 칸을 회차 표(attend: team, week, at)로 넓힌다. 결석은 그대로 «안 온 횟수» 로 이어진다.
만들지 않는 것: 문서함·자료실·피드·채팅(디스코드·노션·카톡이 한다), 6축 스탯·Lv(티어·XP·시즌이 이미 있다 — 가짜연구소 실제 화면도 6축이 전부 «데이터 없음»이었다).
레퍼런스: ClickUp 사람×날짜 격자 https://mobbin.com/screens/812c613b-1ae0-4e0b-a9da-73870c1d0d8c
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 4주 프로젝트에서 2주 빠지면 프로필 «안 온 횟수» 가 2 늘어난다 — 단위 검사
- [x] #2 주차 체크인은 운영자 열쇠로만
검사: node server.js --test · python3 check-e2e.py (2026-09-29), 체크한 항목은 지키는 코드를 깨뜨려 빨간 줄 확인
<!-- AC:END -->
