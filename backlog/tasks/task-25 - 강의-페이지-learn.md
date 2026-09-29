---
id: TASK-25
title: 강의 페이지 /learn
status: To Do
assignee: []
created_date: '2026-09-29 15:30'
labels:
  - 코드
  - 10/31 전
dependencies: []
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
정회광 님이 설치 강의와 «카톡·메일 답장 자동화» 수업을 찍어 hackon 에 올리기로 했다(루키팀 방, 9/29). 지금 hackon 에는 영상·강의 관련 표도, 라우트도 없다.

**영상은 서버에 두지 않는다.**
- 공개 강의는 유튜브 **일부공개** 영상을 hackon 화면에 붙인다. 유튜브 검색 자체가 유입 창구가 된다.
- 유료 강의는 이 태스크에 넣지 않는다. 나중에 Cloudflare R2 비공개 버킷에 두고 짧게 만료되는 서명 주소로 연다.
  - R2 는 월 10GB 까지 무료이고, 내보내기 트래픽 요금이 없다(2026-09-29 공식 가격표 확인).
- Fly(nrt) 에서 직접 흘리는 방식은 쓰지 않는다.
  - 내보내기 트래픽이 GB 당 $0.04 다(2026-09-29 docs.fly.io 확인).
  - 영상을 보는 동안 꺼져 있던 기계가 계속 깨어 있게 된다(min_machines_running = 0 인 설계와 충돌).

**선행 조건(사람 손):** 연세대 인강은 법률검토를 거친 영상이다. 연대 쪽에 재사용이 되는지 확인하기 전에는 올리지 않는다. 회광 님이 따로 찍는 설치 강의는 이 문제가 없다.

화면 레퍼런스:
- Magnific 에피소드 목록 https://mobbin.com/screens/0564e247-f8a3-47c2-a992-8376b0a5b109
- Kajabi 강의 화면 https://mobbin.com/screens/2adb72d9-f443-4e78-a576-3c919a9c2509

**만들 것**
- 표 `lectures`: id, title, yt(유튜브 id), person(강사 people.id), minutes, ord, series, at
- `GET /api/lectures`: 공개 목록
- `POST /api/lectures`: siteAdmin 만
- `/learn`: 목록과 재생 화면. hack-on.html 의 SPA 경로에 추가한다
- 강사 이름을 누르면 `/p/<id>` 로 간다(TASK-27 에서 거기에 «올린 강의» 가 붙는다)

**보안**
- 유튜브 id 는 서버에서 `^[A-Za-z0-9_-]{11}$` 로만 받는다. iframe HTML 이나 임의 주소는 저장하지 않는다.
- 붙이는 주소는 `https://www.youtube-nocookie.com/embed/<id>` 로 서버가 만든다. 현재 CSP 의 `frame-src https:` 안에 들어간다.
- 쓰기는 siteAdmin 쿠키로만 받는다. 강사가 스스로 «내 강의» 를 등록하는 길은 만들지 않는다. 남의 이름으로 강의를 걸 수 있게 되기 때문이다.
- 새 정적 파일이 생기면 STATIC_OK 에 적는다.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 11자 규칙에 안 맞는 id(`javascript:`, 긴 주소, iframe 태그)는 400 — 단위 검사, 규칙을 깨뜨려 빨간 줄 확인
- [ ] #2 쿠키 없는 POST /api/lectures 는 403 — 단위 검사, 깨뜨려 확인
- [ ] #3 /learn 이 열리고 영상 칸이 youtube-nocookie 주소를 가리킨다 — e2e
- [ ] #4 강의가 0건일 때와 목록을 못 불러왔을 때를 다른 문구로 그린다(있음/없음/모름)
<!-- AC:END -->
