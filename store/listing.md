# HACK:ON — 스토어 등록 문구 · 심사 답변

앱은 hackon.kr 을 여는 껍데기(iOS·Android)다. 껍데기 코드는 이 저장소에 없다. 아래 «수집하는 것» 은 `server.js` 를 읽고 적었다 — 껍데기가 따로 모으는 것(예: 안드로이드 푸시 토큰)이 있으면 그쪽에서 더한다.
한도가 있는 칸은 글자 수(공백 포함)를 맞춰 두었다. 고치면 다시 센다.

## 주소

| 항목 | 값 |
|---|---|
| 지원 URL (Support) | https://hackon.kr/ |
| 마케팅 URL | https://hackon.kr/ |
| 개인정보 처리방침 | https://hackon.kr/privacy (`server.js` 의 `privacyPage()`, 라우트 `/privacy`) |
| 계정 삭제 안내 (Play) | https://hackon.kr/delete-account |
| 문의 메일 | hi@mandeun.com |
| 카테고리 | 1순위 **생산성(Productivity)** · 2순위 **비즈니스** (Play: 생산성) |

## 한국어 (기본)

| 항목 | 한도 | 문구 |
|---|---|---|
| 앱 이름 | 30 | `HACK:ON 해커톤` — 이름만으로는 무엇인지 안 읽혀서 «해커톤» 을 붙인다 |
| 부제 (iOS) | 30 | `해커톤을 이름 하나로 여는 운영 도구` |
| 프로모션 텍스트 (iOS) | 170 | `동아리·학교·동네에서 여는 작은 해커톤. 이름 하나로 대회를 만들고, 링크 하나로 모집하고, 당일엔 진행표·큰 화면·심사·결과까지 한 화면에서 굴립니다.` |
| 키워드 (iOS, 쉼표 뒤 공백 없음) | 100 | `해커톤,대회,공모전,데모데이,동아리,행사운영,참가신청,심사,투표,진행표,타이머,결과보고서,바이브코딩,AI,개발자` |
| 짧은 설명 (Play) | 80 | `이름 하나로 해커톤을 열고, 모집·진행표·심사·결과까지 한 곳에서 굴립니다.` |

### 설명 (iOS·Play 공통, 4000자 이하)

```
HACK:ON 은 작은 해커톤을 여는 사람을 위한 운영 도구입니다.
동아리 데모데이, 학교 대회, 동네 가게 문제 풀기 — 20명짜리 하루 대회를 혼자서도 열 수 있게 만들었습니다.

■ 이름 하나로 시작
대회 이름만 적으면 바로 열립니다. 로그인 없이 시작하고, 날짜·장소·정원·상금은 나중에 채웁니다.
유형(동아리·학교·회사·데모데이 등)을 고르면 인원·시간·진행표 기본값이 채워집니다.

■ 링크 하나로 모집
대회마다 공개 페이지가 생깁니다. 참가자는 이름과 이메일만 넣고 신청합니다.
카톡방에 링크 한 번이면 됩니다. 마감·정원·대기 명단은 앱이 알아서 셉니다.

■ 당일 운영
· 진행표 — 등록, 발표, 심사, 시상까지 시간표가 자동으로 짜이고, 늦어지면 미리 알려 줍니다
· 큰 화면 — 프로젝터에 띄우면 남은 시간, 지금 순서, 신청·투표 QR 이 저절로 바뀝니다
· 심사 — 심사위원은 링크 하나로 폰에서 점수를 줍니다. 심사위원끼리 점수 차이가 크면 알려 줍니다
· 관객 투표·참가자 상호평가 — 심사위원을 못 구했을 때 대신합니다
· 공지·질문 — 참가팀이 묻고 운영자가 답하면 공지에도 올라갑니다

■ 끝난 뒤
결과를 공개하면 각 팀이 자기 점수와 심사평을 봅니다.
결과 보고서·명단 내려받기·증서까지 한 번에 나갑니다.

■ 안전
공개 글(질문·제출작)은 누구나 신고하고 차단할 수 있고, 운영자가 내립니다.
연락처는 그 대회 운영자만 봅니다. 광고·추적·위치 수집을 하지 않습니다.
계정은 앱 안 «대회» 탭 → «계정 삭제» 에서 직접 지울 수 있습니다.

웹(hackon.kr)과 같은 계정, 같은 대회를 씁니다. 노트북으로 준비하고 당일엔 폰으로 굴리세요.
문의: hi@mandeun.com
```

### 새로운 기능 (1.0.0)

```
첫 출시입니다.
· 이름 하나로 대회 열기, 링크 하나로 참가 신청
· 진행표·큰 화면·심사·관객 투표·결과 보고서
· 질문·제출작 신고와 차단
· 앱 안에서 계정 삭제
```

## English

- **App name**: `HACK:ON Hackathon`
- **Subtitle (iOS, ≤30)**: `Run a hackathon from one name` (29)
- **Promotional text (iOS, ≤170)**:
  `Small hackathons for clubs, schools and neighborhoods. Start with just a name, recruit with one link, and run the day — schedule, big screen, judging, results.`
