---
id: TASK-34
title: 조사 — 대회를 연 뒤 서버가 바깥 쓰기를 못 보는 현상
status: Done
assignee: []
created_date: '2026-09-29 18:00'
labels:
  - 조사
  - 운영
dependencies: []
priority: medium
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-09-29 강의 e2e 에서 발견. 검사 서버가 POST /api/events 를 한 번 처리한 뒤로 **파이썬 sqlite3 가 같은 DB 파일에 쓴 줄을 못 봤다.** 서버 자신의 쓰기는 정상 커밋된다(바깥에서 보인다).
원인 후보: (1) 파이썬 sqlite3 와 node:sqlite 가 같은 파일의 잠금·shm 을 맞추지 않는다 (2) 대회 생성 경로 어딘가에 스텝이 덜 끝난 문장이 읽기 잠금을 쥐고 있다.
(2)라면 운영에서 WAL 체크포인트가 막혀 hackon.db-wal 이 계속 커진다. 먼저 운영 기계에서 WAL 크기를 본다: fly ssh console -C 'ls -la /data'.
검사 쪽은 checklib.stop() 으로 «끄고 → 바깥에서 쓰고 → 새로 띄우기» 로 피해 두었다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 운영 WAL 크기 확인 기록 — 2026-09-29 /data/hackon.db-wal 140KB (db 647KB). 쌓이지 않는다
- [x] #2 원인 (1)/(2) 판정 — node 두 프로세스로 같은 실험을 해서 파이썬을 빼 본다
판정: **(1)**. node 만 바깥에서 쓰면 대회를 세 번 열어도 서버가 6/6 을 다 본다. 파이썬 sqlite3(macOS 3.50.4, node 는 3.53.1)가
한 번 쓰고 닫으면 그 뒤로는 node 가 바깥에서 쓴 줄도 서버가 못 본다(7/8, 파이썬은 8 을 본다). 대회 생성과는 무관 — 처음 가설 (2)는 틀렸다.
운영은 node 혼자 쓰므로 해당 없음. 검사는 checklib.stop() 으로 «끄고 → 쓰고 → 새로 띄우기».
재현: scratchpad iso6.py(서버 하나 + node·파이썬 바깥 쓰기)
<!-- AC:END -->
