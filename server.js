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

    CREATE TABLE IF NOT EXISTS sponsors(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      kind   TEXT NOT NULL DEFAULT '현금',   -- 현금 | 크레딧 | 상품 | 멘토
      amount INTEGER NOT NULL DEFAULT 0,
      note   TEXT NOT NULL DEFAULT ''
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
  for (const c of ['role', 'found', 'note'])
    try { db.exec(`ALTER TABLE teams ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN solo INTEGER NOT NULL DEFAULT 0'); } catch {}
  return db;
}
/* #endregion reuse:db-open */

const nid = () => crypto.randomBytes(4).toString('hex');

/* ───────────────────── 도메인 ───────────────────── */

const DEFAULT_RUBRIC = [
  { key: 'idea', label: '독창성', weight: 30 },
  { key: 'make', label: '완성도', weight: 30 },
  { key: 'use', label: '실용성', weight: 25 },
  { key: 'tell', label: '전달력', weight: 15 },
];

function createEvent(db, b) {
  if (!b.title) throw new HttpError(400, '대회 이름이 필요합니다');
  const id = b.id || nid();
  const rubric = Array.isArray(b.rubric) && b.rubric.length ? b.rubric : DEFAULT_RUBRIC;
  const sum = rubric.reduce((a, r) => a + Number(r.weight || 0), 0);
  if (sum !== 100) throw new HttpError(400, `심사 배점 합이 ${sum} 입니다. 100 이어야 합니다`);
  db.prepare(`INSERT INTO events(id,title,host,topic,starts,ends,prize,cap,rubric,due)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title, b.host || '주최자', b.topic || '',
         b.starts || today(), b.ends || b.starts || today(),
         +b.prize || 0, +b.cap || 0, JSON.stringify(rubric), b.due || '');
  return id;
}

function getEvent(db, id) {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(id);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  e.rubric = JSON.parse(e.rubric);
  e.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(id).c;
  e.sponsors = db.prepare('SELECT * FROM sponsors WHERE event=? ORDER BY amount DESC').all(id);
  return e;
}

function joinTeam(db, event, b) {
  const e = getEvent(db, event);
  if (!b.name) throw new HttpError(400, '팀 이름이 필요합니다');
  if (e.cap && e.teams >= e.cap) throw new HttpError(409, '정원이 찼습니다');
  try {
    const r = db.prepare(`INSERT INTO teams(event,name,contact,role,solo,found,note)
                          VALUES(?,?,?,?,?,?,?)`)
      .run(event, b.name, b.contact || '', b.role || '', b.solo ? 1 : 0,
           b.found || '', b.note || '');
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
}

/** 순위 — 항목별 가중 평균. 심사위원 수가 달라도 평균이라 흔들리지 않는다. */
function board(db, event) {
  const e = getEvent(db, event);
  const teams = db.prepare(`
    SELECT t.id, t.name, t.contact, t.role, t.solo, t.found, t.note AS apply,
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
    return { ...t, score: Math.round(total * 10) / 10, judges: judged.size,
             by: [...judged].sort(), done: !!t.url };
  });
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  /* 이 대회에 한 번이라도 점수를 넣은 사람 전부. 화면이 '아직 안 본 사람' 을 계산하는 근거다. */
  const judges = db.prepare(`SELECT DISTINCT s.judge FROM scores s
                             JOIN teams t ON t.id = s.team
                             WHERE t.event = ? ORDER BY s.judge`).all(event).map(r => r.judge);
  return { event: e, rows, judges };
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
    interview: by['면접'] || 0,
    adoption: by['도입검토'] || 0,
    hired: by['채용'] || 0,
    followup: by['후속미팅'] || 0,
    list: db.prepare('SELECT * FROM outcomes WHERE event=? ORDER BY at DESC').all(event),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

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

        if (p === '/api/events' && req.method === 'POST')
          return json(res, 201, { id: createEvent(db, await body(req)) });

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)$/))) {
          if (req.method === 'GET') return json(res, 200, getEvent(db, m[1]));
          if (req.method === 'DELETE') {
            db.prepare('DELETE FROM events WHERE id=?').run(m[1]);
            return json(res, 200, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/teams$/)) && req.method === 'POST')
          return json(res, 201, { id: joinTeam(db, m[1], await body(req)) });

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/board$/)))
          return json(res, 200, board(db, m[1]));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/sponsors$/)) && req.method === 'POST') {
          const b = await body(req);
          db.prepare('INSERT INTO sponsors(event,name,kind,amount,note) VALUES(?,?,?,?,?)')
            .run(m[1], b.name, b.kind || '현금', +b.amount || 0, b.note || '');
          return json(res, 201, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/outcomes$/))) {
          if (req.method === 'GET') return json(res, 200, outcomes(db, m[1]));
          if (req.method === 'POST') {
            const b = await body(req);
            db.prepare('INSERT INTO outcomes(event,team,kind,who,note) VALUES(?,?,?,?,?)')
              .run(m[1], b.team || null, b.kind, b.who || '', b.note || '');
            return json(res, 201, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/extend$/)) && req.method === 'POST') {
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
        if ((m = p.match(/^\/api\/teams\/(\d+)\/submit$/)) && req.method === 'POST') {
          submit(db, +m[1], await body(req));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/score$/)) && req.method === 'POST') {
          score(db, +m[1], await body(req));
          return json(res, 200, { ok: true });
        }
        if (p === '/api/health') return json(res, 200, {
          ok: true, events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
          teams: db.prepare('SELECT COUNT(*) c FROM teams').get().c,
        });
        throw new HttpError(404, '없는 주소입니다');
      }

      /* 공개 링크. /e/<대회id> 는 화면 파일을 그대로 내려보내고, 화면이 주소를 보고
         읽기 전용으로 그린다. 서버에 화면을 하나 더 두지 않는 게 요점이다. */
      const pub = p.match(/^\/e\/[a-z0-9]+$/);

      /* #region reuse:static — 경로 탈출 방지 + MIME + 스트림. 그대로 복사해 쓴다 */
      const f = path.join(ROOT, (p === '/' || pub) ? 'hack-on.html' : decodeURIComponent(p));
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

  const ev = createEvent(db, { title: '첫 대회', host: '유재원', starts: '2026-10-01', prize: 1000000 });
  ok(getEvent(db, ev).title === '첫 대회', '대회 개설');

  let bad = false;
  try { createEvent(db, { title: 'x', rubric: [{ key: 'a', label: 'a', weight: 50 }] }); }
  catch { bad = true; }
  ok(bad, '배점 합이 100 이 아니면 막는다');

  const t1 = joinTeam(db, ev, { name: '가팀' });
  const t2 = joinTeam(db, ev, { name: '나팀' });
  bad = false; try { joinTeam(db, ev, { name: '가팀' }); } catch { bad = true; }
  ok(bad, '같은 팀 이름은 못 넣는다');

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
  const ev2 = createEvent(db, { title: '신청폼시험' });
  const s1 = joinTeam(db, ev2, { name: '다팀', role: '기획', solo: true, found: '캠퍼스픽' });
  joinTeam(db, ev2, { name: '라팀', role: '만들기', found: '캠퍼스픽' });
  joinTeam(db, ev2, { name: '마팀' });
  ok(board(db, ev2).rows.find(r => r.id === s1).role === '기획', '신청 칸이 저장된다');
  const o0 = outcomes(db, ev2);
  ok(o0.solo === 1, '혼자 온 사람이 세어진다 (' + o0.solo + ')');
  ok(o0.found[0].k === '캠퍼스픽' && o0.found[0].c === 2,
     '유입 경로가 많은 순으로 집계된다 (' + JSON.stringify(o0.found) + ')');

  // 마감 — 지났으면 서버가 막고, 미루면 다시 받는다
  const past = createEvent(db, { title: '마감지남', due: '2020-01-01T10:00' });
  const pt = joinTeam(db, past, { name: '늦은팀' });
  bad = false; try { submit(db, pt, { url: 'x' }); } catch { bad = true; }
  ok(bad, '마감이 지나면 제출을 막는다');
  db.prepare('UPDATE events SET due=? WHERE id=?').run('2099-01-01T10:00', past);
  submit(db, pt, { url: 'https://example.com/late' });
  ok(!!db.prepare('SELECT url FROM submissions WHERE team=?').get(pt), '마감을 미루면 다시 받는다');

  db.prepare('INSERT INTO outcomes(event,team,kind,who) VALUES(?,?,?,?)').run(ev, t1, '면접', '어느회사');
  const o = outcomes(db, ev);
  ok(o.finishRate === 50, '완주율은 제출한 팀 비율 (' + o.finishRate + ')');
  ok(o.interview === 1, '면접 연결 수가 잡힌다');

  db.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });
  console.log(`점검 통과 — ${n}가지`);
}

/* ───────────────────── 실행 ───────────────────── */
if (require.main === module) {
  if (process.argv.includes('--test')) { selftest(); process.exit(0); }
  const db = open(DBFILE);
  http.createServer(routes(db)).listen(PORT, () => {
    console.log(`HACK:ON  →  http://localhost:${PORT}`);
  });
}
module.exports = { open, createEvent, joinTeam, submit, score, board, outcomes };