- **Keywords (iOS, ≤100)**:
  `hackathon,demo day,contest,club,event,judging,voting,timer,schedule,registration,results,coding,AI`
- **Short description (Play, ≤80)**:
  `Open a hackathon with just a name. Recruit, judge and share results in one app.` (79)

### Description (≤4000)

```
HACK:ON is an organizer tool for small, one-day hackathons — club demo days, school contests, neighborhood problem-solving events.

■ Start with just a name
Type the event name and it is live. No login needed to start; add date, place, capacity and prizes later.

■ Recruit with one link
Every event gets a public page. Participants apply with a name and an email. Capacity, deadline and waitlist are counted for you.

■ Run the day
· Schedule — check-in, pitches, judging and awards are laid out automatically, with a warning if you run late
· Big screen — put it on a projector: time left, who is up now, and QR codes for joining and voting
· Judging — judges score on their phones from one link; large gaps between judges are flagged
· Audience vote and peer review — when you could not find judges
· Notices and Q&A — teams ask, organizers answer, answers become notices

■ After the event
Publish results and each team sees its own scores and feedback. Download the report, the roster and certificates.

■ Safety
Anyone can report or block public posts (questions, submissions); organizers take them down.
Contact details are visible only to that event's organizers. No ads, no tracking, no location.
Delete your account in the app: «대회» (Events) tab → «계정 삭제» (Delete account).

The interface is in Korean. Same account and events as the web (hackon.kr).
Contact: hi@mandeun.com
```

### What's New (1.0.0)

```
First release.
· Open an event with just a name, recruit with one link
· Schedule, big screen, judging, audience vote, results report
· Report and block for questions and submissions
· In-app account deletion
```

## 연령 등급 답변

| 질문 | 답 | 근거 |
|---|---|---|
| 폭력·성적·공포·약물·도박·욕설 | 없음 | 운영 도구. 그런 콘텐츠를 만들지 않는다 |
| 사용자 생성 콘텐츠(UGC) | **있음** | 팀 이름·질문·제출작 링크·소식 제보. 신고(`/api/reports`)·차단·운영자 내리기(`questions.hidden`) 있음 |
| 사용자끼리 메시지·채팅 | 없음 | 1:1 대화 없음. 질문은 운영자에게 공개로 |
| 위치 공유 | 없음 | 위치 권한을 쓰지 않는다 |
| 앱 내 구매·광고 | 없음 | |
| 무제한 웹 접근 | 없음 | 제출작 링크는 밖의 브라우저로 연다(껍데기가 그렇게 해야 한다 — 확인 필요) |
| 콘테스트 | 있음(Apple «Contests» 항목이 있으면) | 해커톤 자체가 대회다. 앱이 상금을 주지 않는다 — 주최자가 준다 |

Play(IARC): «사용자 상호작용 있음(사용자가 만든 콘텐츠 공유)», 위치 공유 없음, 디지털 구매 없음.

## App Review 메모 (2.1 «Information Needed» 답변)

```
1. Purpose and audience
HACK:ON is a tool for organizing small, one-day hackathons in Korea (university clubs, schools, small businesses, ~20 people).
Organizers create an event, share a public link, participants apply with a name and email, and on the day the organizer runs the schedule, a projector screen, judging and results from the app.
Audience: event organizers, participants and judges. The interface is Korean.

2. How to review — no login needed
Creating an event needs only a name:
  a) Open the app → bottom tab «열기» (Create).
  b) Type any name (e.g. "Review test") under «1. 대회 이름» → tap «1단계 · 대회 만들기». The organizer screen opens immediately.
  c) In the organizer tabs, tap «주소» (Links) to see the public page link, the judge link and the big-screen (/tv) link.
  d) Open the public page (/e/<id>) to apply as a participant (any name + any email, check the consent box).
Login (Kakao, Google or Naver) is optional; it only lets one person open the same events on several devices.
Account deletion: «대회» tab → bottom «계정 삭제» → type 탈퇴 → delete. Also documented at https://hackon.kr/delete-account
Report/block: on a public event page, every question and submission has «신고» (report) and «차단» (block).

3. External services
· Hosting: Fly.io (server and SQLite database, Tokyo region)
· Optional login: Kakao, Google, Naver OAuth — we receive a per-app member number and nickname; email is used only as a one-way hash to recognize the same person
· Email: Resend — participation confirmations and result notices to participants
· GitHub public API — shows a participant's public repositories when they paste their own GitHub link
· Apple Push Notification service — event reminders for users who turn on «follow» (device token only)
No ads SDK, no analytics SDK, no in-app purchase.

4. Regional differences
None. The app behaves the same in every region; content is in Korean.

5. Contact
hi@mandeun.com
```

