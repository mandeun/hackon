/**
 * HACK:ON 서버 — 대회 개설 · 참가 · 제출 · 심사 · 협찬 성과
 *
 * 라켓온(racket-on)에서 그대로 가져온 것:
 *   · reuse:db-open   sqlite 열기(WAL+FK)
 *   · reuse:http-kit  HttpError · MIME · body() · json()
 *   · reuse:router    URL 파싱 → /api/* → 정적 폴백 → catch 에서 json 에러
 *   · reuse:static    경로 탈출 방지 + MIME + 스트림
 * 바꾼 것: 가운데 if 블록(도메인)과 표 구조뿐이다.
 *
 * 의존성 0. DB·HTTP 모두 Node 내장(node:sqlite, node:http).
 *
 * 실행:  node server.js        →  http://localhost:8788
 * 점검:  node server.js --test
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = process.env.PORT || 8788;
const DBFILE = process.env.DB || path.join(ROOT, 'data', 'hackon.db');

/* ───────────────────────── DB ───────────────────────── */
/* #region reuse:db-open — sqlite 열기(WAL+FK). 파일 경로만 바꾸면 어느 프로젝트든 그대로 쓴다 */
function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS events(
      id       TEXT PRIMARY KEY,          -- 공유 링크에 쓰는 짧은 키
      title    TEXT NOT NULL,
      host     TEXT NOT NULL,             -- 여는 사람(개인이어도 된다)
      topic    TEXT NOT NULL DEFAULT '',
      starts   TEXT NOT NULL,             -- YYYY-MM-DD
      ends     TEXT NOT NULL,
      prize    INTEGER NOT NULL DEFAULT 0,
      cap      INTEGER NOT NULL DEFAULT 0,   -- 0 = 제한 없음
      due      TEXT NOT NULL DEFAULT '',      -- 제출 마감 'YYYY-MM-DDTHH:MM'. 비면 안 막는다
      opened   INTEGER NOT NULL DEFAULT 0,   -- 결과 공개. 켜면 팀이 자기 점수와 심사평을 본다
      okey     TEXT NOT NULL DEFAULT '',      -- 운영자 열쇠. 이걸 아는 사람만 운영 화면을 연다
      plan     TEXT NOT NULL DEFAULT '[]',    -- 진행 순서 [{at,what}]. 일정은 여기 한 곳에만 둔다
      rubric   TEXT NOT NULL DEFAULT '[]',   -- [{key,label,weight}]
      created  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      role   TEXT NOT NULL DEFAULT '',    -- 만들기 | 기획 | 디자인. 팀을 짜 줄 때 쓴다
      solo   INTEGER NOT NULL DEFAULT 0,  -- 혼자 왔나. 시작할 때 팀 짜기의 근거
      found  TEXT NOT NULL DEFAULT '',    -- 어디서 봤나. 2회차 홍보비를 여기다 쓴다
      note   TEXT NOT NULL DEFAULT '',
      agreed TEXT NOT NULL DEFAULT '',    -- 개인정보 수집·이용에 동의한 시각. 이게 증거다
      photo  INTEGER NOT NULL DEFAULT 0,  -- 촬영·사진 공개 동의 (선택)
      came   TEXT NOT NULL DEFAULT '',    -- 당일 체크인한 시각
      size   INTEGER NOT NULL DEFAULT 1,  -- 지금 몇 명인가
      want   TEXT NOT NULL DEFAULT '',    -- 어떤 사람을 찾나. 비면 안 찾는 것
      joined TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event, name)
    );

    CREATE TABLE IF NOT EXISTS submissions(
      id     INTEGER PRIMARY KEY,
      team   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      url    TEXT NOT NULL DEFAULT '',
      note   TEXT NOT NULL DEFAULT '',
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team)
    );

    CREATE TABLE IF NOT EXISTS scores(
      id     INTEGER PRIMARY KEY,
      team   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      judge  TEXT NOT NULL,
      key    TEXT NOT NULL,
      value  REAL NOT NULL,
      UNIQUE(team, judge, key)
    );

    /* 심사평. 점수만 주고 이유를 안 주면 참가자는 아무것도 못 배운다.
       국내외 해커톤 불만 1순위가 "왜 떨어졌는지 모른다" 였다. */
    CREATE TABLE IF NOT EXISTS reviews(
      id     INTEGER PRIMARY KEY,
      team   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      judge  TEXT NOT NULL,
      good   TEXT NOT NULL DEFAULT '',   -- 좋았던 점
      next   TEXT NOT NULL DEFAULT '',   -- 더 하면 좋을 것
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team, judge)
    );

    CREATE TABLE IF NOT EXISTS sponsors(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      kind   TEXT NOT NULL DEFAULT '현금',   -- 현금 | 크레딧 | 상품 | 멘토
      amount INTEGER NOT NULL DEFAULT 0,
      note   TEXT NOT NULL DEFAULT ''
    );

    /* 대회가 끝난 뒤 팀을 봐 주기로 한 사람들. 행사 '전에' 채워 둔다 —
       끝나고 정하면 아무도 안 한다 (매뉴얼 11장). */
    CREATE TABLE IF NOT EXISTS supporters(
      id      INTEGER PRIMARY KEY,
      event   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      org     TEXT NOT NULL DEFAULT '',   -- 소속. 협찬사에서 온 사람이면 그 회사
      can     TEXT NOT NULL DEFAULT '',   -- 무엇을 도와줄 수 있나
      contact TEXT NOT NULL DEFAULT '',
      UNIQUE(event, name)
    );

    /* 어느 팀을 · 누가 · 언제까지. 기한이 없으면 약속이 아니라 인사말이다. */
    CREATE TABLE IF NOT EXISTS assignments(
      id      INTEGER PRIMARY KEY,
      team    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      helper  INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      due     TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD
      done    TEXT NOT NULL DEFAULT '',   -- 한 날. 비면 아직
      note    TEXT NOT NULL DEFAULT '',
      UNIQUE(team, helper)
    );

    /* 협찬사에게 노출당 비용 대신 돌려주는 숫자. 이 표가 이 서비스의 차별점이다. */
    CREATE TABLE IF NOT EXISTS outcomes(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team   INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      kind   TEXT NOT NULL,               -- 면접 | 도입검토 | 채용 | 후속미팅
      who    TEXT NOT NULL DEFAULT '',    -- 어느 회사가
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      note   TEXT NOT NULL DEFAULT ''
    );
  `);
  /* 이미 쓰던 DB 에도 칸을 붙인다. 있으면 에러가 나는데 그건 그냥 넘긴다. */
  try { db.exec("ALTER TABLE events ADD COLUMN due TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE events ADD COLUMN opened INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN okey TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN plan TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN photo INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN size INTEGER NOT NULL DEFAULT 1'); } catch {}
  for (const c of ['role', 'found', 'note', 'agreed', 'came', 'want'])
    try { db.exec(`ALTER TABLE teams ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN solo INTEGER NOT NULL DEFAULT 0'); } catch {}
  return db;
}
/* #endregion reuse:db-open */

