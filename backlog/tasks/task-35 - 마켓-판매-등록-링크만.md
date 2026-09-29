---
id: TASK-35
title: 마켓 — 판매 등록(돈은 판매자 본인 계정으로)
status: Done
assignee: []
created_date: '2026-09-29 19:00'
labels:
  - 코드
  - 마켓
dependencies: []
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
바이브코딩 결과물을 시연하고 정해진 값에 파는 페이지. **HACK:ON 은 돈을 만지지 않는다.** 사업자등록이 없고, 해외 MoR(Polar·Lemon Squeezy·Paddle)은 셋 다 «남의 상품을 대신 파는 마켓플레이스» 를 금지한다 — HACK:ON 계정 하나로 대신 팔 수 없다(각 문서, 9/29 확인). 판매자가 자기 계정을 열고 HACK:ON 은 링크만 건다.
한국 개인 정산이 확인된 곳: Gumroad(한국 계좌 지원, 10%+$0.50), 크몽(사업자 전 가능, 3.3% 원천징수). Polar 는 «Stripe Express 가 개인을 허용하면».

만들 것: 표 listings(person, source: submission|outside, title, price, license, refund, buy_url, ok, off). buy_url 은 webUrl + **허용 도메인만**(gumroad.com·polar.sh·lemonsqueezy.com·kmong.com). 라이선스는 셋 중 하나를 꼭 고른다 — MIT / 개인용 / 상업용.
대회 제출작은 쇼케이스 동의(show)가 켜진 것만, 밖에서 만든 것은 운영자 확인(ok)된 것만 판매 등록할 수 있다.
등록 흐름 레퍼런스: Patreon 디지털 상품 https://mobbin.com/flows/050d189a-39ca-42a5-982c-494fd4636d48 (최저가 검사·«첫 판매 뒤 수정 불가» 안내)
흐름도: FigJam «HACK:ON 시연·판매 흐름 (사업자 전)» https://www.figma.com/board/ucL0hwEvldOQItP3yQwLau
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 허용 목록 밖 도메인·javascript: 주소는 저장 안 됨 — 단위 검사, 깨뜨려 확인
- [x] #2 라이선스를 안 고르면 400
- [x] #3 쇼케이스 동의 없는 제출작은 판매 등록 불가
검사: node server.js --test · python3 check-e2e.py (2026-09-29), 체크한 항목은 지키는 코드를 깨뜨려 빨간 줄 확인
<!-- AC:END -->