> 점검할 것: **지침 4.8(로그인 서비스)**. 카카오·구글·네이버 로그인을 제공하는데 Sign in with Apple 이 없다(`server.js` 의 `LOGINS` 에 kakao·google·naver 셋뿐). 로그인이 선택이어도 «주 계정 로그인» 으로 보면 4.8 에 걸릴 수 있다. 메모 2번에 «로그인 없이 모든 기능을 쓴다» 를 분명히 적었지만, 거절되면 Apple 로그인을 붙이는 것이 답이다.
> Fly.io 지역은 `fly.toml` 의 `primary_region = "nrt"`(도쿄)에서 읽었다.
> 푸시: 서버는 `APNS_KEY` 가 없으면 토큰을 저장만 하고 보내지 않는다. 출시 때 발송을 안 켜면 메모의 APNs 줄을 «planned» 로 바꾼다.

## Apple 개인정보 «영양 성분표»

추적(Tracking): **안 함**. 광고 SDK·분석 SDK·데이터 브로커 없음(`hack-on.html`·`home.html` 에 외부 분석 스크립트 없음).

| 데이터 유형 | 모으나 | 사용자와 연결 | 목적 | 어디서 (server.js) |
|---|---|---|---|---|
| 연락처 정보 › 이름 | 예 | 예 | 앱 기능 | `teams.name`·`mate_name`, `waitlist.name`, `pledges/offers.name·org`, `requests.name`, `owners.name`, `logins.nick` |
| 연락처 정보 › 이메일 | 예 | 예 | 앱 기능 | `teams.contact`·`mate_contact`, `waitlist.contact`, `pledges/offers/requests.contact`, `feedback.contact`(선택). 로그인 이메일은 원문 대신 HMAC(`logins.ehash`) |
| 사용자 콘텐츠 › 기타 | 예 | 예 | 앱 기능 | `questions.text`, `submissions.url·note·aiuse`, `news`(제보), `feedback.text`, `reports.note` |
| 식별자 › 사용자 ID | 예 | 예 | 앱 기능 | `logins.uid`(카카오·구글·네이버 회원번호), `owners.id`, `people.id`(연락처 해시) |
| 식별자 › 기기 ID | 예(푸시 켠 사람) | 아니오 | 앱 기능 | `push_tokens.token` — 대회 «따라가기» 용 APNs 토큰. 사람과 안 묶인다 |
| 사용 데이터 › 제품 상호작용 | 예 | 아니오 | 분석 | `visits` — 날짜·화면 경로·보낸 도메인·횟수만. IP·사람 없음 |
| 기타 › 평가 | 예 | 예 | 앱 기능 | `scores`·`votes`·`ratings`(참가자 상호평가, 준 사람은 안 보임) |
| 위치·연락처·사진·건강·금융·검색 기록·브라우징 기록·진단 | 아니오 | | | |

- IP 주소는 저장하지 않는다. 쓰기 상한(`tooMany`)을 위해 메모리에 10분만 두고 버린다(`clientIp`, `sweepTries`).
- 사진: 촬영 동의 여부(`teams.photo`, 0/1)만 받는다. 사진 파일은 안 받는다. 협찬사 로고(`sponsor_logos`)는 운영자가 올리는 회사 그림이라 개인정보가 아니다.

## Google Play 데이터 보안(Data safety)

| 질문 | 답 |
|---|---|
| 데이터를 수집하나 | 예 |
| 전송 중 암호화 | 예 (https 전용, Fly.io TLS) |
| 삭제 요청 수단 | 예 — 앱 안(«대회» → «계정 삭제») + https://hackon.kr/delete-account + hi@mandeun.com |
| 제3자 공유 | **예, 한 가지** — 참가자가 «협찬사 제공 동의»(`teams.share`/`sponsor_ok`)를 따로 켠 경우에만 그 대회 협찬사에 이메일이 간다. 처리 위탁(Resend·Fly.io)은 공유가 아니다 |

| 데이터 유형 | 수집 | 공유 | 필수/선택 | 목적 |
|---|---|---|---|---|
| 개인 정보 › 이름 | 예 | 아니오 | 필수(신청할 때) | 앱 기능, 계정 관리 |
| 개인 정보 › 이메일 주소 | 예 | 예(동의한 사람만, 협찬사) | 필수(신청할 때) | 앱 기능, 개발자 커뮤니케이션(결과 안내 메일) |
| 개인 정보 › 사용자 ID | 예 | 아니오 | 선택(로그인할 때) | 계정 관리 |
| 앱 활동 › 기타 사용자 생성 콘텐츠 | 예 | 아니오 | 선택 | 앱 기능 |
| 앱 활동 › 앱 상호작용 | 예 | 아니오 | 자동 | 분석 (`visits`, 사람과 안 묶임) |
| 기기 또는 기타 ID | 예(푸시 켠 사람) | 아니오 | 선택 | 앱 기능(알림) — 안드로이드 껍데기가 FCM 을 쓰면 여기에 해당 |
| 위치·금융·건강·메시지·사진·동영상·오디오·파일·캘린더·연락처 | 아니오 | | | |

보관: 참가 신청 정보는 대회 종료 후 6개월, 로그인 정보는 계정 삭제까지(`/privacy` 3절과 같다).