const nid = () => crypto.randomBytes(4).toString('hex');

/** 이 컴퓨터의 랜 주소. 참가자 폰은 localhost 로 못 온다.
    유선과 무선이 다를 수 있어서 찾은 것을 다 준다. */
function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {}))
    for (const n of list || [])
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  // 192.168 · 10. 대역을 앞에 둔다. 가상 어댑터 주소가 먼저 잡히는 일이 많다.
  return out.sort((a, b) => (b.startsWith('192.168') || b.startsWith('10.') ? 1 : 0)
                          - (a.startsWith('192.168') || a.startsWith('10.') ? 1 : 0));
}

/* ───────────────────── 도메인 ───────────────────── */

/* 하루 해커톤 기본 진행표. 매뉴얼 6장을 하루로 줄인 것이다.
   운영자가 고치되, 아무것도 안 고쳐도 현장 화면이 돌아가게 기본값을 깐다. */
const DEFAULT_PLAN = [
  { at: '10:00', what: '등록 · 아이스브레이킹' },
  { at: '10:30', what: '주제 안내 · 아이디어 발표' },
  { at: '11:30', what: '팀 짜기' },
  { at: '12:00', what: '점심' },
  { at: '13:00', what: '만들기' },
  { at: '15:00', what: '멘토 오피스아워' },
  { at: '17:00', what: '제출 마감' },
  { at: '17:30', what: '발표' },
  { at: '19:30', what: '시상' },
];

const DEFAULT_RUBRIC = [
  { key: 'idea', label: '독창성', weight: 30 },
  { key: 'make', label: '완성도', weight: 30 },
  { key: 'use', label: '실용성', weight: 25 },
  { key: 'tell', label: '전달력', weight: 15 },
];

/** 대회를 만든 뒤 나머지를 채운다. 처음부터 다 물으면 만들다가 그만둔다. */
const EDITABLE = ['title', 'host', 'topic', 'starts', 'ends', 'prize', 'cap', 'due'];
function editEvent(db, id, b) {
  const set = [], val = [];
  for (const k of EDITABLE) {
    if (b[k] === undefined) continue;
    set.push(`${k}=?`);
    val.push(k === 'prize' || k === 'cap' ? (+b[k] || 0) : String(b[k]));
  }
  if (Array.isArray(b.plan)) {
    set.push('plan=?');
    /* 시각과 할 일만 남긴다. 화면이 그리는 것이라 다른 게 섞이면 안 된다. */
    val.push(JSON.stringify(b.plan
      .filter(r => r && r.at)
      .map(r => ({ at: String(r.at).slice(0, 5), what: String(r.what || '').slice(0, 60) }))));
  }
  if (!set.length) return;
  db.prepare(`UPDATE events SET ${set.join(',')} WHERE id=?`).run(...val, id);
}

/** 참가팀이 나중에 채우는 칸. 비어 있는 것만 채운다 —
    남의 팀 id 를 아는 사람이 이미 적은 것을 덮어쓰면 안 된다. */
function moreTeam(db, id, b) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(id);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  const set = [], val = [];
  for (const k of ['contact', 'role', 'found', 'note', 'want']) {
    if (b[k] === undefined || !String(b[k]).trim()) continue;
    if (t[k]) continue;                       // 이미 적힌 것은 안 건드린다
    set.push(`${k}=?`); val.push(String(b[k]).slice(0, 300));
  }
  if (b.solo !== undefined && !t.solo) { set.push('solo=?'); val.push(b.solo ? 1 : 0); }
  if (b.photo !== undefined && !t.photo) { set.push('photo=?'); val.push(b.photo ? 1 : 0); }
  /* 인원은 바뀌는 값이라 덮어쓰기를 허용한다. 한 명 들어오면 고쳐야 한다. */
  if (b.size !== undefined) { set.push('size=?'); val.push(Math.min(Math.max(+b.size || 1, 1), 9)); }
  if (!set.length) return { filled: 0 };
  db.prepare(`UPDATE teams SET ${set.join(',')} WHERE id=?`).run(...val, id);
  return { filled: set.length };
}

function createEvent(db, b) {
  if (!b.title) throw new HttpError(400, '대회 이름이 필요합니다');
  const id = b.id || nid();
  const okey = crypto.randomBytes(5).toString('hex');   // 운영자 열쇠. 만든 사람만 받는다
  const rubric = Array.isArray(b.rubric) && b.rubric.length ? b.rubric : DEFAULT_RUBRIC;
  const sum = rubric.reduce((a, r) => a + Number(r.weight || 0), 0);
  if (sum !== 100) throw new HttpError(400, `심사 배점 합이 ${sum} 입니다. 100 이어야 합니다`);
  db.prepare(`INSERT INTO events(id,title,host,topic,starts,ends,prize,cap,rubric,due)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title, b.host || '주최자', b.topic || '',
         b.starts || today(), b.ends || b.starts || today(),
         +b.prize || 0, +b.cap || 0, JSON.stringify(rubric), b.due || '');
  db.prepare('UPDATE events SET okey=?, plan=? WHERE id=?')
    .run(okey, JSON.stringify(Array.isArray(b.plan) && b.plan.length ? b.plan : DEFAULT_PLAN), id);
  return { id, okey };
}

/** 운영자인가. 열쇠는 헤더나 쿼리로 온다. 없으면 손님이다.
    로그인은 안 만든다 — 하루짜리 행사에 계정 관리를 붙이는 건 과하다. */
function isAdmin(db, event, key) {
  const e = db.prepare('SELECT okey FROM events WHERE id=?').get(event);
  if (!e) return false;
  if (!e.okey) return true;          // 열쇠가 생기기 전에 만든 대회는 그대로 열어 둔다
  return !!key && key === e.okey;
}
const needAdmin = (db, event, key) => {
  if (!isAdmin(db, event, key)) throw new HttpError(403, '운영자 열쇠가 필요합니다');
};

function getEvent(db, id) {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(id);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  delete e.okey;                     // 열쇠는 절대 안 내려보낸다
  e.rubric = JSON.parse(e.rubric);
  try { e.plan = JSON.parse(e.plan || '[]'); } catch { e.plan = []; }
  e.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(id).c;
  e.sponsors = db.prepare('SELECT * FROM sponsors WHERE event=? ORDER BY amount DESC').all(id);
  return e;
}

function joinTeam(db, event, b) {
  const e = getEvent(db, event);
  if (!b.name) throw new HttpError(400, '팀 이름이 필요합니다');
  /* 동의 없이 연락처를 받지 않는다. 화면에서 체크박스를 지워도 여기서 막힌다. */
  if (!b.agree) throw new HttpError(400, '개인정보 수집·이용에 동의해 주세요');
  if (e.cap && e.teams >= e.cap) throw new HttpError(409, '정원이 찼습니다');
  try {
    const r = db.prepare(`INSERT INTO teams(event,name,contact,role,solo,found,note,agreed,photo)
                          VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(event, b.name, b.contact || '', b.role || '', b.solo ? 1 : 0,
           b.found || '', b.note || '', new Date().toISOString(), b.photo ? 1 : 0);
    return Number(r.lastInsertRowid);
  } catch {
    throw new HttpError(409, '같은 이름의 팀이 있습니다');
  }
}

