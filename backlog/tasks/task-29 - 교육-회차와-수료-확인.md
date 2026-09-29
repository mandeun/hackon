---
id: TASK-29
title: 교육 — 수업 회차·수료 확인 페이지
status: To Do
assignee: []
created_date: '2026-09-29 18:00'
labels:
  - 코드
  - 교육
dependencies: []
priority: high
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
청소년센터(꿈드림)·시니어 기관 AI 교육 봉사를 B2G 레퍼런스로 쓰려면 «언제·어디서·몇 명이 끝까지 들었나» 가 남아야 한다.
TASK-28 의 «모임·수업» 종류를 그대로 쓴다. 새로 만드는 것은 둘이다.

1. **수업 실적 페이지** /e/<id>/report 의 모임판 — 날짜·기관·신청·체크인(온 사람)·서로 평가 건수. 사진은 얼굴 없는 것만, 14세 미만은 법정대리인 동의가 필요하다(조사 9/29). 기관 공문 실적과 함께 쓴다.
2. **수료 확인** /c/<코드> — 체크인한 사람에게만 발급. 이름·과정·날짜·발급처와 QR. 이름은 «수료증» 만 쓴다 — «자격증»·«인증» 은 자격기본법 제17조(미등록 민간자격 운영은 형사처벌) 때문에 안 쓴다.
   Open Badges 2.0(서명 없는 JSON)은 다음 단계, 3.0(VC 서명)은 사업자 뒤.

레퍼런스: Codecademy 수료증(QR·번호) https://mobbin.com/screens/93071642-c4dc-42ec-bd64-ff93afb7646e · Uxcel «Credentials Verified» https://mobbin.com/screens/0c1b9442-fa6b-4b1a-a7de-40576ae7bf00

선행(사람 손): 1365 봉사시간은 수요처(기관)가 입력하고 구 자원봉사센터가 승인한다 — 기관이 수요처로 등록돼 있는지 먼저 확인. 청소년 기관은 봉사자 성범죄경력 조회에 동의해야 한다(청소년성보호법 제56조).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 체크인 안 한 사람에게는 수료 코드가 안 나온다 — 단위 검사, 깨뜨려 확인
- [ ] #2 /c/<코드> 에 연락처가 안 실린다
- [ ] #3 화면 어디에도 «자격증»·«인증» 낱말이 없다 — 금지어 검사, 일부러 넣어 빨간 줄 확인
<!-- AC:END -->
