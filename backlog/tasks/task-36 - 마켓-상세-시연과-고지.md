---
id: TASK-36
title: 마켓 — 상세 페이지(라이브 시연·가격·라이선스·고지)
status: To Do
assignee: []
created_date: '2026-09-29 19:00'
labels:
  - 코드
  - 마켓
dependencies: []
priority: high
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
상세 페이지 /m/<id>. 위에서부터: 라이브 시연 → 가격·라이선스·환불 정책 → 구매 버튼(판매자 계정으로) → 고지.
- 시연은 **외부 출처만 iframe** — 같은 출처에서 allow-scripts + allow-same-origin 을 같이 주면 sandbox 가 풀린다(MDN). home.html 565~572행이 이미 같은 호스트면 새 창으로 여는 규칙을 쓴다. 코드는 hackon.kr 에 올리지도 호스팅하지도 않는다.
- 전자상거래법 17조⑥: 디지털콘텐츠 청약철회 제한은 «철회 불가 표시 + 시험 사용 제공» 이 있어야 성립한다. iframe 시연이 그 «시험 사용» 이 된다.
- 20조①: «HACK:ON 은 통신판매 당사자가 아닙니다. 계약과 결제·환불은 판매자와 판매처가 합니다» 를 버튼 바로 위에. 수수료를 안 받아도 중개로 볼 여지가 있다.
- 쓰지 않는 말: «HACK:ON 검증», «환불 보장» — 품질 보증처럼 읽혀 연대 책임을 부른다.
레퍼런스: Zendesk 테마(View demo·Install 나란히) https://mobbin.com/screens/5ea90a74-b1ed-4ffe-b5a3-206a7f0847de · Unity Asset Store(License·Refund 접힘) https://mobbin.com/screens/a097de78-e891-41da-aea8-5f36d9400113 · Behance(Buy Now 아래 라이선스) https://mobbin.com/screens/6f3b950f-e244-44e4-b610-8fd191602824
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 같은 출처 주소는 iframe 으로 안 띄운다 — e2e
- [ ] #2 고지 문구가 구매 버튼과 같은 화면에 있다 — e2e, 문구를 지워 빨간 줄
- [ ] #3 화면에 «검증»·«보장» 낱말이 없다 — 금지어 검사, 넣어 빨간 줄
<!-- AC:END -->