/** 마감이 지났나. 마감이 비어 있으면 안 막는다. */
function pastDue(db, team) {
  const r = db.prepare(`SELECT e.due FROM teams t JOIN events e ON e.id = t.event
                        WHERE t.id = ?`).get(team);
  if (!r) throw new HttpError(404, '없는 팀입니다');
  if (!r.due) return false;
  // 마감은 그 자리 시각으로 적는다. 서버와 참가자가 같은 방에 있으니 시간대를 따지지 않는다.
  return new Date() > new Date(r.due);
}

function submit(db, team, b) {
  if (pastDue(db, team)) throw new HttpError(409, '제출 마감이 지났습니다');
  db.prepare(`INSERT INTO submissions(team,url,note) VALUES(?,?,?)
              ON CONFLICT(team) DO UPDATE SET url=excluded.url, note=excluded.note, at=datetime('now')`)
    .run(team, b.url || '', b.note || '');
}

/** 한 팀이 받은 성적표. 점수 분해와 심사평을 같이 준다.
    운영자가 결과를 공개하기 전에는 그 팀도 못 본다. */
function card(db, team) {
  const t = db.prepare(`SELECT t.id, t.name, t.event, e.opened, e.rubric, e.title
                        FROM teams t JOIN events e ON e.id = t.event WHERE t.id = ?`).get(team);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  if (!t.opened) return { opened: false, name: t.name, title: t.title };
  const rubric = JSON.parse(t.rubric);
  const by = {};
  for (const r of db.prepare('SELECT judge, key, value FROM scores WHERE team=?').all(team)) {
    (by[r.judge] = by[r.judge] || {})[r.key] = r.value;
  }
  /* 항목별 평균과 그 항목의 만점. 어디서 깎였는지 한눈에 보이게 한다. */
  const items = rubric.map(r => {
    const vals = Object.values(by).map(v => v[r.key]).filter(v => v !== undefined);
    const avg = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : 0;
    return { key: r.key, label: r.label, weight: r.weight,
             avg: Math.round(avg * 10) / 10, got: Math.round(avg * r.weight) / 100 };
  });
  return {
    opened: true, name: t.name, title: t.title, items,
    total: Math.round(items.reduce((a, c) => a + c.got, 0) * 10) / 10,
    judges: Object.keys(by).length,
    /* 누가 뭐라고 했는지는 이름 없이 준다. 이름을 붙이면 심사위원이 솔직하게 못 쓴다. */
    reviews: db.prepare('SELECT good, next FROM reviews WHERE team=? ORDER BY id').all(team),
  };
}

function score(db, team, b) {
  if (!b.judge) throw new HttpError(400, '심사위원 이름이 필요합니다');
  const t = db.prepare('SELECT event FROM teams WHERE id=?').get(team);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  const rubric = JSON.parse(db.prepare('SELECT rubric FROM events WHERE id=?').get(t.event).rubric);
  const keys = new Set(rubric.map(r => r.key));
  for (const [k, v] of Object.entries(b.values || {})) {
    if (!keys.has(k)) throw new HttpError(400, `심사 항목이 아닙니다: ${k}`);
    if (!(v >= 0 && v <= 100)) throw new HttpError(400, '점수는 0~100 입니다');
    db.prepare(`INSERT INTO scores(team,judge,key,value) VALUES(?,?,?,?)
                ON CONFLICT(team,judge,key) DO UPDATE SET value=excluded.value`)
      .run(team, b.judge, k, v);
  }
  if (b.good !== undefined || b.next !== undefined)
    db.prepare(`INSERT INTO reviews(team,judge,good,next) VALUES(?,?,?,?)
                ON CONFLICT(team,judge) DO UPDATE SET good=excluded.good, next=excluded.next`)
      .run(team, b.judge, (b.good || '').slice(0, 500), (b.next || '').slice(0, 500));
}

/** 순위 — 항목별 가중 평균. 심사위원 수가 달라도 평균이라 흔들리지 않는다. */
function board(db, event, admin = false) {
  const e = getEvent(db, event);
  const teams = db.prepare(`
    SELECT t.id, t.name, t.contact, t.role, t.solo, t.found, t.note AS apply,
           t.agreed, t.photo, t.came, t.size, t.want,
           s.url, s.note
    FROM teams t LEFT JOIN submissions s ON s.team = t.id
    WHERE t.event = ? ORDER BY t.id`).all(event);
  const rows = teams.map(t => {
    let total = 0, judged = new Set();
    for (const r of e.rubric) {
      const g = db.prepare('SELECT AVG(value) a, COUNT(*) c FROM scores WHERE team=? AND key=?')
        .get(t.id, r.key);
      if (g.c) { total += (g.a || 0) * r.weight / 100; }
    }
    for (const j of db.prepare('SELECT DISTINCT judge FROM scores WHERE team=?').all(t.id))
      judged.add(j.judge);
    const row = { ...t, score: Math.round(total * 10) / 10, judges: judged.size,
                  by: [...judged].sort(), done: !!t.url };
    /* 개인정보는 운영자에게만. 화면에서 감추면 브라우저 콘솔에서 다 보인다. */
    if (!admin) { delete row.contact; delete row.found; delete row.agreed;
                  delete row.photo; delete row.came; delete row.apply; }
    return row;
  });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  e.admin = admin;   // 화면이 운영 칸을 그릴지 말지 이걸로 정한다
  /* 이 대회에 한 번이라도 점수를 넣은 사람 전부. 화면이 '아직 안 본 사람' 을 계산하는 근거다. */
  const judges = db.prepare(`SELECT DISTINCT s.judge FROM scores s
                             JOIN teams t ON t.id = s.team
                             WHERE t.event = ? ORDER BY s.judge`).all(event).map(r => r.judge);
  return { event: e, rows, judges };
}

/** 심사 계획을 대신 계산한다. 운영자가 제일 자주 틀리는 계산이다.
    MLH 주최자 가이드의 공식: J = ceil(P * n * t / T)
      P 팀 수 · n 한 팀을 보는 심사위원 수(권장 3) · t 팀당 분(권장 4) · T 심사에 쓸 분
    팀당 4분은 시연 2 + 질문 1 + 채점과 이동 1 이다. */
