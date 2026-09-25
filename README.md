# HACK:ON

HACK:ON 은 해커톤을 처음 여는 사람을 위한 웹앱입니다. 대회를 만들고, 참가 신청을 받고,
제출과 심사를 굴리고, 행사가 끝난 뒤 두 주 동안 팀이 어떻게 됐는지까지 한 곳에서 다룹니다.
회원가입과 로그인이 없습니다. 대회를 만들면 열쇠가 하나 나오고, 그 열쇠를 가진 사람이 운영자입니다.
참가자와 심사위원은 링크만 받으면 들어옵니다.

## 3분 안에 돌려 보기

Node 24 가 필요합니다. DB 는 `node:sqlite`, 서버는 `node:http` 를 쓰기 때문에 설치할 패키지가 없습니다.

```bash
git clone https://github.com/mandeun/hackon.git
cd hackon
node server.js
```

브라우저에서 `http://localhost:8788` 을 엽니다. 첫 화면에서 대회를 만들면 이름 하나로 시작합니다.
날짜·상금·마감은 만든 다음에 채웁니다.

서버 없이 화면만 보려면 `hack-on.html` 을 더블클릭합니다. 예시 데이터로 그려집니다.

## 화면 셋

| 화면 | 주소 | 사진을 넣을 자리 |
|---|---|---|
| 첫 화면. 소개와 열린 대회 목록 | `/` | `docs/home.png` |
| 운영 화면. 대회를 열고 굴리는 곳 | `/app` | `docs/app.png` |
| 공개 페이지. 링크만 알면 열립니다 | `/e/<대회id>` | `docs/public.png` |

세 번째 칸의 파일은 아직 저장소에 없습니다. 넣을 자리만 잡아 둔 것입니다.
개발하면서 찍어 둔 원본 캡처는 `shots/` 폴더에 있습니다.

## 구조

- **서버는 파일 하나입니다.** `server.js` 안에 HTTP·SQLite·API·자체 점검이 모여 있습니다.
- **화면도 파일 하나입니다.** `/app` `/e` `/j` `/v` `/tv` `/p` `/give` `/ask` `/r` `/s` 가 모두
  `hack-on.html` 을 받고, 화면이 주소를 읽어 갈라집니다. 첫 화면 `/` 만 `home.html` 을 씁니다.
- **DB 는 SQLite 파일 하나입니다.** 기본 위치는 `data/hackon.db` 이고 `DB` 환경변수로 바꿉니다.
  서버가 10분마다 `data/backup/` 에 사본을 뜹니다.
- **로그인이 없습니다.** 권한은 열쇠로 나눕니다. 운영·주최자·심사·투표·팀·받는 사람·후원 열쇠가
  있고 각각 여는 범위가 다릅니다. 표와 주소와 열쇠는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 에 적었습니다.
- **의존성이 없습니다.** `package.json` 에 `dependencies` 칸이 없습니다.

## 검사 돌리기

```bash
node server.js --test     # 함수 단위 점검. 통과하면 가짓수를 세어 줍니다
python3 check-e2e.py      # 브라우저로 개설부터 성과까지 한 번에
```

`check-e2e.py` 는 playwright 를 씁니다. 설치 없이 돌리려면
`uv run --with playwright --with axe-playwright-python python check-e2e.py` 를 쓰면 됩니다.

e2e 는 **저장소 사본에서 돌립니다.** 검사가 띄우는 서버는 임시 DB 를 쓰지만 소스 파일은 작업 폴더에서
읽기 때문에, 검사가 도는 동안 코드를 고치면 무엇을 검사한 것인지 알 수 없게 됩니다.

## 배포

fly.io 에 올립니다.

```bash
fly deploy --remote-only
```

`fly.toml` 에 적힌 것은 리전 `nrt`, 볼륨 `/data`, 자동 종료 켬, 항상 켜 둘 기계 0대입니다.
평소에는 꺼져 있다가 첫 접속에 몇 초 걸려 깨어납니다. 행사 당일에는 `min_machines_running` 을 1 로 올립니다.
DB 와 백업이 볼륨에 있어서 기계가 꺼졌다 켜져도 대회가 남습니다.

## 더 읽을 것

| 문서 | 무엇 |
|---|---|
| [GUIDE.md](GUIDE.md) | 해커톤 운영 매뉴얼. 준비표부터 끝나고 2주까지. 배포판에서는 `/manual` 에서 읽습니다 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 표·주소·열쇠·공개 규칙 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 이 저장소에서 코드를 고칠 때 지키는 것 |
| [SECURITY.md](SECURITY.md) | 취약점 신고, 열쇠 모델, 개인정보 |
| [PLAN.md](PLAN.md) | 무엇을 왜 만들었고 다음에 무엇을 할 것인가 |

개인정보 처리방침은 배포판의 `/privacy` 에 있습니다.
매뉴얼은 한 벌만 둡니다. `/manual` 은 `GUIDE.md` 를 읽어 화면으로 만듭니다.

## 라이선스

MIT 입니다. `package.json` 의 `license` 칸에 적혀 있습니다. 전문을 담은 `LICENSE` 파일은 아직 저장소에 없습니다.

---

## English summary

HACK:ON is a web app for people running a hackathon for the first time. It covers creating an
event, taking sign-ups, collecting submissions, judging, and following up with teams for two
weeks after the event. There are no accounts and no login: creating an event hands you a key,
and whoever holds that key is the organiser. Participants and judges only need a link.

**Run it.** Node 24 is required. There are no packages to install, because the database
(`node:sqlite`) and the HTTP server (`node:http`) both ship with Node.

```bash
git clone https://github.com/mandeun/hackon.git
cd hackon
node server.js          # then open http://localhost:8788
```

**Shape.** One server file (`server.js`), one screen file (`hack-on.html`) that branches on the
URL, one landing page (`home.html`), and one SQLite file. Roles are separated by keys rather than
by user accounts. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for tables, routes and keys.

**Checks.** `node server.js --test` runs the in-process checks and prints how many passed.
`python3 check-e2e.py` drives a browser through the whole flow. Run the e2e checks from a copy of
the repository: the harness starts its own server from the working files, so editing code while it
runs leaves you unsure what was checked.

**Deploy.** `fly deploy --remote-only`. The machine sleeps when idle and keeps its database on a
volume at `/data`.

**Docs.** [GUIDE.md](GUIDE.md) is the operations manual, also served at `/manual`.
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) cover contributions and
vulnerability reports. Licensed under MIT.
