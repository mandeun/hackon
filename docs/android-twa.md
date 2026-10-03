# 안드로이드 앱(TWA) — 만들기·올리기·심사 답

HACK:ON 안드로이드 앱은 **웹을 그대로 띄우는 껍데기(TWA, Trusted Web Activity)** 다.
화면·기능은 전부 hackon.kr 에서 오고, 앱은 크롬 엔진으로 그 주소를 연다. 그래서 웹을 고치면 앱도 같이 바뀐다
(스토어 업데이트가 필요한 것은 아이콘·이름·권한을 바꿀 때뿐이다).

> 배포·업로드·비밀값 넣기는 **사람이 한다.** 에이전트는 여기까지 준비한다(CLAUDE.md «하지 않는 것»).

## 0. 이미 준비된 것 (이 저장소)

| 무엇 | 어디 | 확인 |
|---|---|---|
| 매니페스트 — `id`·`scope`·설명·`orientation`·바로가기 셋 | `manifest.webmanifest` | e2e «PWA·안드로이드» |
| PNG 아이콘 — 192·512(일반), 512 maskable(꽉 찬 먹 바탕) | `icon-192.png` 등. `python3 store/icons.py` 가 `icon.svg` 에서 만든다 | 실제 픽셀 크기·모서리까지 e2e 가 본다 |
| 플레이 스토어 아이콘 512×512 32비트 PNG | `store/out/play-icon-512.png` (같은 스크립트, git 에는 안 올라감) | |
| 끊겼을 때 화면 | `offline.html` + `sw.js`(v3) | 서버를 꺼서 진짜로 끊고 e2e 가 본다 |
| 알림 — 안드로이드는 `new Notification` 을 막아서 서비스워커로 띄운다 | `hack-on.html` `pollNews` | e2e |
| 계정 삭제 안내 주소 | https://hackon.kr/delete-account | |
| 개인정보 처리방침 | https://hackon.kr/privacy | |
| `/.well-known/assetlinks.json` | 다른 팀원이 만든 서버 경로. **환경변수 `TWA_PACKAGE`·`TWA_SHA256` 을 읽는다** | 아래 3절 |

## 1. Bubblewrap 으로 프로젝트 만들기

```bash
npm i -g @bubblewrap/cli          # 처음 한 번. 첫 실행 때 JDK·안드로이드 SDK 를 받을지 묻는다 → 예
bubblewrap doctor                 # 받을 것이 다 있는지
mkdir hackon-android && cd hackon-android
bubblewrap init --manifest https://hackon.kr/manifest.webmanifest
```

`init` 이 묻는 것 — 매니페스트에서 읽어 와서 대부분 Enter 만 누르면 된다.

| 질문 | 답 |
|---|---|
| Domain / URL path | `hackon.kr` / `/app` |
| Application name / Short name | `HACK:ON — 누구나 여는 해커톤` / `HACK:ON` |
| **Application ID (패키지 이름)** | **`kr.hackon.app`** — 한 번 올리면 못 바꾼다 |
| Display mode / Orientation | `standalone` / `portrait` |
| Status bar·Splash 색 | `#0B1020` / `#FFFFFF` |
| Icon URL | `https://hackon.kr/icon-512.png` |
| Maskable icon URL | `https://hackon.kr/icon-maskable-512.png` |
| Monochrome icon | 비워 둔다(안드로이드 13 테마 아이콘 — 나중에) |
| Play Billing / Geolocation | 아니오 / 아니오 |
| Key store | 새로 만든다(`android.keystore`, 별칭 `android`). **이 파일과 비밀번호는 저장소에 넣지 않는다** — 잃어버리면 업로드 키 재설정을 Play 에 따로 신청해야 한다 |

그다음 `twa-manifest.json` 을 열어 두 곳을 고친다.

```jsonc
"enableNotifications": true,      // 알림을 앱 이름으로 띄운다(알림 위임)
"shortcuts": [ ... ]              // 매니페스트 바로가기 셋이 들어와 있는지만 본다
```

```bash
bubblewrap update                 # twa-manifest.json 을 안드로이드 프로젝트에 다시 반영
bubblewrap build                  # → app-release-bundle.aab (플레이에 올릴 것), app-release-signed.apk (폰에 직접 깔아 볼 것)
```

빌드한 뒤 꼭 볼 것:

- **`app/build.gradle` 의 `targetSdkVersion`** 이 지금 플레이가 요구하는 값 이상인지.
  2025-08-31 부터 새 앱·업데이트는 API 35(안드로이드 15) 이상이었고, 해마다 8월 말에 한 단계 오른다 —
  **올리기 직전에 Play Console 의 «대상 API 수준» 안내(또는 developer.android.com/google/play/requirements/target-sdk)에서 확인**하고,
  모자라면 `compileSdkVersion` 과 같이 올린다. 템플릿이 낡았으면 `npm i -g @bubblewrap/cli@latest` 후 `bubblewrap update`.
- **`app/src/main/AndroidManifest.xml` 에 `android.permission.POST_NOTIFICATIONS`** 가 있는지.
  안드로이드 13 이상은 이 권한을 실행 중에 물어야 알림이 뜬다. `enableNotifications` 를 켜면 들어가는데, 없으면 한 줄 넣는다:
  `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`.
  묻는 때는 사용자가 화면의 «알림 켜기» 를 눌렀을 때뿐이다(앱을 열자마자 묻지 않는다 — 플레이 품질 기준).
- `orientation: portrait` 은 폰에만 걸린다. 안드로이드 16(API 36) 을 대상으로 하면 태블릿·접는 폰(폭 600dp 이상)에서는 시스템이 무시하고 가로도 돈다 — 큰 화면 품질 기준과 맞는다.

## 2. 폰에서 먼저 돌려 보기

```bash
adb install app-release-signed.apk
```

- 위에 **주소창이 보이면** 아래 3절(주소 확인)이 아직 안 된 것이다. 기능은 되지만 «웹을 감싼 앱» 으로 보여 심사·사용자 모두 싫어한다.
- 비행기 모드로 아직 안 연 화면(예: 게시판)을 눌러 «인터넷이 끊겼어요» 가 나오는지 본다(공룡 화면이면 sw.js 가 안 붙은 것).
- 런처를 길게 눌러 바로가기 셋(오늘·대회 열기·나)이 보이는지 본다.

## 3. 주소 확인(Digital Asset Links) — 주소창 없애기

앱과 hackon.kr 이 같은 주인이라는 증명이다. 서버가 `/.well-known/assetlinks.json` 을 두 환경변수로 만든다.

1. **앱 서명 키 지문** — Play Console → 앱 → **테스트 및 출시 → 설정 → 앱 무결성 → 앱 서명** 탭 →
   «앱 서명 키 인증서» 의 **SHA-256 인증서 지문**(`AB:CD:…` 32쌍). 플레이 앱 서명을 쓰면 사용자 폰의 앱은 이 키로 서명된다.
   (업로드에 쓴 `android.keystore` 의 지문과 **다르다.** 업로드 키 지문은 `keytool -list -v -keystore android.keystore -alias android` 의 `SHA256:` 줄.)
2. fly 비밀값으로 넣는다 — 코드에 적지 않는다.
   ```bash
   fly secrets set TWA_PACKAGE=kr.hackon.app TWA_SHA256="AB:CD:…:EF"
   ```
   비밀값을 넣으면 fly 가 기계를 다시 켠다(사람이 한다). 직접 깐 시험 빌드(업로드 키 서명)에서도 주소창을 없애려면
   업로드 키 지문도 같이 넣어야 한다 — 서버 경로가 여러 지문(쉼표)을 받는지 그 코드에서 먼저 확인한다.
3. 확인:
   ```bash
   curl -s https://hackon.kr/.well-known/assetlinks.json      # 200, application/json, 리다이렉트 없음, 패키지·지문이 맞는지
   curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://hackon.kr&relation=delegate_permission/common.handle_all_urls"
   ```
   둘째 줄 결과에 `kr.hackon.app` 과 그 지문이 나오면 된다. 폰의 앱을 지웠다 다시 깔면 주소창이 사라진다.

## 4. Play Console 에 적을 답

### 데이터 보안(Data safety)

`store/listing.md` 의 «Google Play 데이터 보안» 표를 그대로 쓴다. 안드로이드 앱에서 달라지는 것만:

| 항목 | 답 | 이유 |
|---|---|---|
| 기기 또는 기타 ID | **아니오** | 안드로이드 앱은 FCM·웹 푸시를 안 쓴다. 알림은 화면이 열려 있을 때 화면이 직접 띄운다. 기기 토큰(`push_tokens`)은 아이폰 앱(APNs)만 쓴다 |
| 앱 활동 › 기타 사용자 생성 콘텐츠 | 예 · 선택 · 앱 기능 | 질문·제출작 링크·게시판 글·댓글(별명 포함)·공동 집필 제안 |
| 앱 활동 › 앱 상호작용 | 예 · 자동 · 분석 | `visits` — 날짜·화면 경로·횟수만. 사람과 안 묶인다 |
| 위치·연락처(주소록)·사진·파일·캘린더·금융·건강 | 아니오 | 그런 권한을 안 쓴다. «달력에 넣기» 는 사용자가 .ics 파일을 받는 것이라 캘린더 접근이 아니다 |
| 이 기기에만 두는 것 | 수집 아님 | AI 지갑·브리핑·최근 간 곳·나(배지)는 그 기기의 저장소에만 있고 서버로 안 온다 |
| 전송 중 암호화 / 삭제 요청 | 예 / 예 | https 만. 앱 안 «대회 → 계정 삭제» + https://hackon.kr/delete-account |

IP 는 쓰기 상한(`tooMany`) 때문에 메모리에 10분만 두고 버린다 — 저장하지 않으므로 «수집» 이 아니다(Play 의 «일시적 처리»).
웹에서 새로 모으는 것이 생기면(새 표·새 칸) 이 표와 `/privacy` 를 같이 고친다.

### 앱 액세스(App access)

**«모든 기능을 특별한 액세스 권한 없이 이용할 수 있음»** 을 고른다. 로그인 없이 다 된다 —
심사자가 «열기» 탭에서 아무 이름으로 대회를 만들면 운영자 화면이 바로 열리고, «주소» 에서 공개·심사·큰 화면 주소가 다 나온다.
로그인(카카오·구글·네이버)은 여러 기기에서 같은 대회를 여는 선택일 뿐이다. 더 묻는 메일이 오면 `store/listing.md` 의
«App Review 메모» 2절(영문)을 그대로 보낸다.

### 콘텐츠 등급(IARC 설문)

`store/listing.md` 의 «콘텐츠 등급» 표대로 답한다. 핵심: 폭력·성·도박·약물 없음, **사용자끼리 콘텐츠를 주고받음 — 예**
(게시판·질문·제출작. 신고·차단·운영자 내리기 있음), 위치 공유 없음, 디지털 구매 없음. 나온 등급을 그대로 쓴다.

### 타깃 연령층

**13세 이상**(13–15, 16–17, 18+)만 고른다. 어린이를 위한 앱이 아니다 — «어린이에게 어필할 수 있나» 도 **아니오**.
13세 미만을 고르면 가족 정책(광고·데이터 제한·교사 승인 등) 대상이 된다.

### 그 밖에

- 개인정보 처리방침: https://hackon.kr/privacy · 계정 삭제: https://hackon.kr/delete-account
- 카테고리: 생산성 · 연락처 hi@mandeun.com
- 그림: 아이콘 `store/out/play-icon-512.png`, 대표 그림 1024×500·폰 스크린샷은 `python3 store/shots.py`

## 5. 출시 순서 — 비공개 테스트 12명 × 14일

2023-11-13 이후 만든 **개인** 개발자 계정은 바로 프로덕션에 못 올린다.
**비공개 테스트에 테스터 12명 이상이 참여(옵트인)한 채로 14일을 연속으로** 채운 뒤에야 «프로덕션 액세스 신청» 이 열린다.
(조직 계정이면 이 조건이 없다.)

1. 비공개 테스트 트랙 만들기 → 테스터 이메일 목록(구글 그룹이 편하다)에 15명쯤 넣는다 — 중간에 빠지는 사람이 생긴다.
2. `.aab` 올리기 → 테스터에게 참여 링크 보내기 → **각자 링크에서 «테스터 되기» 를 누르고 앱을 깔아야** 1명으로 센다.
3. 14일 동안 12명 이상이 계속 참여 중이어야 한다(중간에 나가면 날짜가 다시 센다고 보고 넉넉히 둔다). 이 동안 받은 의견과 고친 점을 적어 둔다 — 신청서에 묻는다.
4. 프로덕션 액세스 신청 → 승인 → 프로덕션 출시.

다음 판을 올릴 때는 `twa-manifest.json` 의 `appVersionCode` 를 1 올리고(`bubblewrap update` 가 물어본다) 다시 `bubblewrap build`.