function judgePlan(teams, minutes, perTeam = 4, rounds = 3) {
  const P = Math.max(0, +teams || 0), T = Math.max(1, +minutes || 60);
  const need = Math.ceil((P * rounds * perTeam) / T);
  return {
    teams: P, minutes: T, perTeam, rounds,
    need,
    /* 한 사람이 보게 되는 팀 수. 12팀을 넘기면 뒤로 갈수록 점수가 흐려진다. */
    perJudge: need ? Math.ceil((P * rounds) / need) : 0,
    tight: need ? Math.ceil((P * rounds) / need) > 12 : false,
  };
}

/** 심사위원별 평균과 그 차이. 매뉴얼 7장의 캘리브레이션을 뒷받침한다.
    누가 후하고 누가 짠지 모르면 눈높이를 맞출 수가 없다.
    운영자만 본다 — 심사위원에게 보이면 서로 눈치를 본다. */
function spread(db, event) {
  const rows = db.prepare(`SELECT s.judge, AVG(s.value) avg, COUNT(DISTINCT s.team) teams
                           FROM scores s JOIN teams t ON t.id = s.team
                           WHERE t.event = ? GROUP BY s.judge ORDER BY avg DESC`).all(event);
  for (const r of rows) r.avg = Math.round(r.avg * 10) / 10;
  if (rows.length < 2) return { rows, gap: 0, warn: false };
  const gap = Math.round((rows[0].avg - rows[rows.length - 1].avg) * 10) / 10;
  /* 15점이면 한 항목이 아니라 순위가 뒤집힌다. 그때부터 캘리브레이션을 권한다. */
  return { rows, gap, warn: gap >= 15, top: rows[0].judge, bottom: rows[rows.length - 1].judge };
}

/** 팀 짜기 시간에 쓰는 한 장.
    혼자 온 사람과 자리 남은 팀을 나란히 놓는다.
    연락처는 안 담는다 — 오프라인이라 얼굴 보고 짜면 되고, 그게 더 잘 된다.
    온라인 매칭은 실패한 사례가 많다(팀은 많은데 전부 '비공개·초대 필요'). */
function crew(db, event) {
  const rows = db.prepare(`SELECT id, name, role, solo, size, want, note
                           FROM teams WHERE event = ? ORDER BY id`).all(event);
  return {
    solo: rows.filter(r => r.solo).map(r => ({
      id: r.id, name: r.name, role: r.role, note: r.note })),
    looking: rows.filter(r => !r.solo && r.want).map(r => ({
      id: r.id, name: r.name, size: r.size, want: r.want, note: r.note })),
    teams: rows.length,
  };
}

/** 행사장 큰 화면이 쓰는 것. 열쇠가 없다 — 벽에 걸어 두는 화면이라
    연락처 같은 건 애초에 안 담는다. */
function tv(db, event) {
  const e = getEvent(db, event);
  const rows = db.prepare(`SELECT t.name, s.url FROM teams t
                           LEFT JOIN submissions s ON s.team = t.id
                           WHERE t.event = ? ORDER BY t.id`).all(event);
  const b = board(db, event, false);
  const judged = b.rows.some(r => r.judges > 0);
  return {
    title: e.title, host: e.host, due: e.due, plan: e.plan,
    starts: e.starts, ends: e.ends,
    teams: rows.length,
    done: rows.filter(r => r.url).length,
    waiting: rows.filter(r => !r.url).map(r => r.name),
    /* 심사가 시작되기 전에는 순위를 안 보낸다. 벽에 붙은 화면으로 순위가 새면
       심사위원이 그걸 보고 점수를 맞춘다. */
    ranks: judged ? b.rows.slice(0, 5).map(r => ({ rank: r.rank, name: r.name, score: r.score })) : [],
    crew: crew(db, event),
  };
}

/** 심사위원이 보는 것. 남의 점수도 순위도 안 내려보낸다 —
    화면에서 감추는 게 아니라 서버가 안 준다. 심사 중에 순위를 보면 점수가 끌려간다. */
function judgeView(db, event, judge) {
  const e = getEvent(db, event);
  const teams = db.prepare(`SELECT t.id, t.name, s.url, s.note
                            FROM teams t LEFT JOIN submissions s ON s.team = t.id
                            WHERE t.event = ? ORDER BY t.id`).all(event);
  for (const t of teams) {
    t.mine = {};
    if (judge)
      for (const r of db.prepare('SELECT key, value FROM scores WHERE team=? AND judge=?')
                        .all(t.id, judge)) t.mine[r.key] = r.value;
    t.doneByMe = Object.keys(t.mine).length > 0;
    t.review = judge
      ? (db.prepare('SELECT good, next FROM reviews WHERE team=? AND judge=?').get(t.id, judge)
         || { good: '', next: '' })
      : { good: '', next: '' };
  }
  // 아직 안 본 팀을 위로. 심사위원이 스스로 남은 것을 안다.
  teams.sort((a, b) => (a.doneByMe ? 1 : 0) - (b.doneByMe ? 1 : 0));
  return {
    event: { id: e.id, title: e.title, rubric: e.rubric, due: e.due,
             starts: e.starts, ends: e.ends },
    teams,
    left: teams.filter(t => !t.doneByMe).length,
  };
}

/** 협찬사에게 주는 성과 요약. 노출 수가 아니라 이 셋으로 정산한다. */
function outcomes(db, event) {
  const t = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(event).c;
  const done = db.prepare(`SELECT COUNT(*) c FROM submissions s
                           JOIN teams t ON t.id=s.team WHERE t.event=?`).get(event).c;
  const by = {};
  for (const r of db.prepare('SELECT kind, COUNT(*) c FROM outcomes WHERE event=? GROUP BY kind').all(event))
    by[r.kind] = r.c;
  const found = db.prepare(`SELECT CASE WHEN found = '' THEN '안 적음' ELSE found END AS k,
                                   COUNT(*) c FROM teams WHERE event = ?
                            GROUP BY k ORDER BY c DESC`).all(event);
  return {
    teams: t,
    finished: done,
    found,
    solo: db.prepare('SELECT COUNT(*) c FROM teams WHERE event=? AND solo=1').get(event).c,
    finishRate: t ? Math.round(done / t * 1000) / 10 : 0,   // 완주율 %
    came: db.prepare("SELECT COUNT(*) c FROM teams WHERE event=? AND came<>''").get(event).c,
    photo: db.prepare('SELECT COUNT(*) c FROM teams WHERE event=? AND photo=1').get(event).c,
    interview: by['면접'] || 0,
    adoption: by['도입검토'] || 0,
    hired: by['채용'] || 0,
    followup: by['후속미팅'] || 0,
    list: db.prepare('SELECT * FROM outcomes WHERE event=? ORDER BY at DESC').all(event),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** 대회 하나를 통째로 담는다. 노트북이 죽으면 이걸로 살린다. */
function dump(db, event) {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(event);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  delete e.okey;   // 백업 파일에도 열쇠는 안 담는다
  const teams = db.prepare('SELECT * FROM teams WHERE event=? ORDER BY id').all(event);
  const ids = teams.map(t => t.id);
  const inIds = ids.length ? `(${ids.join(',')})` : '(0)';
  return {
    saved: new Date().toISOString(),
    event: e,
    teams,
    submissions: db.prepare(`SELECT * FROM submissions WHERE team IN ${inIds}`).all(),
    scores: db.prepare(`SELECT * FROM scores WHERE team IN ${inIds}`).all(),
    reviews: db.prepare(`SELECT * FROM reviews WHERE team IN ${inIds}`).all(),
    sponsors: db.prepare('SELECT * FROM sponsors WHERE event=?').all(event),
    outcomes: db.prepare('SELECT * FROM outcomes WHERE event=?').all(event),
    supporters: db.prepare('SELECT * FROM supporters WHERE event=?').all(event),
    assignments: db.prepare(`SELECT * FROM assignments WHERE team IN ${inIds}`).all(),
  };
}

/** DB 파일을 통째로 복사해 둔다. 몇 벌만 남기고 오래된 것은 지운다.
    sqlite 는 WAL 을 쓰므로 복사 전에 체크포인트를 돌려 본체에 밀어 넣는다. */
function backup(db, file, keep = 12) {
  const dir = path.join(path.dirname(file), 'backup');
  fs.mkdirSync(dir, { recursive: true });
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(dir, `hackon-${stamp}.db`);
  fs.copyFileSync(file, out);
  const olds = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
  for (const f of olds.slice(0, Math.max(0, olds.length - keep)))
    fs.rmSync(path.join(dir, f), { force: true });
  return out;
}

/** 사후 지원 현황. 약속한 것 · 지킨 것 · 기한 넘긴 것. */
function support(db, event) {
  const people = db.prepare('SELECT * FROM supporters WHERE event=? ORDER BY id').all(event);
  const rows = db.prepare(`SELECT a.*, s.name AS helper_name, s.org, t.name AS team_name
                           FROM assignments a
                           JOIN supporters s ON s.id = a.helper
                           JOIN teams t ON t.id = a.team
                           WHERE t.event = ? ORDER BY a.due, t.name`).all(event);
  const t = today();
  for (const r of rows) r.late = !r.done && !!r.due && r.due < t;
  return {
    people, rows,
    promised: rows.length,
    done: rows.filter(r => r.done).length,
    late: rows.filter(r => r.late).length,
  };
}

/** 배정. 기한을 안 주면 대회 끝나고 14일로 잡는다 (매뉴얼 11장의 '끝나고 2주'). */
function assign(db, event, b) {
  if (!b.team || !b.helper) throw new HttpError(400, '팀과 지원자를 골라 주세요');
  const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+b.team);
  if (!t || t.event !== event) throw new HttpError(404, '이 대회의 팀이 아닙니다');
  let due = b.due;
  if (!due) {
    const e = db.prepare('SELECT ends FROM events WHERE id=?').get(event);
    due = new Date(new Date(e.ends).getTime() + 14 * 86400000).toISOString().slice(0, 10);
  }
  try {
    db.prepare('INSERT INTO assignments(team,helper,due,note) VALUES(?,?,?,?)')
      .run(+b.team, +b.helper, due, b.note || '');
  } catch { throw new HttpError(409, '이미 짝지어진 조합입니다'); }
  return due;
}

/* ───────────────────── HTTP ───────────────────── */
/* #region reuse:http-kit — HttpError·MIME·body()·json(). 이 네 개가 한 세트다 */
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function body(req) {
  return new Promise((res, rej) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) rej(new HttpError(413, '너무 큽니다')); });
    req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch { rej(new HttpError(400, 'JSON 이 아닙니다')); } });
  });
}
const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
/* #endregion reuse:http-kit */

/* #region reuse:router — URL 파싱 → /api/* 분기 → 정적 파일 폴백 → catch 에서 json 에러.
   새 프로젝트는 이 뼈대만 복사하고 가운데 if 블록만 갈아 끼운다 */
function routes(db) {
  return async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    try {
      if (p.startsWith('/api/')) {
        const q = Object.fromEntries(u.searchParams);
        let m;

        if (p === '/api/events' && req.method === 'GET')
          return json(res, 200, db.prepare(
            'SELECT id,title,host,starts,ends,prize FROM events ORDER BY created DESC LIMIT 50').all());

        const key = req.headers['x-okey'] || q.k || '';

        if (p === '/api/events' && req.method === 'POST')
          return json(res, 201, createEvent(db, await body(req)));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)$/))) {
          if (req.method === 'PATCH') {
            needAdmin(db, m[1], key);
            editEvent(db, m[1], await body(req));
            return json(res, 200, getEvent(db, m[1]));
          }
          if (req.method === 'GET') {
            const e = getEvent(db, m[1]);
            e.admin = isAdmin(db, m[1], key);
            return json(res, 200, e);
          }
          if (req.method === 'DELETE') {
            needAdmin(db, m[1], key);
            db.prepare('DELETE FROM events WHERE id=?').run(m[1]);
            return json(res, 200, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/teams$/)) && req.method === 'POST')
          return json(res, 201, { id: joinTeam(db, m[1], await body(req)) });

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/board$/)))
          return json(res, 200, board(db, m[1], isAdmin(db, m[1], key)));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/sponsors$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key);
          const b = await body(req);
          db.prepare('INSERT INTO sponsors(event,name,kind,amount,note) VALUES(?,?,?,?,?)')
            .run(m[1], b.name, b.kind || '현금', +b.amount || 0, b.note || '');
          return json(res, 201, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/crew$/)) && req.method === 'GET')
          return json(res, 200, crew(db, m[1]));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/tv$/)) && req.method === 'GET')
          return json(res, 200, tv(db, m[1]));

        if (p === '/api/plan' && req.method === 'GET')
          return json(res, 200, judgePlan(q.teams, q.minutes, +q.per || 4, +q.rounds || 3));

        if ((m = p.match(/^\/api\/teams\/(\d+)\/card$/)) && req.method === 'GET')
          return json(res, 200, card(db, +m[1]));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/open$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key);
          const b = await body(req);
          db.prepare('UPDATE events SET opened=? WHERE id=?').run(b.open === false ? 0 : 1, m[1]);
          return json(res, 200, { opened: b.open === false ? 0 : 1 });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/spread$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key);   // 심사위원에게 보이면 서로 눈치를 본다
          return json(res, 200, spread(db, m[1]));
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/judge$/)) && req.method === 'GET')
          return json(res, 200, judgeView(db, m[1], q.judge || ''));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/support$/))) {
          if (req.method === 'GET') return json(res, 200, support(db, m[1]));
          if (req.method === 'POST') {
            needAdmin(db, m[1], key);
            const b = await body(req);
            if (!b.name) throw new HttpError(400, '이름이 필요합니다');
            try {
              db.prepare('INSERT INTO supporters(event,name,org,can,contact) VALUES(?,?,?,?,?)')
                .run(m[1], b.name, b.org || '', b.can || '', b.contact || '');
            } catch { throw new HttpError(409, '같은 이름이 이미 있습니다'); }
            return json(res, 201, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/assign$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key);
          return json(res, 201, { due: assign(db, m[1], await body(req)) });
        }

        if ((m = p.match(/^\/api\/assignments\/(\d+)\/done$/)) && req.method === 'POST') {
          const b = await body(req);
          db.prepare('UPDATE assignments SET done=?, note=? WHERE id=?')
            .run(b.done === false ? '' : today(), b.note || '', +m[1]);
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/outcomes$/))) {
          if (req.method === 'GET') {
            const o = outcomes(db, m[1]);
            /* 완주율은 공개 페이지가 쓴다. 유입 경로와 명단은 운영자 것이다. */
            if (!isAdmin(db, m[1], key)) { delete o.found; delete o.list; delete o.came; }
            return json(res, 200, o);
          }
          if (req.method === 'POST') {
            needAdmin(db, m[1], key);
            const b = await body(req);
            db.prepare('INSERT INTO outcomes(event,team,kind,who,note) VALUES(?,?,?,?,?)')
              .run(m[1], b.team || null, b.kind, b.who || '', b.note || '');
            return json(res, 201, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/extend$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key);
          /* 인터넷이 터지면 마감을 미룰 수 있어야 한다 (매뉴얼 3장).
             진행자가 그 자리에서 누른다. */
          const b = await body(req);
          const e = db.prepare('SELECT due FROM events WHERE id=?').get(m[1]);
          if (!e) throw new HttpError(404, '없는 대회입니다');
          if (!e.due) throw new HttpError(400, '마감 시각이 없습니다');
          const mins = Math.min(Math.max(+b.minutes || 30, 1), 240);
          const due = new Date(new Date(e.due).getTime() + mins * 60000);
          const pad = n => String(n).padStart(2, '0');
          const txt = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
                    + `T${pad(due.getHours())}:${pad(due.getMinutes())}`;
          db.prepare('UPDATE events SET due=? WHERE id=?').run(txt, m[1]);
          return json(res, 200, { due: txt, minutes: mins });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/more$/)) && req.method === 'POST')
          return json(res, 200, moreTeam(db, +m[1], await body(req)));

        if ((m = p.match(/^\/api\/teams\/(\d+)\/checkin$/)) && req.method === 'POST') {
          /* 등록 데스크에서 누른다. 다시 누르면 취소 — 잘못 누르는 일이 실제로 생긴다. */
          const t = db.prepare('SELECT came, event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          needAdmin(db, t.event, key);
          const came = t.came ? '' : new Date().toISOString();
          db.prepare('UPDATE teams SET came=? WHERE id=?').run(came, +m[1]);
          return json(res, 200, { came });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/submit$/)) && req.method === 'POST') {
          submit(db, +m[1], await body(req));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/score$/)) && req.method === 'POST') {
          score(db, +m[1], await body(req));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/dump$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key);
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="hackon-${m[1]}.json"`,
          });
          return res.end(JSON.stringify(dump(db, m[1]), null, 2));
        }
        if (p === '/api/health') return json(res, 200, {
          ok: true, events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
          teams: db.prepare('SELECT COUNT(*) c FROM teams').get().c,
          net: lanIPs(), port: +PORT,
        });
        throw new HttpError(404, '없는 주소입니다');
      }

      /* 공개 링크. /e/<대회id> 는 화면 파일을 그대로 내려보내고, 화면이 주소를 보고
         읽기 전용으로 그린다. 서버에 화면을 하나 더 두지 않는 게 요점이다. */
      /* 주소가 셋 갈린다.
         /            첫 화면. 플랫폼 소개와 열린 대회 목록 (home.html)
         /app         대회를 열고 굴리는 곳 (hack-on.html)
         /e /j /tv    공개·심사·현장 화면. 전부 같은 hack-on.html 이 주소를 보고 갈라진다 */
      const pub = p.match(/^\/e\/[a-z0-9]+(\/report)?$/) || p.match(/^\/j\/[a-z0-9]+$/)
               || p.match(/^\/tv\/[a-z0-9]+$/) || p === '/app';

      /* #region reuse:static — 경로 탈출 방지 + MIME + 스트림. 그대로 복사해 쓴다 */
      const f = path.join(ROOT,
        p === '/' ? 'home.html' : pub ? 'hack-on.html' : decodeURIComponent(p));
      if (!f.startsWith(ROOT)) throw new HttpError(403, '안 됩니다');
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) throw new HttpError(404, '없습니다');
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
      /* #endregion reuse:static */
    } catch (e) {
      json(res, e.code || 500, { error: e.message });
    }
  };
}
/* #endregion reuse:router */

/* ───────────────────── 자체 점검 ───────────────────── */
function selftest() {
  const tmp = path.join(ROOT, 'data', 'test.db');
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });
  const db = open(tmp);
  let n = 0; const ok = (c, m) => { if (!c) throw new Error('실패: ' + m); n++; };

  const evR = createEvent(db, { title: '첫 대회', host: '유재원', starts: '2026-10-01', prize: 1000000 });
  const ev = evR.id, okey = evR.okey;
  ok(getEvent(db, ev).title === '첫 대회', '대회 개설');
  editEvent(db, ev, { prize: 500000, due: '2026-11-07T17:00' });
  ok(getEvent(db, ev).prize === 500000 && getEvent(db, ev).due === '2026-11-07T17:00',
     '만든 뒤에 나머지를 채운다');
  ok(/^[0-9a-f]{10}$/.test(okey), '운영자 열쇠가 발급된다');
  ok(!('okey' in getEvent(db, ev)), '열쇠는 안 내려보낸다');
  ok(board(db, ev, true).rows.length === 0, '빈 대회');
  ok(isAdmin(db, ev, okey) && !isAdmin(db, ev, 'x'), '열쇠가 맞아야 운영자다');

  let bad = false;
  try { createEvent(db, { title: 'x', rubric: [{ key: 'a', label: 'a', weight: 50 }] }); }
  catch { bad = true; }
  ok(bad, '배점 합이 100 이 아니면 막는다');

  bad = false; try { joinTeam(db, ev, { name: '동의안함' }); } catch { bad = true; }
  ok(bad, '개인정보 동의 없이는 신청이 안 된다');

  // 문간에 발 담그기 — 이름과 동의만으로 신청되고, 나머지는 나중에 채운다
  const lite = joinTeam(db, ev, { name: '최소팀', agree: true });
  ok(!!lite, '이름과 동의만으로 신청된다');
  ok(moreTeam(db, lite, { contact: 'a@b.c', role: '기획' }).filled === 2, '나중에 두 칸을 채운다');
  ok(moreTeam(db, lite, { contact: '덮어쓰기' }).filled === 0, '이미 적은 것은 안 덮어쓴다');
  ok(board(db, ev, true).rows.find(r => r.id === lite).contact === 'a@b.c', '채운 값이 남는다');
  db.prepare('DELETE FROM teams WHERE id=?').run(lite);

  const t1 = joinTeam(db, ev, { name: '가팀', agree: true, photo: true });
  const t2 = joinTeam(db, ev, { name: '나팀', agree: true });
  bad = false; try { joinTeam(db, ev, { name: '가팀', agree: true }); } catch { bad = true; }
  ok(bad, '같은 팀 이름은 못 넣는다');
  ok(!!board(db, ev, true).rows.find(r => r.id === t1).agreed, '동의한 시각이 남는다');

  submit(db, t1, { url: 'https://example.com/a' });
  score(db, t1, { judge: '심사1', values: { idea: 90, make: 80, use: 70, tell: 60 } });
  score(db, t2, { judge: '심사1', values: { idea: 50, make: 50, use: 50, tell: 50 } });
  const b = board(db, ev);
  ok(b.rows[0].name === '가팀', '점수 높은 팀이 1등');
  ok(b.rows[0].score > b.rows[1].score, '가중 평균이 계산된다');

  bad = false; try { score(db, t1, { judge: 'x', values: { nope: 10 } }); } catch { bad = true; }
  ok(bad, '없는 심사 항목은 막는다');

  score(db, t2, { judge: '심사2', values: { idea: 60, make: 60, use: 60, tell: 60 } });
  const b2 = board(db, ev);
  ok(b2.judges.length === 2, '심사위원 명단이 모인다 (' + b2.judges.join() + ')');
  ok(b2.rows.find(r => r.name === '가팀').by.length === 1, '팀별로 누가 봤는지 나온다');

  // 신청 칸은 따로 연 대회에서 본다. 여기에 팀을 더하면 아래 완주율 검사가 흔들린다.
  const ev2 = createEvent(db, { title: '신청폼시험' }).id;
  const s1 = joinTeam(db, ev2, { name: '다팀', role: '기획', solo: true, found: '캠퍼스픽', agree: true });
  joinTeam(db, ev2, { name: '라팀', role: '만들기', found: '캠퍼스픽', agree: true });
  joinTeam(db, ev2, { name: '마팀', agree: true });
  ok(board(db, ev2).rows.find(r => r.id === s1).role === '기획', '신청 칸이 저장된다');
  const o0 = outcomes(db, ev2);
  ok(o0.solo === 1, '혼자 온 사람이 세어진다 (' + o0.solo + ')');
  ok(o0.found[0].k === '캠퍼스픽' && o0.found[0].c === 2,
     '유입 경로가 많은 순으로 집계된다 (' + JSON.stringify(o0.found) + ')');

  // 마감 — 지났으면 서버가 막고, 미루면 다시 받는다
  const past = createEvent(db, { title: '마감지남', due: '2020-01-01T10:00' }).id;
  const pt = joinTeam(db, past, { name: '늦은팀', agree: true });
  bad = false; try { submit(db, pt, { url: 'x' }); } catch { bad = true; }
  ok(bad, '마감이 지나면 제출을 막는다');
  db.prepare('UPDATE events SET due=? WHERE id=?').run('2099-01-01T10:00', past);
  submit(db, pt, { url: 'https://example.com/late' });
  ok(!!db.prepare('SELECT url FROM submissions WHERE team=?').get(pt), '마감을 미루면 다시 받는다');

  ok(board(db, ev, true).rows[0].contact !== undefined, '운영자는 연락처를 본다');
  ok(board(db, ev, false).rows[0].contact === undefined, '손님에게는 연락처가 안 간다');
  ok(board(db, ev, false).rows[0].came === undefined, '손님에게는 체크인이 안 간다');

  // 성적표 — 공개하기 전에는 팀도 못 본다
  score(db, t1, { judge: '심사1', values: { idea: 90, make: 80, use: 70, tell: 60 },
                  good: '문제를 잘 골랐습니다', next: '실제로 쓰는 사람을 한 명만 만나 보세요' });
  ok(card(db, t1).opened === false, '공개 전에는 성적표가 안 열린다');
  db.prepare('UPDATE events SET opened=1 WHERE id=?').run(ev);
  const cd = card(db, t1);
  ok(cd.items.length === 4 && cd.items[0].label === '독창성', '항목별로 쪼개서 보여 준다');
  ok(cd.items[0].got === 27, '항목 배점이 반영된다 (90 * 30% = 27)');
  ok(cd.reviews.length === 1 && cd.reviews[0].good.includes('문제를'), '심사평이 붙는다');
  ok(!('judge' in cd.reviews[0]), '심사평에 이름이 안 붙는다');
  db.prepare('UPDATE events SET opened=0 WHERE id=?').run(ev);

  // 팀 짜기 — 혼자 온 사람과 자리 남은 팀
  const soloTeam = joinTeam(db, ev, { name: '혼자온사람', agree: true, solo: true, role: '기획' });
  moreTeam(db, t2, { want: '만드는 사람 한 분' });
  db.prepare('UPDATE teams SET size=2 WHERE id=?').run(t2);
  const cw = crew(db, ev);
  ok(cw.solo.length === 1 && cw.solo[0].name === '혼자온사람', '혼자 온 사람이 잡힌다');
  ok(cw.looking.length === 1 && cw.looking[0].size === 2, '사람 찾는 팀이 잡힌다');
  ok(!('contact' in cw.solo[0]), '팀 짜기 화면에 연락처가 안 실린다');
  db.prepare('DELETE FROM teams WHERE id=?').run(soloTeam);
  db.prepare("UPDATE teams SET want='' WHERE id=?").run(t2);

  // 현장 화면 — 일정은 한 곳에만 둔다
  ok(getEvent(db, ev).plan.length === 9, '기본 진행표가 깔린다 (' + getEvent(db, ev).plan.length + '줄)');
  const tv0 = tv(db, ev);
  ok(tv0.teams === 2 && tv0.done === 1, '제출 현황이 맞는다');
  ok(tv0.waiting.includes('나팀'), '아직 안 낸 팀 이름이 나온다');
  ok(!('contact' in tv0), '벽에 거는 화면에 연락처가 안 실린다');
  editEvent(db, ev, { plan: [{ at: '09:00', what: '모임' }, { at: 'x', what: '' }] });
  ok(getEvent(db, ev).plan.length === 2, '진행표를 고칠 수 있다');

  // 심사 편차 — 후한 사람과 짠 사람의 차이
  const sp0 = spread(db, ev);
  ok(sp0.rows.length === 2, '심사위원별 평균이 나온다 (' + JSON.stringify(sp0.rows) + ')');
  ok(sp0.rows[0].avg > sp0.rows[1].avg, '후한 사람이 위로 온다');
  const ev3 = createEvent(db, { title: '편차시험' }).id;
  const q1 = joinTeam(db, ev3, { name: '한팀', agree: true });
  score(db, q1, { judge: '후한사람', values: { idea: 95, make: 95, use: 95, tell: 95 } });
  score(db, q1, { judge: '짠사람', values: { idea: 60, make: 60, use: 60, tell: 60 } });
  const sp1 = spread(db, ev3);
  ok(sp1.gap === 35 && sp1.warn, '차이가 크면 경고한다 (' + sp1.gap + '점)');
  ok(sp1.top === '후한사람' && sp1.bottom === '짠사람', '누가 후하고 짠지 나온다');

  // 심사 화면 — 남의 점수와 순위가 안 새어 나가는가
  const jv = judgeView(db, ev, '심사1');
  ok(jv.teams.every(t => !('score' in t) && !('rank' in t) && !('contact' in t)),
     '심사 화면에 점수·순위·연락처가 안 실린다');
  ok(!('teams' in jv.event) && !('sponsors' in jv.event), '심사 화면에 협찬사가 안 실린다');
  ok(Object.keys(jv.teams.find(t => t.id === t1).mine).length === 4, '내가 낸 점수는 보인다');
  ok(jv.left === 0, '심사1 은 다 봤다');

  // 한 팀만 본 심사위원에게는 안 본 팀이 위로 와야 한다
  score(db, t1, { judge: '심사9', values: { idea: 50, make: 50, use: 50, tell: 50 } });
  const jv9 = judgeView(db, ev, '심사9');
  ok(jv9.teams[0].id === t2 && jv9.left === 1, '아직 안 본 팀이 위로 온다');
  ok(Object.keys(jv9.teams.find(t => t.id === t1).mine).idea === undefined
     || jv9.teams.find(t => t.id === t1).mine.idea === 50, '심사위원마다 자기 점수만 본다');

  // 사후 지원 — 약속하고, 기한을 넘기면 늦음으로 잡히고, 하면 지운다
  db.prepare('INSERT INTO supporters(event,name,org,can) VALUES(?,?,?,?)')
    .run(ev, '박실무', '어느회사', '도입 검토를 같이 봐 줍니다');
  const helper = db.prepare('SELECT id FROM supporters WHERE event=?').get(ev).id;
  const due = assign(db, ev, { team: t1, helper });
  ok(due === '2026-10-15', '기한을 안 주면 대회 끝나고 14일 (' + due + ')');
  bad = false; try { assign(db, ev, { team: t1, helper }); } catch { bad = true; }
  ok(bad, '같은 짝을 두 번 넣지 않는다');
  db.prepare("UPDATE assignments SET due='2020-01-01'").run();
  ok(support(db, ev).late === 1, '기한이 지나면 늦음으로 잡힌다');
  db.prepare("UPDATE assignments SET done=date('now')").run();
  const sup = support(db, ev);
  ok(sup.late === 0 && sup.done === 1, '하면 늦음에서 빠진다');

  db.prepare("UPDATE teams SET came=datetime('now') WHERE id=?").run(t1);
  ok(outcomes(db, ev).came === 1, '체크인이 세어진다');
  ok(outcomes(db, ev).photo === 1, '촬영 동의가 세어진다');

  db.prepare('INSERT INTO outcomes(event,team,kind,who) VALUES(?,?,?,?)').run(ev, t1, '면접', '어느회사');
  const o = outcomes(db, ev);
  ok(o.finishRate === 50, '완주율은 제출한 팀 비율 (' + o.finishRate + ')');
  ok(o.interview === 1, '면접 연결 수가 잡힌다');

  // 내보내기 — 노트북이 죽어도 이걸로 살린다
  const dp = dump(db, ev);
  ok(dp.teams.length >= 2 && dp.scores.length > 0, '내보내기에 팀과 점수가 담긴다');
  ok(dp.sponsors !== undefined && dp.supporters !== undefined && dp.assignments !== undefined,
     '협찬사·지원자·배정도 담긴다');
  ok(!('okey' in dp.event), '내보낸 파일에 열쇠는 안 담긴다');
  ok(dp.reviews.length >= 1, '심사평도 담긴다');

  // 백업 — 파일이 실제로 생기는가
  const bfile = backup(db, tmp, 3);
  ok(fs.existsSync(bfile) && fs.statSync(bfile).size > 0, '백업 파일이 생긴다');
  for (let i = 0; i < 5; i++) backup(db, tmp, 3);
  const kept = fs.readdirSync(path.join(path.dirname(tmp), 'backup')).filter(f => f.endsWith('.db'));
  ok(kept.length <= 3, '오래된 백업은 지운다 (' + kept.length + '벌)');
  fs.rmSync(path.join(path.dirname(tmp), 'backup'), { recursive: true, force: true });

  db.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });
  ok(Array.isArray(lanIPs()), '랜 주소를 찾는다 (' + (lanIPs()[0] || '없음') + ')');



  // 심사 계획 — MLH 가이드의 예시(175팀·2시간 → 18명)와 맞는지로 검산한다
  ok(judgePlan(175, 120).need === 18, '심사위원 수 공식이 MLH 예시와 맞는다 ('
     + judgePlan(175, 120).need + '명)');
  ok(judgePlan(6, 60).need === 2, '6팀 1시간이면 2명 (' + judgePlan(6, 60).need + ')');
  ok(judgePlan(60, 60).tight, '한 사람이 너무 많이 보면 경고한다');


  console.log(`점검 통과 — ${n}가지`);
}

/* ───────────────────── 실행 ───────────────────── */
if (require.main === module) {
  if (process.argv.includes('--test')) { selftest(); process.exit(0); }
  const db = open(DBFILE);

  /* 10분마다 통째로 복사해 둔다. 심사 도중에 노트북이 죽는 일이 실제로 생긴다.
     최근 12벌이면 두 시간 치다. 그 이상은 지운다. */
  const tick = () => { try { backup(db, DBFILE); } catch (e) { console.error('백업 실패', e.message); } };
  tick();
  setInterval(tick, 10 * 60 * 1000).unref();

  /* 0.0.0.0 으로 듣는다. 이걸 안 하면 같은 와이파이의 폰이 못 붙는다. */
  http.createServer(routes(db)).listen(PORT, '0.0.0.0', () => {
    console.log(`HACK:ON  →  http://localhost:${PORT}   (운영자용)`);
    const ips = lanIPs();
    if (ips.length) {
      console.log('참가자에게는 아래 주소를 알려 주세요 — 같은 와이파이여야 합니다.');
      for (const ip of ips) console.log(`             http://${ip}:${PORT}`);
    } else {
      console.log('랜 주소를 못 찾았습니다. 와이파이에 연결돼 있는지 확인해 주세요.');
    }
  });
}
module.exports = { open, createEvent, editEvent, moreTeam, joinTeam, submit, score, board, outcomes,
                   card, support, assign, spread, judgeView, judgePlan, lanIPs, tv, crew,
                   dump, backup, isAdmin };
