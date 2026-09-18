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

/* 카카오 로그인. 키가 없으면 통째로 꺼지고 지금처럼 열쇠로만 돈다.
   키를 넣는 순간 켜진다 — 있는 사람은 로그인하고, 없는 사람은 열쇠를 그대로 쓴다.
   닉네임만 받는다. 이메일을 받으면 비즈 앱 심사가 붙어서 바로 못 쓴다. */
/* ─────────────────────────────────────────────────────────────
   구하기 표. 늘리거나 고칠 곳은 여기 하나다.

   min·max 는 그 창구가 대체로 감당하는 인원이다.
   why 는 '왜 여기냐', check 는 '전화하기 전에 확인할 것'.
   빈자리나 가격을 우리가 알 수는 없다. 어디에 물어보면 되는지만 준다.
   2026-09 기준. 창구는 바뀔 수 있으니 안 열리면 이름으로 검색하면 된다. */
const PLACES = [
  { name: '서울시 공공서비스예약', where: '서울 전역', min: 15, max: 200,
    cost: '무료~저렴', at: 'yeyak.seoul.go.kr',
    why: '시·구 시설을 한 곳에서 예약한다. 개인도 신청할 수 있고 제일 싸다',
    check: '주말·공휴일에 여는지, 전기 콘센트를 몇 개까지 쓸 수 있는지' },
  { name: '자치구 청년센터 · 무중력지대', where: '서울 자치구별', min: 15, max: 60,
    cost: '무료~저렴', at: '구청 청년정책과 또는 센터에 직접',
    why: '청년 대상 행사면 가장 잘 빌려준다. 우리 참가자 대부분이 해당된다',
    check: '참가자 나이 조건이 붙는지, 대관 신청을 며칠 전까지 받는지' },
  { name: '대학 창업지원단 · 학생회관', where: '소속 학교', min: 20, max: 150,
    cost: '대체로 무료', at: '학교 창업지원단 · 학과 사무실',
    why: '학생이거나 동문이면 가장 싸고 빠르다. 주말 개방도 잘 된다',
    check: '외부인이 몇 명까지 들어올 수 있는지, 야간에 건물이 잠기는지' },
  { name: '서울창업허브 공덕', where: '서울 마포', min: 30, max: 150,
    cost: '무료~저렴', at: 'seoulstartuphub.com',
    why: '창업·기술 행사를 위해 만든 공간이라 콘센트와 와이파이가 이미 맞춰져 있다',
    check: '대관 신청 마감이 몇 주 전인지' },
  { name: '디캠프 프론트원', where: '서울 마포', min: 30, max: 200,
    cost: '심사 후 지원', at: 'dcamp.kr',
    why: '스타트업 행사에 공간을 내준다. 규모가 커지면 여기부터 본다',
    check: '행사 성격 심사가 있는지, 신청에서 확정까지 며칠 걸리는지' },
  { name: '공유오피스 주말 대관', where: '서울 전역', min: 20, max: 120,
    cost: '유료', at: '스파크플러스 · 패스트파이브 등에 직접 문의',
    why: '돈은 들지만 확실하다. 협찬금이 잡혔을 때 쓴다',
    check: '주말에 건물 출입이 되는지, 시간당인지 하루당인지' },
  { name: '카페 · 스터디룸 통대관', where: '어디나', min: 6, max: 25,
    cost: '유료(저렴)', at: '가게에 직접',
    why: '10명 안팎 첫 회차라면 이게 제일 빠르다. 심사도 그 자리에서 한다',
    check: '콘센트 자리 수, 소음, 노트북 오래 써도 되는지' },
];

/* 사람. 여기는 창구가 없다 - 명부를 파는 곳도 없고, 있어도 안 쓴다.
   대신 '어디에 있는 사람인지'와 '뭐라고 써서 보낼지'를 준다. */
const PEOPLE = [
  /* 제일 먼저 뚫어야 하는데 앱에 창구가 없던 자리다.
     돈을 달라고 하면 거절당한다 - 적선을 부탁하는 모양이 되기 때문이다.
     "실무자 한 분의 세 시간"을 달라고 하면 온다. 회사가 내주는 것이 있고
     가져가는 것이 있으면 그건 후원이 아니라 거래다. */
  { role: '협찬사 담당자', per: 0, base: 3,
    who: '개발 도구 회사의 국내 담당자 · 구청 청년정책과 · 대학 창업지원단 · 지역 코워킹 스페이스',
    why: '현금 대신 실무자 세 시간을 먼저 부탁한다. 그 한 분이 심사위원이자 사후 지원 멘토가 되고, '
       + '회사는 자기 도구를 실제로 써 본 팀의 후기를 그날 안에 가져간다. '
       + '세 곳에 보내 한 곳이 답하면 성공이다',
    when: '6주 전. 회사 예산은 분기로 잡혀서, 늦으면 돈이 없어서가 아니라 순서가 지나서 거절당한다' },
  { role: '심사위원', per: 10, base: 3,
    who: '협찬사 실무자 · 주최 기관 담당자 · 지역 창업지원단 멘토 · 지난 회차 수상자',
    why: '협찬사 실무자가 제일 잘 온다. 자기 회사 크레딧을 쓴 결과를 직접 보는 자리라서 그렇다',
    when: '3주 전' },
  { role: '사전 교실 강사', per: 0, base: 1,
    who: '참가 예정자 중 먼저 해 본 사람 · 개발자 모임 발표자 · 온라인 강의 강사',
    why: '대회 전에 두 시간만 가르쳐도 완주율이 눈에 띄게 달라진다. 잘 가르치는 사람보다 그날 올 사람이 낫다',
    when: '4주 전' },
  { role: '현장 스태프', per: 12, base: 2,
    who: '친구 · 동아리 · 지난 회차 참가자',
    why: '등록 데스크와 시간 관리만 해도 한 명은 있어야 한다. 없으면 주최자가 아무것도 못 본다',
    when: '2주 전' },
  { role: '사후 지원 멘토', per: 4, base: 1,
    who: '협찬사 실무자 · 현업 개발자 · 창업지원단 멘토',
    why: '끝나고 2주 안에 팀을 한 번 봐 주는 사람. 이게 우리가 다른 곳과 다른 유일한 지점이다',
    when: '행사 전에. 끝나고 정하면 아무도 안 한다' },
  { role: '운영 대행', per: 0, base: 0,
    who: '이벤트 대행사 · 대학 동아리',
    why: '스무 명 규모에는 부르지 마세요. 공공기관 해커톤 대행료가 수천만 원부터 시작합니다. '
       + '그 돈이면 스태프 세 명을 쓰고 상금을 올리는 게 낫습니다',
    when: '참가 100명이 넘고 예산이 따로 잡혔을 때만' },
];

/** 주소는 http(s) 만 받는다.
    javascript: 나 data: 를 그대로 href 에 넣으면, 그 대회 공개 페이지를 여는
    모든 사람의 브라우저에서 돈다. 화면에서 막는 것만으로는 부족하다 - 여기서 막는다. */
const webUrl = v => {
  const s = String(v || '').trim().slice(0, 400);
  return /^https?:\/\//i.test(s) ? s : '';
};

/* ── 진행 순서 표준 ──────────────────────────────────
   MLH Run of Show 와 국내 해커톤 공고에서 겹치는 것만 남겼다.
   숫자를 고칠 일이 있으면 여기 하나만 고친다. */
const PLAN_RULE = {
  open: 30,      // 등록·개회. 이걸 넘기면 만드는 시간을 깎아 먹는다
  idea: 60,      // 주제 안내와 아이디어 발표
  team: 30,      // 팀 짜기. 국내외 가이드가 공통으로 최소 30분을 준다
  prep: 30,      // 제출 마감 ~ 발표 사이 버퍼. 이게 없으면 발표가 통째로 무너진다
  perTeam: 7,    // 발표 5분 + 팀 바꾸는 데 2분
  judge: 30,     // 심사 합의
  award: 20,     // 시상·마무리
  lunch: 60,
};

const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':'
              + String(m % 60).padStart(2, '0');
const mins = t => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};

/* 대회 유형. 빈 화면을 주면 그대로 나간다 - 고를 것을 주고 채워 준다. */
const KINDS = {
  '당일': { hours: 9, what: '아침에 모여 저녁에 시상까지. 첫 대회는 이걸 권합니다' },
  '무박2일': { hours: 24, what: '밤을 새웁니다. 야식과 잘 자리를 미리 정해 두세요' },
  '온라인 1주': { hours: 0, what: '각자 만들고 마지막 날에만 모여 발표합니다' },
};

/** 시작·끝·팀 수를 넣으면 진행표 초안이 나온다.
    앞에서부터 채우고 뒤(발표·심사·시상)는 끝에서 거꾸로 잡는다 -
    발표 시간을 남는 시간으로 두면 반드시 모자란다. */
function draftPlan(start, end, teams, kind) {
  const R = PLAN_RULE;
  if (kind === '무박2일') return draftOvernight(start, teams);
  if (kind === '온라인 1주') return draftOnline(teams);
  let a = mins(start), z = mins(end);
  if (a === null) a = 10 * 60;
  if (z === null || z <= a) z = a + 9 * 60;
  const n = Math.max(1, +teams || 6);

  const tail = R.award + R.judge + n * R.perTeam + R.prep;
  const rows = [];
  let t = a;
  rows.push({ at: hhmm(t), what: '등록 · 아이스브레이킹' });   t += R.open;
  rows.push({ at: hhmm(t), what: '주제 안내 · 아이디어 발표' }); t += R.idea;
  rows.push({ at: hhmm(t), what: '팀 짜기' });                 t += R.team;

  /* 12시를 지나면 점심을 넣는다. 안 넣으면 그 시간에 절반이 사라진다. */
  if (t <= 12 * 60 && z - tail > 13 * 60) {
    rows.push({ at: hhmm(12 * 60), what: '점심' });
    t = 13 * 60;
  }
  const buildStart = t, buildEnd = z - tail;
  rows.push({ at: hhmm(buildStart), what: '만들기' });
  if (buildEnd - buildStart > 180)
    rows.push({ at: hhmm(buildStart + Math.round((buildEnd - buildStart) / 2)),
                what: '멘토 오피스아워 · 중간 점검' });
  rows.push({ at: hhmm(buildEnd), what: '제출 마감' });
  rows.push({ at: hhmm(buildEnd + R.prep), what: `발표 (${n}팀 · 팀당 5분)` });
  rows.push({ at: hhmm(buildEnd + R.prep + n * R.perTeam), what: '심사' });
  rows.push({ at: hhmm(z - R.award), what: '시상 · 마무리' });
  return { rows, teams: n, tight: buildEnd - buildStart < 120 };
}

/** 무박 2일. 국민대 오픈소스 매뉴얼과 ASCII HACKATHON 진행표를 섞었다. */
function draftOvernight(start, teams) {
  const n = Math.max(1, +teams || 6);
  const rows = [
    { at: start || '18:00', what: '등록 · 저녁' },
    { at: '19:00', what: '아이스브레이킹' },
    { at: '19:30', what: '주제 안내 · 아이디어 발표' },
    { at: '20:30', what: '팀 짜기' },
    { at: '21:00', what: '만들기' },
    { at: '01:00', what: '야식' },
    { at: '08:00', what: '아침 · 중간 점검' },
    { at: '11:00', what: '제출 마감' },
    { at: '11:30', what: `발표 (${n}팀 · 팀당 5분)` },
    { at: '13:00', what: '심사' },
    { at: '13:30', what: '시상 · 마무리' },
  ];
  return { rows, teams: n, tight: false, kind: '무박2일' };
}

/** 온라인 한 주. 마지막 날에만 모인다. 시각이 아니라 날짜로 센다. */
function draftOnline(teams) {
  const n = Math.max(1, +teams || 6);
  return {
    rows: [
      { at: '1일차', what: '온라인 개회 · 주제 안내' },
      { at: '1일차', what: '팀 짜기 (온라인)' },
      { at: '2일차', what: '만들기 시작' },
      { at: '4일차', what: '중간 점검 · 멘토 오피스아워' },
      { at: '7일차', what: '제출 마감' },
      { at: '7일차', what: `발표 (${n}팀 · 팀당 5분)` },
      { at: '7일차', what: '심사 · 시상' },
    ],
    teams: n, tight: false, kind: '온라인 1주',
  };
}

/** 고쳐 놓은 진행표가 표준에서 벗어난 곳. 맞으면 빈 배열이라 화면에서 사라진다. */
function planWarn(plan, teams) {
  const R = PLAN_RULE, n = Math.max(1, +teams || 1), out = [];
  const rows = (plan || []).map(r => ({ ...r, m: mins(r.at) })).filter(r => r.m !== null);
  if (!rows.length) return out;
  rows.sort((a, b) => a.m - b.m);
  const gapAfter = i => (i + 1 < rows.length ? rows[i + 1].m - rows[i].m : null);
  const find = re => rows.findIndex(r => re.test(r.what));

  const iTeam = find(/팀 짜기|팀빌딩|팀 빌딩/);
  if (iTeam < 0) out.push('팀 짜기 시간이 없습니다');
  else if (gapAfter(iTeam) !== null && gapAfter(iTeam) < R.team)
    out.push(`팀 짜기가 ${gapAfter(iTeam)}분입니다. ${R.team}분은 주세요`);

  const iDue = find(/제출 마감|코드 프리즈/);
  const iShow = find(/^발표|최종 발표|데모/);   // '아이디어 발표' 에 걸리면 안 된다
  if (iDue >= 0 && iShow > iDue) {
    const buf = rows[iShow].m - rows[iDue].m;
    if (buf < R.prep) out.push(`마감과 발표 사이가 ${buf}분입니다. ${R.prep}분은 두세요`);
  }
  if (iShow >= 0 && gapAfter(iShow) !== null && gapAfter(iShow) < n * R.perTeam)
    out.push(`발표가 ${gapAfter(iShow)}분입니다. ${n}팀이면 ${n * R.perTeam}분 걸립니다`);

  if (rows.length > 1 && rows[1].m - rows[0].m > R.open)
    out.push(`여는 순서가 ${rows[1].m - rows[0].m}분입니다. ${R.open}분을 넘기지 마세요`);

  const iJudge = find(/심사/);
  if (iJudge >= 0 && gapAfter(iJudge) !== null && gapAfter(iJudge) < R.judge)
    out.push(`심사가 ${gapAfter(iJudge)}분입니다. ${R.judge}분은 주세요`);
  return out;
}

/* ── 이어가기 ───────────────────────────────────────
   2주·6주·12주. 조사에서 참가자가 가장 원한 것이 '정기 체크인'이었고,
   해커톤 코드의 3분의 1만 재사용된다는 숫자가 이 기능의 근거다. */
const WEEKS = [2, 6, 12];

function follow(db, event, admin) {
  const e = db.prepare('SELECT ends FROM events WHERE id=?').get(event);
  const base = e ? new Date(e.ends) : new Date();
  const teams = db.prepare(`SELECT t.id, t.name, s.url FROM teams t
                            LEFT JOIN submissions s ON s.team = t.id
                            WHERE t.event=? ORDER BY t.id`).all(event);
  const all = db.prepare(`SELECT c.* FROM checks c JOIN teams t ON t.id=c.team
                          WHERE t.event=?`).all(event);
  const rows = teams.map(t => ({
    id: t.id, name: t.name, url: t.url || '',
    weeks: WEEKS.map(w => {
      const c = all.find(x => x.team === t.id && x.week === w);
      return {
        w, due: ymd(new Date(base.getTime() + w * 7 * 86400000)),
        asked: !!c, alive: !!(c && c.alive), live: !!(c && c.live),
        /* 메모에는 '팀이 깨졌다' 같은 말이 들어간다. 공개 보고서에는 안 싣는다. */
        note: admin && c ? c.note : '',
      };
    }),
  }));
  /* 90일(12주) 생존율. 이게 남이 못 만드는 숫자다 -
     끝나고 세 번 물어본 곳만 이 값을 가질 수 있다. */
  const asked12 = rows.filter(r => r.weeks[2].asked).length;
  const alive12 = rows.filter(r => r.weeks[2].alive).length;
  return {
    weeks: WEEKS, rows,
    teams: rows.length,
    asked12, alive12,
    aliveRate: asked12 ? Math.round(alive12 / asked12 * 1000) / 10 : 0,
    /* 낸 링크가 아직 열리는 팀. '실제로 만들었다' 의 증거는 이거 하나다. */
    liveNow: rows.filter(r => r.weeks.some(w => w.live)).length,
    next: rows.flatMap(r => r.weeks.filter(w => !w.asked && w.due <= today())
      .map(w => ({ team: r.name, id: r.id, w: w.w, due: w.due }))),
  };
}

/** 규모를 넣으면 필요한 것을 되돌려 준다. */
function findHelp(size) {
  const n = Math.max(1, Math.min(2000, +size || 24));
  const teams = Math.max(1, Math.ceil(n / 4));
  return {
    size: n, teams,
    /* 자리·콘센트·와이파이. 현장에서 제일 자주 터지는 셋이다. */
    room: {
      area: Math.ceil(n * 2.2),                 // 한 사람 2.2제곱미터. 노트북 놓고 앉는 기준
      outlets: Math.ceil(n * 0.8),              // 노트북 한 대에 하나. 멀티탭으로 메운다
      wifi: n,                                  // 동시 접속. 폰까지 세면 두 배가 된다
      hours: 8,
    },
    need: PEOPLE.map(r => ({
      ...r,
      count: r.per ? Math.max(r.base, Math.ceil(teams / (r.per / 4))) : r.base,
    })),
    places: PLACES.filter(pl => pl.max >= n && pl.min <= n * 2),
  };
}

/* 등급별로 협찬사에게 하는 약속. PLAN 3장의 표를 그대로 옮겼다.
   등급을 고르면 이 약속이 자동으로 붙고, 하나씩 증빙을 달아 지웠는지 확인한다. */
const TIERS = {
  '크레딧': ['공개 페이지와 결과 보고서에 로고', '참가자에게 도구 안내'],
  '상품':   ['공개 페이지와 결과 보고서에 로고', '부문상 이름에 회사명'],
  '멘토':   ['공개 페이지와 결과 보고서에 로고', '멘토 소개와 세션 시간 배정'],
  '현금':   ['공개 페이지와 결과 보고서에 로고', '과제 1개 출제',
             '심사위원 참여', '성과 보고서', '면접 연결'],
};

/* 작은 칸은 뭉갠다.
   스물네 명짜리 행사에서 '이 경로로 온 팀 1' 은 집계가 아니라 그 사람 이름이다.
   세 건 미만은 숫자를 안 준다 - 비식별 집계라고 부르려면 이게 있어야 한다. */
const MIN_CELL = 3;
function safeCount(rows) {
  const out = [], hidden = [];
  let small = 0;
  for (const r of rows) {
    if (r.c >= MIN_CELL) out.push(r);
    else { small += r.c; hidden.push(r.k); }
  }
  if (small) out.push({ k: `그 밖(${hidden.length}종)`, c: small, merged: true });
  return out;
}

/** 협찬사에게 넘길 한 벌. 개인 식별 정보가 한 칸도 안 들어간다. */
function pack(db, event, admin) {
  const e = getEvent(db, event);
  const o = outcomes(db, event);
  const sp = support(db, event);
  const fw = follow(db, event, admin);
  const rows = db.prepare('SELECT role, found, came, sponsor_ok FROM teams WHERE event=?').all(event);

  const by = f => safeCount(
    Object.entries(rows.reduce((a, r) => {
      const k = (r[f] || '').trim() || '안 적음';
      a[k] = (a[k] || 0) + 1; return a;
    }, {})).map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c));

  const sponsors = db.prepare('SELECT * FROM sponsors WHERE event=? ORDER BY amount DESC').all(event)
    .map(x => {
      const list = TIERS[x.kind] || TIERS['크레딧'];
      const hit = new Set(String(x.done || '').split(',').filter(v => v !== ''));
      return {
        id: x.id, name: x.name, kind: x.kind, amount: x.amount,
        logo: x.logo, link: x.link, proof: x.proof,
        promises: list.map((t, i) => ({ i, text: t, done: hit.has(String(i)) })),
        kept: list.filter((_, i) => hit.has(String(i))).length,
        total: list.length,
      };
    });

  return {
    event: { id: e.id, title: e.title, host: e.host, starts: e.starts, ends: e.ends,
             topic: e.topic, prize: e.prize },
    /* 후원사가 결재에 올리는 숫자. '몇 명이 봤다' 는 안 넣는다. */
    numbers: {
      teams: o.teams, came: o.came, finished: o.finished, finishRate: o.finishRate,
      interview: o.interview, adoption: o.adoption, hired: o.hired,
      promised: sp.promised, keptSupport: sp.done,
      /* 여기가 우리가 파는 숫자다. 다른 곳은 시상식에서 끝나서 이 칸이 아예 없다. */
      asked90: fw.asked12, alive90: fw.alive12, aliveRate: fw.aliveRate, liveDemo: fw.liveNow,
    },
    /* 비식별 집계. 세 건 미만은 뭉쳐서 나간다. */
    mix: { role: by('role'), found: by('found') },
    /* 동의한 사람 수는 운영자만 본다. 협찬사가 이 숫자를 알면 압박이 된다. */
    leads: admin ? rows.filter(r => r.sponsor_ok).length : undefined,
    sponsors,
    /* 협찬사가 원하는 것은 엑셀이 아니라 인재와 유스케이스다.
       완주한 팀 중 위에서 셋. 마감이 지난 뒤에만 나간다. */
    top: closed(e) ? board(db, event, true).rows
      .filter(r => r.url).slice(0, 3)
      .map(r => ({ rank: r.rank, name: r.name, note: r.note, url: r.url,
                   aiuse: r.aiuse, aidrop: r.aidrop,
                   /* 연락해도 되는 팀인지. 동의한 팀만 true 다. */
                   reachable: !!r.sponsor_ok })) : [],
    minCell: MIN_CELL,
  };
}

/* 로고 자동 찾기. 회사 도메인만 넣으면 로고 주소를 만들어 준다.
   Clearbit 로고 API 는 2025-12 에 끝났다. Logo.dev 가 그 자리를 이어받았고 주소 모양이 같다.
   키가 없어도 도는 길을 남겨 둔다 - 그 도메인의 파비콘을 구글이 대신 찾아 준다.
   상표권은 API 가 해결해 주지 않는다. 화면에서 '허락받았는지' 를 묻고 그 답을 남긴다. */
const LOGO_TOKEN = process.env.LOGO_TOKEN || '';
function logoFor(domain) {
  const d = String(domain || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) return { ok: false };
  return {
    ok: true, domain: d,
    url: LOGO_TOKEN
      ? `https://img.logo.dev/${d}?token=${encodeURIComponent(LOGO_TOKEN)}&size=200&format=png`
      : `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
    good: !!LOGO_TOKEN,   // 키가 있으면 진짜 로고, 없으면 파비콘이라 작고 거칠다
  };
}

/* ── 사람 ─────────────────────────────────────────────
   연락처를 사람 열쇠로 바꾼다. 서명 열쇠를 섞어서, 이메일을 안다고 열쇠를 만들 수는 없게 한다. */
function pidOf(db, contact) {
  const c = String(contact || '').trim().toLowerCase().replace(/[\s()-]/g, '');
  if (c.length < 5) return '';
  return crypto.createHmac('sha256', secretOf(db)).update(c).digest('hex').slice(0, 12);
}

/* 처음에 본인이 고르는 실력. 라켓온과 같은 방식이다 -
   맞든 틀리든 시작점이 있어야 팀을 짤 수 있고, 몇 번 나오면 알아서 제자리를 찾는다. */
const LEVELS = ['처음', '해 봤음', '만들 줄 앎', '가르칠 수 있음'];

/* 평가가 적을 때 등급을 그대로 쓰면 안 된다.
   한 명이 5점을 주면 5.0 이 되는데, 스무 팀짜리 대회에서 그건 아무 뜻이 없다.
   평균 쪽으로 끌어당긴다(베이지안 shrinkage). PRIOR_N 건만큼의 '보통' 이 미리 깔려 있는 셈. */
const PRIOR = 3.6, PRIOR_N = 3, SHOW_MIN = 3;
function shrink(vals) {
  const v = vals.filter(x => x > 0);
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    n: v.length,
    /* 세 건 미만은 숫자를 안 보여 준다. 대신 몇 건인지는 알려 준다. */
    show: v.length >= SHOW_MIN,
    score: Math.round((sum + PRIOR * PRIOR_N) / (v.length + PRIOR_N) * 10) / 10,
  };
}

/** 한 사람의 이력. 연락처는 한 칸도 안 나간다.
    실력과 매너를 따로 낸다 - 섞으면 '싫은 사람' 이 '못하는 사람' 이 된다. */
function profile(db, pid) {
  const me = db.prepare('SELECT * FROM people WHERE id=?').get(pid);
  if (!me) throw new HttpError(404, '없는 사람입니다');
  const rows = db.prepare(`SELECT t.id, t.name, t.event, t.came, t.role, e.title, e.ends,
                                  s.url IS NOT NULL AS made
                           FROM teams t JOIN events e ON e.id = t.event
                           LEFT JOIN submissions s ON s.team = t.id
                           WHERE t.person = ? ORDER BY e.ends DESC`).all(pid);
  const past = rows.filter(r => r.ends < today());
  const came = past.filter(r => r.came).length;
  const made = past.filter(r => r.made).length;
  const rt = db.prepare('SELECT skill, manner FROM ratings WHERE target=?').all(pid);

  return {
    id: me.id, handle: me.handle, level: me.level,
    events: past.length,
    /* 완주 - 왔고 결과물을 냈나. 이게 이 사람의 실력에 대한 가장 단단한 증거다. */
    finished: made,
    finishRate: came ? Math.round(made / came * 1000) / 10 : 0,
    /* 매너는 실력과 따로 센다. 신청하고 안 온 것은 못해서가 아니다. */
    noshow: past.length - came,
    skill: shrink(rt.map(r => r.skill)),
    manner: shrink(rt.map(r => r.manner)),
    /* 배치 중 - 몇 번 안 나온 사람은 등급을 안 붙인다. */
    placed: past.length >= 2,
    history: rows.map(r => ({ title: r.title, ends: r.ends, team: r.name,
                              role: r.role, came: !!r.came, made: !!r.made })),
  };
}

/** 이 대회(주최자)의 평판. 참가자가 남긴 평가에서 나온다. */
function hostRep(db, event) {
  const e = db.prepare('SELECT owner FROM events WHERE id=?').get(event);
  if (!e) return null;
  const rows = e.owner
    ? db.prepare(`SELECT r.run, r.worth, r.note FROM event_ratings r
                  JOIN events v ON v.id = r.event WHERE v.owner = ?`).all(e.owner)
    : db.prepare('SELECT run, worth, note FROM event_ratings WHERE event=?').all(event);
  const run = shrink(rows.map(r => r.run)), worth = shrink(rows.map(r => r.worth));
  return {
    n: rows.length, run, worth,
    /* 한 줄 후기는 짧은 것만 몇 개. 누가 썼는지는 안 담는다. */
    notes: rows.filter(r => r.note).slice(-3).map(r => r.note),
  };
}

/* ── 빌릴 수 있는 곳 ────────────────────────────────
   서울시 공공서비스예약 OpenAPI. 크롤링이 아니라 공식으로 열어 둔 것이다.
   키는 data.seoul.go.kr 에서 무료로 받는다. 없으면 sample 로 5건만 온다. */
const SEOUL_KEY = process.env.SEOUL_API_KEY || 'sample';
const SEOUL_API = 'ListPublicReservationInstitution';   // 시설대관. 강당·회의실이 여기 있다

/* 이 API 에는 수용 인원 칸이 없다. 소분류로 어림한다.
   숫자가 설명글에 적혀 있으면 그쪽을 쓴다 - 어림은 어림이라고 화면에 적는다. */
const ROOM_SIZE = {
  '강당': [80, 400], '체육관': [50, 300], '다목적실': [20, 150], '다목적홀': [30, 200],
  '세미나실': [15, 80], '회의실': [8, 40], '교육장': [20, 100], '강의실': [20, 60],
  '공연장': [50, 300], '전시실': [30, 200],
};
const ROOM_OK = Object.keys(ROOM_SIZE);

/* 하루에 한 번만 받아 온다. 목록이 자주 바뀌지 않고, 남의 서버를 두드릴 이유도 없다. */
let venueCache = { at: 0, rows: [] };
const VENUE_TTL = 6 * 3600 * 1000;

function parseCap(txt) {
  const m = String(txt || '').replace(/\s/g, '')
    .match(/(?:수용인원|정원|최대인원)[^0-9]{0,6}(\d{1,4})/);
  const n = m ? +m[1] : 0;
  return (n >= 5 && n <= 5000) ? n : 0;
}

async function fetchVenues() {
  if (Date.now() - venueCache.at < VENUE_TTL && venueCache.rows.length) return venueCache.rows;
  const per = SEOUL_KEY === 'sample' ? 5 : 1000;
  const out = [];
  for (let start = 1; start <= (SEOUL_KEY === 'sample' ? 1 : 1001); start += per) {
    const u = `http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/json/${SEOUL_API}`
            + `/${start}/${start + per - 1}/`;
    let d;
    /* 남의 서버다. 안 뜨면 6초에 포기한다 - 이것 때문에 화면이 멈추면 안 된다. */
    try { d = await (await fetch(u, { signal: AbortSignal.timeout(6000) })).json(); }
    catch { break; }
    const body = d[SEOUL_API];
    if (!body || !body.row) break;
    out.push(...body.row);
    if (out.length >= (body.list_total_count || 0)) break;
  }
  const rows = out
    .filter(r => ROOM_OK.includes(r.MINCLASSNM))
    .map(r => {
      const found = parseCap(r.DTLCONT);
      const [lo, hi] = ROOM_SIZE[r.MINCLASSNM];
      return {
        id: r.SVCID, name: r.SVCNM, place: r.PLACENM, area: r.AREANM,
        kind: r.MINCLASSNM, pay: r.PAYATNM, state: r.SVCSTATNM,
        tel: r.TELNO, url: r.SVCURL,
        hours: (r.V_MIN && r.V_MAX) ? `${r.V_MIN}~${r.V_MAX}` : '',
        open: (r.RCPTBGNDT || '').slice(0, 10), close: (r.RCPTENDDT || '').slice(0, 10),
        cap: found || hi,
        /* 설명글에서 찾은 숫자면 확실하고, 아니면 소분류로 찍은 어림이다. */
        capKnown: !!found, lo, hi,
      };
    });
  venueCache = { at: Date.now(), rows };
  return rows;
}

/** 인원과 지역으로 거른다. 접수 중인 곳이 먼저 온다. */
function pickVenues(rows, size, area) {
  const n = Math.max(1, Math.min(2000, +size || 24));
  return rows
    .filter(r => r.cap >= n && r.lo <= n * 3)
    .filter(r => !area || r.area === area)
    .sort((a, b) => (a.state === '접수중' ? 0 : 1) - (b.state === '접수중' ? 0 : 1)
                 || a.cap - b.cap)
    .slice(0, 40);
}

const KAKAO = process.env.KAKAO_KEY || '';
const KAKAO_SECRET = process.env.KAKAO_SECRET || '';
const SITE = (process.env.SITE || '').replace(/\/$/, '');

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
      listed   INTEGER NOT NULL DEFAULT 0,    -- 첫 화면 목록에 띄울지. 빈 대회가 쌓이면 신뢰가 무너진다
      owner    TEXT NOT NULL DEFAULT '',      -- 연 사람. 이게 있어야 지난 대회가 따라온다
      rubric   TEXT NOT NULL DEFAULT '[]',   -- [{key,label,weight}]
      created  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* 주최자. 로그인은 안 만든다 — 열쇠 하나가 곧 계정이다.
       비밀번호도 메일 인증도 없다. 스포츠 대회 앱 스포넷이 평점 1.3점을 받은 이유가
       전부 로그인이었다. 대신 열쇠를 잃으면 못 찾으니 크게 보여 주고 적으라고 한다. */
    CREATE TABLE IF NOT EXISTS owners(
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL DEFAULT '',
      kakao   TEXT NOT NULL DEFAULT '',   -- 카카오 회원번호. 비면 열쇠만 쓰는 사람
      created TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);

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
      tkey   TEXT NOT NULL DEFAULT '',    -- 팀 열쇠. 대회의 okey 와 같은 것을 팀 단위로 준다
      joined TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event, name)
    );

    /* 사람. 로그인은 없다 - 연락처를 해시로 바꾼 것이 곧 이 사람의 열쇠다.
       같은 연락처로 다른 대회에 나오면 같은 사람으로 이어진다.
       연락처 원문은 여기 안 들어온다. */
    CREATE TABLE IF NOT EXISTS people(
      id      TEXT PRIMARY KEY,
      handle  TEXT NOT NULL DEFAULT '',    -- 보여 줄 이름. 본인이 정한다
      level   TEXT NOT NULL DEFAULT '',    -- 처음에 본인이 고른 실력. 입문|초급|중급|상급
      created TEXT NOT NULL DEFAULT (date('now'))
    );

    /* 사람이 사람을 평가한다. 필수가 아니다.
       같은 대회에 있던 사람만 할 수 있고, 누가 줬는지는 어디에도 안 보여 준다.
       실력과 매너를 따로 받는다 - 섞으면 '싫은 사람' 이 '못하는 사람' 이 된다. */
    CREATE TABLE IF NOT EXISTS ratings(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      giver  TEXT NOT NULL,
      target TEXT NOT NULL,
      skill  INTEGER NOT NULL DEFAULT 0,   -- 1~5. 0 이면 안 매김
      manner INTEGER NOT NULL DEFAULT 0,   -- 1~5
      at     TEXT NOT NULL DEFAULT (date('now')),
      UNIQUE(event, giver, target)
    );

    /* 참가자가 대회를 평가한다. 주최자 평판이 여기서 나온다.
       '이 주최자 대회는 또 나가도 되나' 를 다음 참가자가 알 수 있어야 한다. */
    CREATE TABLE IF NOT EXISTS event_ratings(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      giver  TEXT NOT NULL,
      run    INTEGER NOT NULL DEFAULT 0,   -- 운영이 매끄러웠나 1~5
      worth  INTEGER NOT NULL DEFAULT 0,   -- 배울 게 있었나 1~5
      note   TEXT NOT NULL DEFAULT '',
      at     TEXT NOT NULL DEFAULT (date('now')),
      UNIQUE(event, giver)
    );

    CREATE TABLE IF NOT EXISTS submissions(
      id     INTEGER PRIMARY KEY,
      team   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      url    TEXT NOT NULL DEFAULT '',
      note   TEXT NOT NULL DEFAULT '',
      aiuse  TEXT NOT NULL DEFAULT '',   -- AI 를 어느 단계에서 썼나
      aidrop TEXT NOT NULL DEFAULT '',   -- AI 가 제안한 것 중 버리거나 고친 판단
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

    /* 연락해 본 곳. 혼자 열면 어디에 보냈는지를 잊는다 -
       같은 데 두 번 보내는 것보다 아무 데도 안 보낸 채 날짜가 오는 게 더 흔하다. */
    /* 행사가 끝난 뒤 2·6·12주에 팀에게 물어본 것.
       한 번 물어보고 마는 것과 세 번 물어보는 것의 차이가 곧 완주와 방치의 차이다. */
    CREATE TABLE IF NOT EXISTS checks(
      id    INTEGER PRIMARY KEY,
      team  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      week  INTEGER NOT NULL,               -- 2 | 6 | 12
      alive INTEGER NOT NULL DEFAULT 0,     -- 아직 이어가고 있나
      live  INTEGER NOT NULL DEFAULT 0,     -- 낸 링크가 아직 열리나
      note  TEXT NOT NULL DEFAULT '',
      at    TEXT NOT NULL DEFAULT (date('now')),
      UNIQUE(team, week)
    );

    CREATE TABLE IF NOT EXISTS leads(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      kind   TEXT NOT NULL DEFAULT '장소',   -- 장소 | 심사위원 | 강사 | 스태프 | 멘토 | 협찬
      name   TEXT NOT NULL,
      how    TEXT NOT NULL DEFAULT '',       -- 어디로 연락했나
      state  TEXT NOT NULL DEFAULT '보냄',   -- 보냄 | 답장 | 확정 | 거절
      note   TEXT NOT NULL DEFAULT '',
      at     TEXT NOT NULL DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS sponsors(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      kind   TEXT NOT NULL DEFAULT '현금',   -- 현금 | 크레딧 | 상품 | 멘토
      amount INTEGER NOT NULL DEFAULT 0,
      note   TEXT NOT NULL DEFAULT '',
      logo   TEXT NOT NULL DEFAULT '',   -- 로고 이미지 주소. 협찬사에게 돌려주는 실물
      link   TEXT NOT NULL DEFAULT '',   -- 눌렀을 때 갈 곳. 비면 안 눌린다
      /* 약정과 증빙. 이게 없으면 '로고 걸어 드렸습니다' 를 증명할 방법이 없다.
         done 은 약속 번호를 쉼표로 이어 붙인 것이다 - 표 하나를 더 만들 만한 일이 아니다. */
      proof  TEXT NOT NULL DEFAULT '',   -- 증빙 주소(사진·화면·게시글)
      done   TEXT NOT NULL DEFAULT ''    -- 지킨 약속 번호. 예 '0,2'
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

    /* 빈자리 판. 운영자가 필요한 자리를 올린다 - 장소·심사·상품·멘토·간식 (PLAN.md §API).
       kind 는 화면이 아이콘을 붙이는 데 쓴다. */
    CREATE TABLE IF NOT EXISTS needs(
      id      INTEGER PRIMARY KEY,
      event   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      kind    TEXT NOT NULL DEFAULT 'other',   -- venue|judge|prize|mentor|snack|other
      label   TEXT NOT NULL,
      qty     INTEGER NOT NULL DEFAULT 1,
      note    TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* 공개 장부. 누구나 자리를 맡겠다고 신청하고(pending), 운영자가 확인하면(ok·done)
       이름이 공개 장부에 남는다. contact 는 운영자만 보려고 저장한다 - 공개 응답에 절대 안 실린다. */
    CREATE TABLE IF NOT EXISTS pledges(
      id      INTEGER PRIMARY KEY,
      need    INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
      event   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      org     TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      note    TEXT NOT NULL DEFAULT '',
      status  TEXT NOT NULL DEFAULT 'pending',   -- pending|ok|done|no
      created TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* 2주 뒤 도구 확인. 한 팀의 답은 한 칸 - 다시 쓰면 덮어쓴다.
       요약(followup-summary)에는 팀 이름도 연락처도 메모도 안 나간다. */
    CREATE TABLE IF NOT EXISTS followups(
      id          INTEGER PRIMARY KEY,
      event       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      tool        TEXT NOT NULL DEFAULT '',
      still_using INTEGER NOT NULL DEFAULT 0,   -- 1|0
      note        TEXT NOT NULL DEFAULT '',
      created     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event, team)
    );
  `);
  /* 이미 쓰던 DB 에도 칸을 붙인다. 있으면 에러가 나는데 그건 그냥 넘긴다. */
  try { db.exec("ALTER TABLE events ADD COLUMN due TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE events ADD COLUMN opened INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN okey TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN plan TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec('ALTER TABLE events ADD COLUMN listed INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE owners ADD COLUMN kakao TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE sponsors ADD COLUMN logo TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE sponsors ADD COLUMN link TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE sponsors ADD COLUMN proof TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE sponsors ADD COLUMN done TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN sponsor_ok INTEGER NOT NULL DEFAULT 0'); } catch {}
  /* 협찬사 제공 동의를 한 시각. 동의 여부(sponsor_ok)와 함께 남겨 언제 동의했는지 보인다. 예전 배포판에 이미 있던 칸이다. */
  try { db.exec("ALTER TABLE teams ADD COLUMN share TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 예전 배포판에서 share 로만 동의를 남긴 참가자도 크레딧 명단(sponsor_ok)에 들어가게 옮긴다. */
  try { db.exec("UPDATE teams SET sponsor_ok=1 WHERE share<>'' AND sponsor_ok=0"); } catch {}
  try { db.exec("ALTER TABLE teams ADD COLUMN tkey TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN wifi TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE teams ADD COLUMN person TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN notice TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN notice_at TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE teams ADD COLUMN members TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN owner TEXT NOT NULL DEFAULT ''"); } catch {}
  for (const c of ['aiuse', 'aidrop'])
    try { db.exec(`ALTER TABLE submissions ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN photo INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN size INTEGER NOT NULL DEFAULT 1'); } catch {}
  for (const c of ['role', 'found', 'note', 'agreed', 'came', 'want'])
    try { db.exec(`ALTER TABLE teams ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN solo INTEGER NOT NULL DEFAULT 0'); } catch {}
  /* 열쇠가 없던 시절의 팀에도 열쇠를 하나씩 채워 둔다.
     빈 열쇠를 그냥 두면 '열쇠가 비면 아무나' 라는 구멍이 남는다.
     이 팀들의 브라우저에는 열쇠가 없지만, 연락처를 준 팀은 연락처로,
     아닌 팀은 운영자가 고칠 수 있다 - 여는 쪽이 아니라 잠그는 쪽으로 틀린다. */
  try {
    const 빈것 = db.prepare("SELECT id FROM teams WHERE tkey=''").all();
    const 채움 = db.prepare('UPDATE teams SET tkey=? WHERE id=?');
    for (const r of 빈것) 채움.run(crypto.randomBytes(5).toString('hex'), r.id);
  } catch {}
  return db;
}
/* #endregion reuse:db-open */

const nid = () => crypto.randomBytes(4).toString('hex');

/* ── 운영 매뉴얼 화면 ──────────────────────────────────
   GUIDE.md 가 실제로 쓰는 것만 만든다 — 제목, 목록, 번호 목록, 표, 굵게, 인용.
   마크다운 라이브러리를 안 붙이는 이유는 의존성 0 규칙 때문이고,
   붙일 만큼 문법을 많이 쓰지도 않는다. 문서가 새 문법을 쓰기 시작하면 여기에 한 줄 더 넣는다. */
const mdEsc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
/* 굵게만 살린다. 링크는 살리지 않는다 - 매뉴얼 안의 주소는 눌러서 나가라는 뜻이 아니라 출처 표기다. */
const mdInline = s => mdEsc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

function mdToHtml(md) {
  const out = [];
  let list = null;          // 'ul' | 'ol' | null
  let table = null;         // 모으는 중인 표의 줄들
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => {
    if (!table) return;
    /* 두 번째 줄은 |---|---| 구분선이라 버린다. 첫 줄이 머리다. */
    const rows = table.filter(r => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(r));
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
    out.push('<div class="scroll"><table>');
    rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      out.push('<tr>' + cells(r).map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>');
    });
    out.push('</table></div>');
    table = null;
  };
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); (table = table || []).push(line.trim()); continue; }
    closeTable();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length} id="${slug(h[2])}">${mdInline(h[2])}</h${h[1].length}>`); continue; }
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
              out.push(`<li>${mdInline(li[1])}</li>`); continue; }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
              out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    closeList();
    /* 가로줄. 안 잡으면 --- 가 그대로 글자로 남는다. */
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { out.push(`<blockquote>${mdInline(q[1])}</blockquote>`); continue; }
    if (line.trim()) out.push(`<p>${mdInline(line)}</p>`);
  }
  closeList(); closeTable();
  return out.join('\n');
}
/* 제목을 주소로 쓴다. 한글이 그대로 들어가도 되지만 공백과 기호는 뺀다. */
const slug = s => String(s).trim().toLowerCase().replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '');

function manualPage(md) {
  const body = mdToHtml(md);
  /* 목차는 ## 만 모은다. ### 까지 넣으면 목차가 본문만큼 길어진다. */
  const toc = String(md).split(/\r?\n/).filter(l => /^##\s/.test(l))
    .map(l => l.replace(/^##\s+/, ''))
    .map(t => `<a href="#${slug(t)}">${mdEsc(t)}</a>`).join('');
  /* 차례는 제목 아래에 둔다. 위에 두면 무슨 문서인지 모르는 채로 목록부터 읽게 된다. */
  const cut = body.indexOf('</h1>');
  const head = cut < 0 ? '' : body.slice(0, cut + 5);
  const rest = cut < 0 ? body : body.slice(cut + 5);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>운영 매뉴얼 — HACK:ON</title>
<meta name="description" content="해커톤을 처음 여는 사람을 위한 운영 매뉴얼. 준비표부터 끝나고 2주까지.">
<link rel="icon" href="/icon.svg">
<style>
:root{--ink:#141B34;--paper:#F9F7EE;--mute:#5E6D56;--line:#DEDACB;--on:#C96442}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:-apple-system,'Wanted Sans Variable','맑은 고딕',sans-serif;line-height:1.75}
body,h1,h2,h3,h4,p,li,td,th{word-break:keep-all;overflow-wrap:break-word}
.wrap{max-width:44rem;margin:0 auto;padding:0 20px 80px}
.top{position:sticky;top:0;background:rgba(249,247,238,.94);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);margin-bottom:26px}
.top .in{max-width:44rem;margin:0 auto;padding:13px 20px;display:flex;gap:14px;align-items:center}
.top a{color:inherit;text-decoration:none;font-weight:700;font-size:14.5px;opacity:.72;
  white-space:nowrap}
.top a:hover{opacity:1}
.top .now{margin-left:auto;font-size:13px;color:var(--mute);white-space:nowrap}
/* 폰에서는 안내 문구를 뺀다. 두 줄로 깨지면서 메뉴를 밀어낸다. */
@media (max-width:640px){ .top .now{display:none} }
h1{font-size:clamp(27px,4vw,40px);letter-spacing:-.035em;line-height:1.15;margin:30px 0 6px}
h2{font-size:clamp(19px,2.4vw,25px);letter-spacing:-.025em;margin:44px 0 10px;
  padding-top:16px;border-top:1px solid var(--line);scroll-margin-top:64px}
h3{font-size:17px;margin:26px 0 6px;scroll-margin-top:64px}
p,li{font-size:15.5px}
ul,ol{padding-left:22px}li{margin:5px 0}
blockquote{margin:16px 0;padding:11px 16px;border-left:3px solid var(--on);
  background:rgba(201,100,66,.06);border-radius:0 8px 8px 0}
blockquote p{margin:0}
.scroll{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;width:100%;min-width:min(100%,420px);font-size:14.5px}
th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;vertical-align:top}
th{background:rgba(20,27,52,.05);font-weight:700;white-space:nowrap}
.toc{margin:22px 0 8px;padding:16px 18px;border:1px solid var(--line);border-radius:13px;background:#fff}
.toc b{display:block;font-size:13px;color:var(--mute);margin-bottom:9px}
.toc a{display:block;color:inherit;text-decoration:none;font-size:14.5px;font-weight:600;
  padding:4px 0;border-bottom:1px solid rgba(0,0,0,.04)}
.toc a:hover{color:var(--on)}
@media print{.top,.toc{display:none}body{background:#fff}}
</style></head><body>
<div class="top"><div class="in">
  <a href="/">← HACK:ON</a><a href="/app">대회 열기</a>
  <span class="now">인쇄하면 그대로 배포 자료가 됩니다</span>
</div></div>
<div class="wrap">
${head}
<div class="toc"><b>차례</b>${toc}</div>
${rest}
</div></body></html>`;
}

/* 쿠키를 서명하는 열쇠. 서버가 꺼졌다 켜져도 로그인이 유지되게 DB 에 넣어 둔다. */
function secretOf(db) {
  let r = db.prepare("SELECT v FROM meta WHERE k='secret'").get();
  if (!r) {
    const v = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO meta(k,v) VALUES('secret',?)").run(v);
    r = { v };
  }
  return r.v;
}
const sign = (db, id) =>
  id + '.' + crypto.createHmac('sha256', secretOf(db)).update(id).digest('hex').slice(0, 32);
function unsign(db, v) {
  if (!v || v.indexOf('.') < 0) return '';
  const id = v.slice(0, v.lastIndexOf('.'));
  return sign(db, id) === v ? id : '';
}
function cookieOf(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return '';
}

/* 열쇠를 마구 넣어 보는 것을 막는다. 12자 열쇠라도 무한히 시도하면 언젠가 맞는다. */
const tries = new Map();
function tooMany(ip) {
  const now = Date.now(), t = tries.get(ip) || { n: 0, at: now };
  if (now - t.at > 600000) { t.n = 0; t.at = now; }
  t.n++; tries.set(ip, t);
  return t.n > 30;
}

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

/* 심사 기준 두 벌. 대회를 열 때 고른다.

   '만들기' — 하루짜리 해커톤 기본값. 그날 무엇을 만들어 냈는지를 본다.
   '문제해결' — 2026-09-04 서강대 「모두의 창업 2기」 설명회에서 밝힌 실제 배점을 옮긴 것.
     사업 추진 의지 및 역량 50 · 실현 가능성 및 구체성 30 · 사회적·경제적 기여 20.
     담당자 말 그대로: "단순히 아이디어가 좋다를 보는 것이 아니고,
     이 팀이 실제로 끝까지 실행할 준비가 되어 있는가를 핵심적으로 본다."
     대회가 창업·지원사업으로 이어지는 자리라면 이쪽이 맞다. */
const RUBRICS = {
  '만들기': {
    what: '그날 무엇을 만들어 냈는지를 봅니다. 하루짜리 해커톤 기본값입니다.',
    rows: [
      { key: 'idea', label: '독창성', weight: 30 },
      { key: 'make', label: '완성도', weight: 30 },
      { key: 'use', label: '실용성', weight: 25 },
      { key: 'tell', label: '전달력', weight: 15 },
    ],
  },
  '문제해결': {
    what: '끝까지 갈 팀인지를 봅니다. 창업 지원 사업의 실제 배점을 옮겼습니다.',
    rows: [
      { key: 'will', label: '끝까지 갈 준비', weight: 40 },
      { key: 'real', label: '실제로 돌아가나', weight: 30 },
      { key: 'who', label: '누가 쓸지 정해졌나', weight: 20 },
      { key: 'tell', label: '전달력', weight: 10 },
    ],
  },
};
const DEFAULT_RUBRIC = RUBRICS['만들기'].rows;

/** 대회를 만든 뒤 나머지를 채운다. 처음부터 다 물으면 만들다가 그만둔다. */
const EDITABLE = ['title', 'host', 'topic', 'starts', 'ends', 'prize', 'cap', 'due', 'wifi'];
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
    이미 적은 것을 덮어쓰면 안 된다.

    누가 손댈 수 있나. 셋 중 하나면 된다.
      1) 운영자
      2) 팀 열쇠를 가진 브라우저 — 신청한 그 사람이다
      3) 그 팀 연락처를 아는 사람 — 기기를 바꿨을 때의 복구 경로

    전에는 아무 검사도 없었다. 팀 번호가 1, 2, 3... 이라
    지나가던 사람이 남의 빈 팀을 자기 연락처로 선점하면, 연락처는 한 번만 쓰는 칸이라
    진짜 참가자가 자기 칸을 영영 못 채웠다. */
function moreTeam(db, id, b, can) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(id);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  const pid = pidOf(db, b.contact);
  const tkey = String((can && can.tkey) || b.tkey || '');
  const owns = !!((can && can.admin)
    || (t.tkey && tkey && tkey === t.tkey)
    || (t.person && pid && pid === t.person));
  const set = [], val = [];
  /* 채울 것이 하나라도 있으면 주인이어야 한다.
     '빈 칸만 채운다' 는 규칙은 덮어쓰기를 막을 뿐, 빈 칸을 남이 채우는 것은 못 막는다.
     연락처는 한 번 쓰면 끝이라 남이 먼저 채우면 진짜 참가자가 밀려난다. */
  const 채울것 = ['contact', 'role', 'found', 'note', 'want']
    .some(k => b[k] !== undefined && String(b[k]).trim() && !t[k])
    || (b.solo !== undefined && !t.solo && !!b.solo)
    || (b.photo !== undefined && !t.photo && !!b.photo);
  if (채울것 && !owns)
    throw new HttpError(403, '이 팀은 신청한 분이나 운영자만 고칠 수 있습니다');
  for (const k of ['contact', 'role', 'found', 'note', 'want']) {
    if (b[k] === undefined || !String(b[k]).trim()) continue;
    if (t[k]) continue;                       // 이미 적힌 것은 안 건드린다
    set.push(`${k}=?`); val.push(String(b[k]).slice(0, 300));
  }
  if (b.solo !== undefined && !t.solo) { set.push('solo=?'); val.push(b.solo ? 1 : 0); }
  if (b.photo !== undefined && !t.photo) { set.push('photo=?'); val.push(b.photo ? 1 : 0); }
  /* 협찬사에게 연락처를 넘겨도 되는지. 개인정보보호법 17조상 이게 없으면 못 넘긴다.
     끄는 것은 언제든 되게 둔다 - 동의는 뺄 수 있어야 동의다.
     단 본인이어야 한다. 팀 번호가 1, 2, 3... 이라 이걸 안 막으면 지나가던 사람이
     남의 동의를 켤 수 있고, 그러면 그 사람 연락처가 /leads 로 협찬사에게 넘어간다.
     동의를 남이 대신 켜 주는 것은 동의가 아니다.

     '바뀔 때만' 본다. 화면의 폼은 체크칸을 늘 같이 보내기 때문에,
     안 바뀌는 값까지 막으면 연락처를 아직 안 준 팀은 저장 자체가 통째로 막힌다.
     (완주 테스트가 이걸 잡았다 - 처음엔 값이 같아도 막게 짰었다.) */
  if (b.sponsor_ok !== undefined && !!b.sponsor_ok !== !!t.sponsor_ok) {
    if (!owns) throw new HttpError(403, '협찬사 제공 동의는 본인만 바꿀 수 있습니다');
    set.push('sponsor_ok=?'); val.push(b.sponsor_ok ? 1 : 0);
  }
  /* 인원은 바뀌는 값이라 덮어쓰기를 허용한다. 한 명 들어오면 고쳐야 한다.
     주인 확인은 setSeats 와 같아야 한다 - 안 그러면 거기서 막은 정원 변경이 이 길로 그냥 된다. */
  if (b.size !== undefined) {
    const size = Math.min(Math.max(+b.size || 1, 1), 9);
    if (size !== t.size) {
      if (!owns) throw new HttpError(403, '정원을 바꾸는 것은 그 팀만 할 수 있습니다');
      set.push('size=?'); val.push(size);
    }
  }
  if (set.length)
    db.prepare(`UPDATE teams SET ${set.join(',')} WHERE id=?`).run(...val, id);

  /* 연락처는 신청 다음 칸에서 들어온다(첫 칸에서는 일부러 안 묻는다).
     그래서 사람으로 이어 붙이는 것도 여기서 한 번 더 해야 한다.
     '채울 게 없으면 일찍 반환' 뒤에 두었다가, 이미 다 채운 팀은 영영 프로필이 안 생겼다.
     그래서 반환보다 앞에 둔다. */
  const now = db.prepare('SELECT name, contact, person FROM teams WHERE id=?').get(id);
  if (!now.person && now.contact) {
    const pid = pidOf(db, now.contact);
    if (pid) {
      db.prepare('INSERT OR IGNORE INTO people(id,handle) VALUES(?,?)')
        .run(pid, String(now.name || '').slice(0, 20));
      db.prepare('UPDATE teams SET person=? WHERE id=?').run(pid, id);
    }
  }
  if (LEVELS.includes(b.level) && now.person)
    db.prepare("UPDATE people SET level=? WHERE id=? AND level=''").run(b.level, now.person);
  return { filled: set.length };
}

function createEvent(db, b) {
  if (!b.title) throw new HttpError(400, '대회 이름이 필요합니다');
  const id = b.id || nid();
  const okey = crypto.randomBytes(5).toString('hex');   // 운영자 열쇠. 만든 사람만 받는다
  const rubric = Array.isArray(b.rubric) && b.rubric.length ? b.rubric
    : (RUBRICS[b.rubricKind] || RUBRICS['만들기']).rows;
  const sum = rubric.reduce((a, r) => a + Number(r.weight || 0), 0);
  if (sum !== 100) throw new HttpError(400, `심사 배점 합이 ${sum} 입니다. 100 이어야 합니다`);
  db.prepare(`INSERT INTO events(id,title,host,topic,starts,ends,prize,cap,rubric,due)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title, b.host || '주최자', b.topic || '',
         b.starts || today(), b.ends || b.starts || today(),
         +b.prize || 0, +b.cap || 0, JSON.stringify(rubric), b.due || '');
  /* 연 사람을 붙인다. 열쇠를 안 갖고 왔으면 새로 하나 만들어 준다. */
  let owner = String(b.owner || '').trim();
  if (!owner || !db.prepare('SELECT 1 FROM owners WHERE id=?').get(owner)) {
    owner = crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO owners(id,name) VALUES(?,?)').run(owner, b.host || '');
  } else if (b.host) {
    db.prepare("UPDATE owners SET name=? WHERE id=? AND name=''").run(b.host, owner);
  }
  db.prepare('UPDATE events SET owner=? WHERE id=?').run(owner, id);
  db.prepare('UPDATE events SET okey=?, plan=? WHERE id=?')
    .run(okey, JSON.stringify(Array.isArray(b.plan) && b.plan.length ? b.plan : DEFAULT_PLAN), id);
  return { id, okey, owner };
}

/** 운영자인가. 열쇠는 헤더나 쿼리로 온다. 없으면 손님이다.
    로그인은 안 만든다 — 하루짜리 행사에 계정 관리를 붙이는 건 과하다. */
function isAdmin(db, event, key, owner) {
  const e = db.prepare('SELECT okey, owner FROM events WHERE id=?').get(event);
  if (!e) return false;
  if (!e.okey) return true;          // 열쇠가 생기기 전에 만든 대회는 그대로 열어 둔다
  /* 대회 열쇠는 그 대회 하나만 연다. 주최자 열쇠는 내가 연 것 전부를 연다.
     둘 중 하나만 맞으면 된다 — 대회 하나를 남에게 넘길 때 대회 열쇠만 주면 된다. */
  if (key && key === e.okey) return true;
  return !!owner && !!e.owner && owner === e.owner;
}
const needAdmin = (db, event, key, owner) => {
  if (!isAdmin(db, event, key, owner)) throw new HttpError(403, '운영자 열쇠가 필요합니다');
};

/** 이 사람이 연 대회들과 누적 성적.
    "우리 동아리 해커톤은 끝난 뒤에도 팀의 82퍼센트가 약속된 피드백을 받았다" —
    주최자가 다음 모집에 쓸 수 있는 것은 참가자 수가 아니라 이 숫자다. */
function mine(db, owner) {
  const o = db.prepare('SELECT * FROM owners WHERE id=?').get(owner);
  if (!o) throw new HttpError(404, '없는 열쇠입니다');
  const evs = db.prepare(`SELECT id,title,starts,ends,prize,listed,okey
                          FROM events WHERE owner=? ORDER BY starts DESC`).all(owner);
  let teams = 0, done = 0, promised = 0, kept = 0;
  for (const e of evs) {
    const o2 = outcomes(db, e.id);
    teams += o2.teams; done += o2.finished;
    const sp = support(db, e.id);
    promised += sp.promised; kept += sp.done;
  }
  return {
    owner: o.id, name: o.name, events: evs,
    total: {
      events: evs.length, teams, finished: done,
      finishRate: teams ? Math.round(done / teams * 1000) / 10 : 0,
      promised, kept,
      keptRate: promised ? Math.round(kept / promised * 1000) / 10 : 0,
    },
  };
}

/** 공개 페이지에 붙는 주최자 이력. 지난 대회가 있어야 의미가 생긴다. */
function record(db, event) {
  const e = db.prepare('SELECT owner FROM events WHERE id=?').get(event);
  if (!e || !e.owner) return null;
  const past = db.prepare(`SELECT id FROM events WHERE owner=? AND id<>? AND ends < date('now')`)
    .all(e.owner, event);
  if (!past.length) return null;
  let teams = 0, done = 0, promised = 0, kept = 0;
  for (const r of past) {
    const o = outcomes(db, r.id); teams += o.teams; done += o.finished;
    const sp = support(db, r.id); promised += sp.promised; kept += sp.done;
  }
  return {
    events: past.length, teams,
    finishRate: teams ? Math.round(done / teams * 1000) / 10 : 0,
    keptRate: promised ? Math.round(kept / promised * 1000) / 10 : 0,
    promised,
  };
}

function getEvent(db, id) {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(id);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  delete e.okey;                     // 열쇠는 절대 안 내려보낸다
  delete e.owner;                    // 주최자 열쇠도 안 내려보낸다 — 계정 노릇을 하는 비밀이라 링크만 열어도 새면 통째로 털린다
  e.rubric = JSON.parse(e.rubric);
  try { e.plan = JSON.parse(e.plan || '[]'); } catch { e.plan = []; }
  e.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(id).c;
  e.sponsors = db.prepare('SELECT * FROM sponsors WHERE event=? ORDER BY amount DESC').all(id);
  e.missing = ready(e);
  return e;
}

function joinTeam(db, event, b) {
  const e = getEvent(db, event);
  if (!b.name) throw new HttpError(400, '팀 이름이 필요합니다');
  /* 동의 없이 연락처를 받지 않는다. 화면에서 체크박스를 지워도 여기서 막힌다. */
  if (!b.agree) throw new HttpError(400, '개인정보 수집·이용에 동의해 주세요');
  if (e.cap && e.teams >= e.cap) throw new HttpError(409, '정원이 찼습니다');
  /* 신청 화면은 이메일을 처음부터 받는다 — 확정 안내와 후원사 크레딧이 전부 이메일로 간다.
     꼴이 틀리면 막고, 맞으면 소문자로 다듬어 연락처로 쓴다. 협찬사 제공 동의(share)는 수집 동의와 별개 체크. */
  if (b.email !== undefined) {
    const em = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new HttpError(400, '이메일을 적어 주세요');
    b.contact = em;
  }
  try {
    /* 연락처가 있으면 사람으로 이어 붙인다. 다음 대회에서도 같은 사람으로 이어진다.
       연락처가 없으면 그냥 이 대회에만 있는 팀이다 - 그래도 대회는 돌아간다. */
    const pid = pidOf(db, b.contact);
    if (pid) {
      db.prepare('INSERT OR IGNORE INTO people(id,handle,level) VALUES(?,?,?)')
        .run(pid, String(b.name || '').slice(0, 20), LEVELS.includes(b.level) ? b.level : '');
      if (LEVELS.includes(b.level))
        db.prepare("UPDATE people SET level=? WHERE id=? AND level=''").run(b.level, pid);
    }
    /* 팀 열쇠. 신청한 그 브라우저만 받는다.
       전에는 팀 번호(1, 2, 3...)가 곧 자격증명이었는데, 그건 남이 그냥 찍을 수 있다. */
    const now = new Date().toISOString();
    const r = db.prepare(`INSERT INTO teams(event,name,contact,role,solo,found,note,agreed,photo,
                                            person,size,members,tkey,sponsor_ok,share)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(event, b.name, b.contact || '', b.role || '', b.solo ? 1 : 0,
           b.found || '', b.note || '', now, b.photo ? 1 : 0,
           pid, Math.min(Math.max(+b.size || 1, 1), 9),
           JSON.stringify([{ n: String(b.name || '').slice(0, 20), g: false }]),
           crypto.randomBytes(5).toString('hex'), b.share && b.contact ? 1 : 0, b.share && b.contact ? now : '');
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
  db.prepare(`INSERT INTO submissions(team,url,note,aiuse,aidrop) VALUES(?,?,?,?,?)
              ON CONFLICT(team) DO UPDATE SET url=excluded.url, note=excluded.note,
                aiuse=excluded.aiuse, aidrop=excluded.aidrop, at=datetime('now')`)
    .run(team, b.url || '', b.note || '',
         (b.aiuse || '').slice(0, 500), (b.aidrop || '').slice(0, 500));
}

/** 한 팀이 받은 성적표. 점수 분해와 심사평을 같이 준다.
    운영자가 결과를 공개하기 전에는 그 팀도 못 본다. */
function card(db, team) {
  const t = db.prepare(`SELECT t.id, t.name, t.event, t.size, t.members, t.person,
                               e.opened, e.rubric, e.title
                        FROM teams t JOIN events e ON e.id = t.event WHERE t.id = ?`).get(team);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  /* 자리는 결과 공개와 상관없이 늘 보인다. 팀을 짜는 것은 심사보다 앞의 일이다. */
  const st = { seats: seats(t), person: t.person || '' };
  if (!t.opened) return { opened: false, name: t.name, title: t.title, ...st };
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
    ...st,
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
/** 제출 마감이 지났나. 마감을 안 정했으면 대회 마지막 날을 기준으로 본다.
    이 하나가 '무엇을 보여 줄지' 를 거의 다 정한다. */
/* 공지는 한 시간만 산다. 안 지우면 어제 공지가 오늘 벽에 걸려 있게 된다. */
const NOTICE_LIFE = 3600 * 1000;
function noticeOf(e) {
  if (!e.notice || !e.notice_at) return '';
  return (Date.now() - new Date(e.notice_at).getTime() < NOTICE_LIFE) ? e.notice : '';
}

function closed(e) {
  if (e.due) return new Date(e.due) <= new Date();
  return today() > e.ends;
}

function board(db, event, admin = false) {
  const e = getEvent(db, event);
  const teams = db.prepare(`
    SELECT t.id, t.name, t.contact, t.role, t.solo, t.found, t.note AS apply,
           t.agreed, t.photo, t.came, t.size, t.want,
           s.url, s.note, s.aiuse, s.aidrop
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
    /* 심사평을 남긴 건수. 점수만 넣고 가면 참가자는 '왜 떨어졌는지' 를 영영 모른다.
       설명회에서도 2기부터 피드백 분량 기준을 강화했다고 했다. */
    const words = db.prepare(`SELECT COUNT(*) c FROM reviews
                              WHERE team=? AND (good<>'' OR next<>'')`).get(t.id).c;
    const row = { ...t, score: Math.round(total * 10) / 10, judges: judged.size,
                  words, by: [...judged].sort(), done: !!t.url };
    /* 마감 전에는 제출 링크를 안 내려보낸다.
       먼저 낸 팀의 결과물을 뒤에 내는 팀이 보고 만들 수 있기 때문이다.
       제목과 설명은 그대로 둔다 - 무엇을 만들고 있는지는 서로 알아야 같이 하는 느낌이 난다.
       운영자와 심사위원은 언제든 본다. */
    if (!admin && !closed(e)) { delete row.url; row.hidden = !!t.url; }
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
  /* 마감 전에는 점수도 안 준다. 심사 중에 순위가 보이면 심사위원이 그걸 보고 맞춘다.
     Kaggle 이 public/private 리더보드를 나눈 것과 같은 이유다. */
  if (!admin && !closed(e)) for (const r of rows) { r.score = null; r.rank = null; }
  e.notice = noticeOf(e);
  return { event: e, rows, judges, closed: closed(e) };
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

/** 팀원 자리. 목표 인원에서 채워진 자리를 뺀 것이 빈자리다.
    밖에서 이미 구한 사람은 '게스트' 로 채워 둘 수 있다 - 라켓온의 빈자리 방식이다. */
function seats(t) {
  let mem = [];
  try { mem = JSON.parse(t.members || '[]'); } catch { mem = []; }
  if (!Array.isArray(mem)) mem = [];
  const size = Math.min(Math.max(+t.size || 1, 1), 9);
  return { size, mem: mem.slice(0, size), free: Math.max(0, size - mem.length) };
}

/** 팀원을 넣거나 뺀다. 정원을 넘겨 넣을 수 없다 -
    자리만 잡아 두고 안 채우는 것을 막으려면 정원이 뜻을 가져야 한다.

    누가 손댈 수 있나. 참가자에게는 로그인이 없어서 '링크를 아는 사람' 이 기본 권한인데,
    빼기까지 그렇게 두면 지나가던 사람이 남의 팀원을 지울 수 있다.
      들어가기(add)  - 아무나. 현장에서 걸어와 빈자리에 앉는 게 이 기능의 목적이다.
      빼기·정원 변경 - 그 팀 연락처를 아는 사람이나 운영자만. */
function setSeats(db, id, b, can) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(id);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  /* 운영자이거나, 그 팀 연락처를 아는 사람이거나. 둘 중 하나면 된다.
     연락처 확인은 can 과 무관하다 - 여기서 can 을 같이 묶었다가 검사가 한 번 걸렸다. */
  const owns = !!((can && can.admin)
    || (t.person && b.contact && pidOf(db, b.contact) === t.person));
  if (!owns && (b.remove !== undefined || b.size !== undefined))
    throw new HttpError(403, '팀원을 빼거나 정원을 바꾸는 것은 그 팀만 할 수 있습니다');
  const s0 = seats(t);
  let size = b.size === undefined ? s0.size : Math.min(Math.max(+b.size || 1, 1), 9);
  let mem = s0.mem;
  if (b.add) {
    if (mem.length >= size) throw new HttpError(409, '자리가 다 찼습니다');
    mem = mem.concat([{ n: String(b.add).slice(0, 20), g: !!b.guest }]);
  }
  if (b.remove !== undefined) mem = mem.filter((_, i) => i !== +b.remove);
  if (mem.length > size) size = mem.length;
  db.prepare('UPDATE teams SET size=?, members=? WHERE id=?')
    .run(size, JSON.stringify(mem), id);
  return seats({ size, members: JSON.stringify(mem) });
}

/** 팀 짜기 시간에 쓰는 한 장.
    혼자 온 사람과 자리 남은 팀을 나란히 놓는다.
    연락처는 안 담는다 — 오프라인이라 얼굴 보고 짜면 되고, 그게 더 잘 된다.
    온라인 매칭은 실패한 사례가 많다(팀은 많은데 전부 '비공개·초대 필요'). */
function crew(db, event) {
  const rows = db.prepare(`SELECT id, name, role, solo, size, want, note, members, person
                           FROM teams WHERE event = ? ORDER BY id`).all(event);
  return {
    solo: rows.filter(r => r.solo).map(r => ({
      id: r.id, name: r.name, role: r.role, note: r.note })),
    /* 자리가 남은 팀. 예전에는 '사람을 찾는다고 적은 팀' 만 나왔는데,
       적기 귀찮아서 안 적은 팀이 더 많았다. 빈자리가 있으면 그 자체가 찾는 것이다. */
    looking: rows.map(r => ({ ...r, s: seats(r) }))
      .filter(r => !r.solo && (r.s.free > 0 || r.want))
      .map(r => ({ id: r.id, name: r.name, size: r.s.size, free: r.s.free,
                   mem: r.s.mem, want: r.want, note: r.note })),
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
    /* 아직 안 낸 팀 이름은 마감 한 시간 전부터만 띄운다.
       종일 벽에 '못 낸 사람' 명단이 걸려 있으면 그건 격려가 아니라 망신이다. */
    urgent: !!e.due && new Date(e.due) - new Date() < 3600000,
    waiting: (e.due && new Date(e.due) - new Date() < 3600000 && !closed(e))
      ? rows.filter(r => !r.url).map(r => r.name) : [],
    wifi: e.wifi || '',
    notice: noticeOf(e),
    /* 순위는 마감이 지나고 심사가 시작된 뒤에만 벽에 띄운다.
       그 전에 띄우면 심사위원이 보고 점수를 맞추고, 참가자는 압박만 받는다. */
    ranks: (judged && closed(e))
      ? b.rows.slice(0, 5).map(r => ({ rank: r.rank, name: r.name, score: r.score })) : [],
    crew: crew(db, event),
    /* 협찬사 로고. 금액은 안 보낸다 - 벽에 걸리는 화면이다. */
    sponsors: db.prepare('SELECT name, kind, logo, link FROM sponsors WHERE event=? ORDER BY amount DESC')
                .all(event),
  };
}

/** 심사위원이 보는 것. 남의 점수도 순위도 안 내려보낸다 —
    화면에서 감추는 게 아니라 서버가 안 준다. 심사 중에 순위를 보면 점수가 끌려간다. */
function judgeView(db, event, judge) {
  const e = getEvent(db, event);
  const teams = db.prepare(`SELECT t.id, t.name, s.url, s.note, s.aiuse, s.aidrop
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

/* 날짜를 YYYY-MM-DD 로. toISOString() 은 언제나 UTC 라서 한국 새벽 0~9시에 하루 전을 내놓는다 —
   하필 대회 당일 아침이 그 시간대다. 시간대는 Dockerfile 의 TZ 로 서울에 고정해 둔다. */
const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd();

/** 첫 화면 목록에 올릴 준비가 됐나. 막지는 않고 무엇이 비었는지 알려 준다.
    빈 대회 카드가 쌓이면 목록 전체의 신뢰가 무너진다. */
function ready(e) {
  const miss = [];
  if (!e.host || e.host === '주최자') miss.push('여는 사람');
  if (e.starts === e.ends && e.starts === today()) miss.push('날짜');
  if (!e.due) miss.push('제출 마감');
  if (!(e.plan || []).length) miss.push('진행 순서');
  return miss;
}

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
    due = ymd(new Date(new Date(e.ends).getTime() + 14 * 86400000));
  }
  try {
    db.prepare('INSERT INTO assignments(team,helper,due,note) VALUES(?,?,?,?)')
      .run(+b.team, +b.helper, due, b.note || '');
  } catch { throw new HttpError(409, '이미 짝지어진 조합입니다'); }
  return due;
}

/* ── 빈자리 판 · 공개 장부 · 2주 확인 (PLAN.md §API) ──
   운영자가 필요한 자리를 올리고, 누구나 맡겠다고 신청하고, 운영자가 확인하면
   이름이 공개 장부에 남는다. contact 는 어느 공개 응답에도 실리지 않는다. */
const NEED_KINDS = ['venue', 'judge', 'prize', 'mentor', 'snack', 'other'];
const PLEDGE_STATUS = ['pending', 'ok', 'done', 'no'];
/* 꺾쇠는 저장 전에 뺀다. JSON 응답을 화면이 그대로 그려도 돌지 않게 - esc 를 잊어도 안전하다 */
const plain = (s, n) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, n);

function addNeed(db, event, b) {
  const label = plain(b.label, 100);
  if (!label) throw new HttpError(400, '무슨 자리인지 적어 주세요');
  const qty = Math.min(Math.max(+b.qty || 1, 1), 99);
  const kind = NEED_KINDS.includes(b.kind) ? b.kind : 'other';
  const note = plain(b.note, 300);
  const r = db.prepare('INSERT INTO needs(event,kind,label,qty,note) VALUES(?,?,?,?,?)')
    .run(event, kind, label, qty, note);
  return { id: Number(r.lastInsertRowid), kind, label, qty, note, filled: 0, pledges: [] };
}

function addPledge(db, need, event, b) {
  const name = plain(b.name, 40);
  if (!name) throw new HttpError(400, '이름을 적어 주세요');
  const r = db.prepare('INSERT INTO pledges(need,event,name,org,contact,note) VALUES(?,?,?,?,?,?)')
    .run(need, event, name, plain(b.org, 60), plain(b.contact, 100), plain(b.note, 300));
  return { id: Number(r.lastInsertRowid), status: 'pending' };
}

function setPledge(db, id, b) {
  if (!PLEDGE_STATUS.includes(b.status))
    throw new HttpError(400, '상태는 pending·ok·done·no 중 하나입니다');
  db.prepare('UPDATE pledges SET status=? WHERE id=?').run(b.status, id);
  /* 운영자 전용 응답이라 contact 가 실린다 - 공개 주소가 아니다 */
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
}

/* 공개가 봐도 되는 것만 골라 붙인다. contact 는 이 함수를 거쳐서는 한 번도 나가지 않는다 */
function needsOf(db, event) {
  const pl = db.prepare('SELECT id, need, name, org, status FROM pledges WHERE event=? ORDER BY id')
    .all(event);
  return db.prepare('SELECT * FROM needs WHERE event=? ORDER BY id').all(event)
    .map(n => ({
      id: n.id, kind: n.kind, label: n.label, qty: n.qty, note: n.note,
      filled: pl.filter(p => p.need === n.id && (p.status === 'ok' || p.status === 'done')).length,
      pledges: pl.filter(p => p.need === n.id)
                 .map(p => ({ id: p.id, name: p.name, org: p.org, status: p.status })),
    }));
}

function ledgerOf(db, event) {
  return db.prepare(`SELECT n.kind, n.label, p.name, p.org, p.status, p.created AS at
                     FROM pledges p JOIN needs n ON n.id = p.need
                     WHERE p.event = ? AND p.status IN ('ok','done')
                     ORDER BY n.id, p.id`).all(event);
}

/* 운영자 전용 신청 명단. 장소를 내준 사람에게 연락하려면 연락처가 필요하다.
   공개 주소가 아니라 운영자 열쇠를 확인한 뒤에만 부른다 */
function pledgesOf(db, event) {
  return db.prepare(`SELECT p.id, p.need, n.kind, n.label, p.name, p.org, p.contact, p.note,
                            p.status, p.created
                     FROM pledges p JOIN needs n ON n.id = p.need
                     WHERE p.event = ? ORDER BY n.id, p.id`).all(event);
}

/* 첫 화면 자리 점판용 공개 요약. needsOf 를 거쳐 만들므로 contact 는 애초에 없다 */
function needsSummary(db, event) {
  const kinds = [];
  for (const n of needsOf(db, event)) {
    const pending = n.pledges.filter(p => p.status === 'pending').length;
    const k = kinds.find(x => x.kind === n.kind);
    if (k) { k.qty += n.qty; k.filled += n.filled; k.pending += pending; }
    else kinds.push({ kind: n.kind, qty: n.qty, filled: n.filled, pending });
  }
  return { total: kinds.reduce((s, k) => s + k.qty, 0),
           filled: kinds.reduce((s, k) => s + k.filled, 0),
           pending: kinds.reduce((s, k) => s + k.pending, 0), kinds };
}

/* 팀 열쇠나 신청 때 적은 연락처로만 쓴다. 둘 다 없으면 누구 팀의 답인지 모른다 */
function addFollowup(db, event, b, req) {
  let team = null;
  const tk = String((req && req.headers && req.headers['x-tkey']) || b.tkey || '');
  if (tk) team = db.prepare('SELECT id FROM teams WHERE event=? AND tkey=?').get(event, tk);
  if (!team && b.contact) {
    const pid = pidOf(db, b.contact);
    if (pid) team = db.prepare('SELECT id FROM teams WHERE event=? AND person=? ORDER BY id').get(event, pid);
  }
  if (!team) throw new HttpError(403, '팀 열쇠나 신청 때 적은 연락처가 필요합니다');
  const tool = plain(b.tool, 60);
  if (!tool) throw new HttpError(400, '어떤 도구인지 적어 주세요');
  db.prepare(`INSERT INTO followups(event,team,tool,still_using,note) VALUES(?,?,?,?,?)
              ON CONFLICT(event,team) DO UPDATE SET tool=excluded.tool,
                still_using=excluded.still_using, note=excluded.note, created=datetime('now')`)
    .run(event, team.id, tool, b.still_using ? 1 : 0, plain(b.note, 300));
  return { ok: true };
}

/* 공개 요약. 도구별 숫자만 나간다 - 팀 이름도 연락처도 메모도 없다.
   세 팀 미만 도구를 그대로 내면 그 문자열로 한 팀이 드러나니 작은 칸은 뭉갠다. */
function followSummary(db, event) {
  const rows = db.prepare(`SELECT tool, COUNT(*) teams, SUM(still_using) still
                           FROM followups WHERE event=? GROUP BY tool ORDER BY teams DESC, tool`).all(event);
  const tools = [];
  let small = 0, smallStill = 0, hidden = 0;
  for (const r of rows) {
    if (r.teams >= MIN_CELL) tools.push({ tool: r.tool, teams: r.teams, still_using: r.still });
    else { small += r.teams; smallStill += r.still; hidden++; }
  }
  if (small) tools.push({ tool: `그 밖(${hidden}종)`, teams: small, still_using: smallStill, merged: true });
  return { tools };
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
          /* 목록에는 공개한 것만 싣는다. 이름만 넣고 만 대회가 첫 화면에 쌓이면
             들어온 사람이 "여긴 빈 곳이구나" 하고 나간다. */
        {
          const rows = db.prepare(
            `SELECT id,title,host,starts,ends,prize FROM events
             WHERE listed = 1 ORDER BY created DESC LIMIT 50`).all();
          /* 고를 근거를 목록에 같이 싣는다.
             설명회에서 "어느 기관이 유명한가, 경쟁률이 낮은가만 보고 고르지 말고
             프로필을 확인하라" 고 했는데, 확인하러 들어가야 하면 아무도 안 한다.
             지난 실적을 카드에 미리 얹어 둔다. */
          for (const r of rows) {
            r.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(r.id).c;
            const rec = record(db, r.id);
            if (rec) { r.pastEvents = rec.events; r.pastFinish = rec.finishRate; }
          }
          return json(res, 200, rows);
        }

        const key = req.headers['x-okey'] || q.k || '';
        /* 주최자를 알아내는 길이 둘이다.
           로그인했으면 서명된 쿠키, 아니면 브라우저가 들고 있는 열쇠. */
        const cookieOwner = unsign(db, cookieOf(req, 'hackon_s'));
        const headOwner = req.headers['x-owner'] || q.o || '';
        /* 틀린 열쇠를 넣은 경우에만 센다. 맞는 열쇠까지 세면
           평소에 쓰는 사람이 먼저 막힌다 — 실제로 그렇게 만들었다가 검사에서 잡혔다. */
        if (!cookieOwner && headOwner
            && !db.prepare('SELECT 1 FROM owners WHERE id=?').get(headOwner)
            && tooMany(req.socket.remoteAddress || ''))
          throw new HttpError(429, '열쇠를 너무 여러 번 틀렸습니다. 잠시 뒤에 다시 해 주세요');
        const owner = cookieOwner || headOwner;

        if (p === '/api/events' && req.method === 'POST') {
          const b = await body(req);
          if (owner) b.owner = owner;   // 이미 연 적이 있으면 그 사람 것으로 묶는다
          return json(res, 201, createEvent(db, b));
        }
        if (p === '/api/find' && req.method === 'GET')
          return json(res, 200, findHelp(q.size));

        /* 실제로 빌릴 수 있는 곳. 서울시 API 가 안 되면 빈 목록을 준다 -
           이것 때문에 구하기 화면 전체가 죽으면 안 된다. */
        if (p === '/api/venues' && req.method === 'GET') {
          let rows = [];
          try { rows = await fetchVenues(); } catch { rows = []; }
          return json(res, 200, {
            live: SEOUL_KEY !== 'sample',
            total: rows.length,
            rows: pickVenues(rows, q.size, q.area),
            areas: [...new Set(rows.map(r => r.area))].filter(Boolean).sort(),
          });
        }

        if (p === '/api/draft' && req.method === 'GET')
          return json(res, 200, draftPlan(q.start, q.end, q.teams, q.kind));
        if (p === '/api/kinds' && req.method === 'GET')
          return json(res, 200, { kinds: KINDS, rubrics: RUBRICS });
        if (p === '/api/logo' && req.method === 'GET')
          return json(res, 200, logoFor(q.domain));
        if (p === '/api/levels' && req.method === 'GET')
          return json(res, 200, { levels: LEVELS });

        /* 프로필. 누구나 열 수 있다 - 연락처가 애초에 안 담기기 때문이다. */
        if ((m = p.match(/^\/api\/people\/([0-9a-f]{12})$/)) && req.method === 'GET')
          return json(res, 200, profile(db, m[1]));
        if ((m = p.match(/^\/api\/people\/([0-9a-f]{12})$/)) && req.method === 'POST') {
          const b = await body(req);
          /* 본인 확인은 연락처로 한다. 연락처를 아는 사람만 자기 이름을 고칠 수 있다. */
          if (pidOf(db, b.contact) !== m[1]) throw new HttpError(403, '본인 확인이 안 됩니다');
          db.prepare('UPDATE people SET handle=?, level=? WHERE id=?')
            .run(String(b.handle || '').slice(0, 20),
                 LEVELS.includes(b.level) ? b.level : '', m[1]);
          return json(res, 200, profile(db, m[1]));
        }
        /* 내 열쇠 찾기. 연락처를 넣으면 그 사람의 프로필 주소가 나온다. */
        if (p === '/api/whoami' && req.method === 'POST') {
          const b = await body(req);
          const pid = pidOf(db, b.contact);
          if (!pid || !db.prepare('SELECT 1 FROM people WHERE id=?').get(pid))
            throw new HttpError(404, '그 연락처로 참가한 기록이 없습니다');
          return json(res, 200, { id: pid });
        }

        if ((m = p.match(/^\/api\/teams\/(\d+)\/seats$/)) && req.method === 'POST') {
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          return json(res, 200, setSeats(db, +m[1], await body(req),
            { admin: isAdmin(db, t.event, key, owner) }));
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/rep$/)) && req.method === 'GET')
          return json(res, 200, hostRep(db, m[1]) || {});

        /* 평가는 필수가 아니다. 같은 대회에 있던 사람만 할 수 있다. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/rate$/)) && req.method === 'POST') {
          const b = await body(req);
          const me2 = pidOf(db, b.contact);
          if (!me2 || !db.prepare('SELECT 1 FROM teams WHERE event=? AND person=?')
                        .get(m[1], me2))
            throw new HttpError(403, '이 대회에 참가한 분만 평가할 수 있습니다');
          const g = v => Math.min(5, Math.max(0, +v || 0));
          if (b.target) {
            if (b.target === me2) throw new HttpError(400, '본인은 평가할 수 없습니다');
            if (!db.prepare('SELECT 1 FROM teams WHERE event=? AND person=?').get(m[1], b.target))
              throw new HttpError(404, '이 대회에 없는 분입니다');
            db.prepare(`INSERT INTO ratings(event,giver,target,skill,manner) VALUES(?,?,?,?,?)
                        ON CONFLICT(event,giver,target) DO UPDATE SET skill=?, manner=?`)
              .run(m[1], me2, b.target, g(b.skill), g(b.manner), g(b.skill), g(b.manner));
          } else {
            db.prepare(`INSERT INTO event_ratings(event,giver,run,worth,note) VALUES(?,?,?,?,?)
                        ON CONFLICT(event,giver) DO UPDATE SET run=?, worth=?, note=?`)
              .run(m[1], me2, g(b.run), g(b.worth), String(b.note || '').slice(0, 200),
                   g(b.run), g(b.worth), String(b.note || '').slice(0, 200));
          }
          return json(res, 200, { ok: true });
        }

        if (p === '/api/plan-check' && req.method === 'POST') {
          const b = await body(req);
          return json(res, 200, { warn: planWarn(b.plan, b.teams) });
        }

        if (p === '/api/auth' && req.method === 'GET') {
          const me2 = owner ? db.prepare('SELECT id,name,kakao FROM owners WHERE id=?').get(owner) : null;
          return json(res, 200, {
            kakao: !!KAKAO,                 // 카카오 로그인을 쓸 수 있는가
            loggedIn: !!cookieOwner,        // 지금 로그인 상태인가
            owner: me2 ? me2.id : '',
            name: me2 ? me2.name : '',
            linked: !!(me2 && me2.kakao),   // 카카오에 묶인 계정인가
          });
        }
        if (p === '/api/mine' && req.method === 'GET') {
          if (!owner) throw new HttpError(400, '주최자 열쇠가 필요합니다');
          return json(res, 200, mine(db, owner));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/record$/)) && req.method === 'GET')
          return json(res, 200, record(db, m[1]) || {});

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)$/))) {
          if (req.method === 'PATCH') {
            needAdmin(db, m[1], key, owner);
            editEvent(db, m[1], await body(req));
            return json(res, 200, getEvent(db, m[1]));
          }
          if (req.method === 'GET') {
            const e = getEvent(db, m[1]);
            e.admin = isAdmin(db, m[1], key, owner);
            return json(res, 200, e);
          }
          if (req.method === 'DELETE') {
            needAdmin(db, m[1], key, owner);
            db.prepare('DELETE FROM events WHERE id=?').run(m[1]);
            return json(res, 200, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/teams$/)) && req.method === 'POST') {
          /* 팀 열쇠는 여기서 딱 한 번 나간다. 신청한 브라우저가 받아서 들고 있는다. */
          const tid = joinTeam(db, m[1], await body(req));
          const nt = db.prepare('SELECT tkey FROM teams WHERE id=?').get(tid);
          return json(res, 201, { id: tid, tkey: nt.tkey });
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/board$/)))
          return json(res, 200, board(db, m[1], isAdmin(db, m[1], key, owner)));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/sponsors$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const b = await body(req);
          db.prepare('INSERT INTO sponsors(event,name,kind,amount,note,logo,link) VALUES(?,?,?,?,?,?,?)')
            .run(m[1], b.name, b.kind || '현금', +b.amount || 0, b.note || '', webUrl(b.logo), webUrl(b.link));
          return json(res, 201, { ok: true });
        }
        /* 보고서는 협찬사에게 나눠 주는 물건이라 열쇠 없이 열려야 한다.
           개인 식별 정보가 애초에 안 담기는 응답이라 열어도 된다 - 운영자만 보는 칸만 뺀다. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/follow$/)) && req.method === 'GET')
          return json(res, 200, follow(db, m[1], isAdmin(db, m[1], key, owner)));
        if ((m = p.match(/^\/api\/teams\/(\d+)\/check$/)) && req.method === 'POST') {
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          needAdmin(db, t.event, key, owner);
          const b = await body(req);
          if (!WEEKS.includes(+b.week)) throw new HttpError(400, '2·6·12주 중 하나여야 합니다');
          /* 세 번째로 누르면 '안 물어봄' 으로 되돌린다. 잘못 누른 것을 되돌릴 길이 있어야 한다. */
          if (b.remove) {
            db.prepare('DELETE FROM checks WHERE team=? AND week=?').run(+m[1], +b.week);
            return json(res, 200, { ok: true });
          }
          db.prepare(`INSERT INTO checks(team,week,alive,live,note) VALUES(?,?,?,?,?)
                      ON CONFLICT(team,week) DO UPDATE SET alive=?, live=?, note=?,
                      at=date('now')`)
            .run(+m[1], +b.week, b.alive ? 1 : 0, b.live ? 1 : 0, String(b.note || '').slice(0, 300),
                 b.alive ? 1 : 0, b.live ? 1 : 0, String(b.note || '').slice(0, 300));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/pack$/)) && req.method === 'GET')
          return json(res, 200, pack(db, m[1], isAdmin(db, m[1], key, owner)));
        /* 동의한 팀의 연락처. 개인정보보호법 17조 - 동의 없이는 한 줄도 안 나간다.
           그래서 집계(pack)와 완전히 다른 주소로 뺐다. 실수로 같이 나갈 수가 없게. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/consented$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);
          return json(res, 200, {
            rows: db.prepare(`SELECT name, contact, role FROM teams
                              WHERE event=? AND sponsor_ok=1 ORDER BY id`).all(m[1]),
          });
        }
        if ((m = p.match(/^\/api\/sponsors\/(\d+)$/)) && req.method === 'POST') {
          const r = db.prepare('SELECT event FROM sponsors WHERE id=?').get(m[1]);
          if (!r) throw new HttpError(404, '없는 협찬사입니다');
          needAdmin(db, r.event, key, owner);
          const b = await body(req);
          if (b.remove) db.prepare('DELETE FROM sponsors WHERE id=?').run(m[1]);
          else db.prepare('UPDATE sponsors SET done=?, proof=? WHERE id=?')
                 .run(String(b.done || ''), webUrl(b.proof), m[1]);
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/leads$/))) {
          needAdmin(db, m[1], key, owner);
          if (req.method === 'POST') {
            const b = await body(req);
            if (!String(b.name || '').trim()) throw new HttpError(400, '이름을 넣어 주세요');
            db.prepare('INSERT INTO leads(event,kind,name,how,note) VALUES(?,?,?,?,?)')
              .run(m[1], b.kind || '장소', String(b.name).trim(),
                   String(b.how || '').slice(0, 200), String(b.note || '').slice(0, 400));
          }
          return json(res, 200, {
            rows: db.prepare('SELECT * FROM leads WHERE event=? ORDER BY id DESC').all(m[1]),
          });
        }
        if ((m = p.match(/^\/api\/leads\/(\d+)$/)) && req.method === 'POST') {
          const r = db.prepare('SELECT event FROM leads WHERE id=?').get(m[1]);
          if (!r) throw new HttpError(404, '없는 항목입니다');
          needAdmin(db, r.event, key, owner);
          const b = await body(req);
          if (b.remove) db.prepare('DELETE FROM leads WHERE id=?').run(m[1]);
          else db.prepare('UPDATE leads SET state=? WHERE id=?').run(b.state || '보냄', m[1]);
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/crew$/)) && req.method === 'GET')
          return json(res, 200, crew(db, m[1]));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/tv$/)) && req.method === 'GET')
          return json(res, 200, tv(db, m[1]));


        if ((m = p.match(/^\/api\/teams\/(\d+)\/card$/)) && req.method === 'GET')
          return json(res, 200, card(db, +m[1]));

        /* 확성기. 한 줄이면 큰 화면과 공개 페이지에 동시에 뜬다.
           큰 화면은 10초마다 스스로 새로 받으므로 따로 밀어 줄 것이 없다. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/notice$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const b = await body(req);
          db.prepare('UPDATE events SET notice=?, notice_at=? WHERE id=?')
            .run(String(b.notice || '').slice(0, 120),
                 b.notice ? new Date().toISOString() : '', m[1]);
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/list$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const b = await body(req);
          db.prepare('UPDATE events SET listed=? WHERE id=?')
            .run(b.list === false ? 0 : 1, m[1]);
          return json(res, 200, getEvent(db, m[1]));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/open$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const b = await body(req);
          db.prepare('UPDATE events SET opened=? WHERE id=?').run(b.open === false ? 0 : 1, m[1]);
          return json(res, 200, { opened: b.open === false ? 0 : 1 });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/spread$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);   // 심사위원에게 보이면 서로 눈치를 본다
          return json(res, 200, spread(db, m[1]));
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/judge$/)) && req.method === 'GET')
          return json(res, 200, judgeView(db, m[1], q.judge || ''));

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/support$/))) {
          if (req.method === 'GET') {
            const s = support(db, m[1]);
            /* 지원자 연락처는 운영자만. board() 가 팀 연락처를 지우는 것과 같은 이유다. */
            if (!isAdmin(db, m[1], key, owner)) s.people = s.people.map(({ contact, ...r }) => r);
            return json(res, 200, s);
          }
          if (req.method === 'POST') {
            needAdmin(db, m[1], key, owner);
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
          needAdmin(db, m[1], key, owner);
          return json(res, 201, { due: assign(db, m[1], await body(req)) });
        }

        if ((m = p.match(/^\/api\/assignments\/(\d+)\/done$/)) && req.method === 'POST') {
          /* 약속을 '지킴' 으로 바꾸는 것은 운영자 몫이다 — 보고서의 이행률 숫자가 여기서 나온다.
             바로 위 checkin 처럼, 그 약속이 어느 대회 것인지 찾아 운영자 열쇠를 확인한다. */
          const a = db.prepare(`SELECT t.event FROM assignments a JOIN teams t ON t.id=a.team WHERE a.id=?`).get(+m[1]);
          if (!a) throw new HttpError(404, '없는 약속입니다');
          needAdmin(db, a.event, key, owner);
          const b = await body(req);
          db.prepare('UPDATE assignments SET done=?, note=? WHERE id=?')
            .run(b.done === false ? '' : today(), b.note || '', +m[1]);
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/outcomes$/))) {
          if (req.method === 'GET') {
            const o = outcomes(db, m[1]);
            /* 완주율은 공개 페이지가 쓴다. 유입 경로와 명단은 운영자 것이다. */
            if (!isAdmin(db, m[1], key, owner)) { delete o.found; delete o.list; delete o.came; }
            return json(res, 200, o);
          }
          if (req.method === 'POST') {
            needAdmin(db, m[1], key, owner);
            const b = await body(req);
            db.prepare('INSERT INTO outcomes(event,team,kind,who,note) VALUES(?,?,?,?,?)')
              .run(m[1], b.team || null, b.kind, b.who || '', b.note || '');
            return json(res, 201, { ok: true });
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/extend$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
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
        if ((m = p.match(/^\/api\/teams\/(\d+)\/more$/)) && req.method === 'POST') {
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          return json(res, 200, moreTeam(db, +m[1], await body(req),
            { admin: isAdmin(db, t.event, key, owner),
              tkey: req.headers['x-tkey'] || '' }));
        }

        if ((m = p.match(/^\/api\/teams\/(\d+)\/checkin$/)) && req.method === 'POST') {
          /* 등록 데스크에서 누른다. 다시 누르면 취소 — 잘못 누르는 일이 실제로 생긴다. */
          const t = db.prepare('SELECT came, event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          needAdmin(db, t.event, key, owner);
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
          needAdmin(db, m[1], key, owner);
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="hackon-${m[1]}.json"`,
          });
          return res.end(JSON.stringify(dump(db, m[1]), null, 2));
        }
        /* ── 빈자리 판 · 공개 장부 · 2주 확인 (PLAN.md §API) ── */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/needs$/))) {
          if (req.method === 'GET') return json(res, 200, needsOf(db, m[1]));
          if (req.method === 'POST') {
            needAdmin(db, m[1], key, owner);
            return json(res, 201, addNeed(db, m[1], await body(req)));
          }
        }
        if ((m = p.match(/^\/api\/needs\/(\d+)\/pledge$/)) && req.method === 'POST') {
          const n = db.prepare('SELECT event FROM needs WHERE id=?').get(+m[1]);
          if (!n) throw new HttpError(404, '없는 자리입니다');
          return json(res, 201, addPledge(db, +m[1], n.event, await body(req)));
        }
        if ((m = p.match(/^\/api\/pledges\/(\d+)\/status$/)) && req.method === 'POST') {
          const r = db.prepare('SELECT event FROM pledges WHERE id=?').get(+m[1]);
          if (!r) throw new HttpError(404, '없는 신청입니다');
          needAdmin(db, r.event, key, owner);
          return json(res, 200, setPledge(db, +m[1], await body(req)));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/ledger$/)) && req.method === 'GET')
          return json(res, 200, ledgerOf(db, m[1]));
        /* 운영자가 신청자 연락처를 보는 주소. 열쇠 없거나 남의 대회 열쇠면 needAdmin 이 403 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/pledges$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);
          return json(res, 200, pledgesOf(db, m[1]));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/needs-summary$/)) && req.method === 'GET')
          return json(res, 200, needsSummary(db, m[1]));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/followup$/)) && req.method === 'POST')
          return json(res, 200, addFollowup(db, m[1], await body(req), req));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/followup-summary$/)) && req.method === 'GET')
          return json(res, 200, followSummary(db, m[1]));

        if (p === '/api/health') return json(res, 200, {
          ok: true, events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
          teams: db.prepare('SELECT COUNT(*) c FROM teams').get().c,
          net: lanIPs(), port: +PORT,
        });
        throw new HttpError(404, '없는 주소입니다');
      }

      /* 공개 링크. /e/<대회id> 는 화면 파일을 그대로 내려보내고, 화면이 주소를 보고
         읽기 전용으로 그린다. 서버에 화면을 하나 더 두지 않는 게 요점이다. */
      /* ── 카카오 로그인 ────────────────────────────────
         키가 없으면 이 자리는 통째로 없는 것과 같다. */
      if (p === '/auth/kakao' && KAKAO) {
        const back = SITE || `http://${req.headers.host}`;
        const u = 'https://kauth.kakao.com/oauth/authorize'
          + `?client_id=${encodeURIComponent(KAKAO)}`
          + `&redirect_uri=${encodeURIComponent(back + '/auth/kakao/done')}`
          + '&response_type=code&scope=profile_nickname';
        res.writeHead(302, { location: u });
        return res.end();
      }
      if (p === '/auth/kakao/done' && KAKAO) {
        const back = SITE || `http://${req.headers.host}`;
        const code = u.searchParams.get('code');
        if (!code) { res.writeHead(302, { location: '/app' }); return res.end(); }
        const form = new URLSearchParams({
          grant_type: 'authorization_code', client_id: KAKAO,
          redirect_uri: back + '/auth/kakao/done', code,
        });
        if (KAKAO_SECRET) form.set('client_secret', KAKAO_SECRET);
        const tk = await (await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: form.toString(),
        })).json();
        if (!tk.access_token) throw new HttpError(400, '카카오 로그인에 실패했습니다');
        const me = await (await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { authorization: 'Bearer ' + tk.access_token },
        })).json();
        const kid = String(me.id || '');
        if (!kid) throw new HttpError(400, '카카오 사용자 정보를 못 받았습니다');
        const nick = (me.properties && me.properties.nickname) || '';

        /* 이미 이 카카오로 만든 주최자가 있으면 그걸 쓰고,
           없으면 지금 브라우저가 들고 있던 열쇠를 그 카카오에 붙인다.
           그래야 로그인 전에 연 대회를 잃지 않는다. */
        let o = db.prepare('SELECT id FROM owners WHERE kakao=?').get(kid);
        let oid = o && o.id;
        if (!oid) {
          const had = unsign(db, cookieOf(req, 'hackon_pre'));
          if (had && db.prepare('SELECT 1 FROM owners WHERE id=?').get(had)) {
            db.prepare('UPDATE owners SET kakao=?, name=COALESCE(NULLIF(name,\'\'),?) WHERE id=?')
              .run(kid, nick, had);
            oid = had;
          } else {
            oid = crypto.randomBytes(6).toString('hex');
            db.prepare('INSERT INTO owners(id,name,kakao) VALUES(?,?,?)').run(oid, nick, kid);
          }
        }
        res.writeHead(302, {
          location: '/app',
          'set-cookie': [
            `hackon_s=${encodeURIComponent(sign(db, oid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
            + (SITE.startsWith('https') ? '; Secure' : ''),
            'hackon_pre=; Path=/; Max-Age=0',
          ],
        });
        return res.end();
      }
      if (p === '/auth/logout') {
        res.writeHead(302, { location: '/', 'set-cookie': 'hackon_s=; Path=/; Max-Age=0' });
        return res.end();
      }

      /* 운영 매뉴얼. 전에는 깃허브로 내보냈는데, 매뉴얼을 보려고 사이트를 떠나야 했다.
         읽을 것을 읽으러 밖으로 내보내면 대부분 안 돌아온다.
         GUIDE.md 를 그대로 읽어 만든다 - 문서가 두 벌이 되면 반드시 어긋난다. */
      if (p === '/manual') {
        let md = '';
        try { md = fs.readFileSync(path.join(ROOT, 'GUIDE.md'), 'utf8'); }
        catch { return json(res, 404, { error: '매뉴얼 파일이 없습니다' }); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
                             'cache-control': 'no-cache' });
        return res.end(manualPage(md));
      }

      /* 주소가 셋 갈린다.
         /            첫 화면. 플랫폼 소개와 열린 대회 목록 (home.html)
         /app         대회를 열고 굴리는 곳 (hack-on.html)
         /e /j /tv    공개·심사·현장 화면. 전부 같은 hack-on.html 이 주소를 보고 갈라진다 */
      const pub = p.match(/^\/e\/[a-z0-9]+(\/report)?$/) || p.match(/^\/j\/[a-z0-9]+$/)
               || p.match(/^\/tv\/[a-z0-9]+$/) || p.match(/^\/p\/[0-9a-f]{12}$/)
               || p === '/app';

      /* 화면 파일은 /e/<id> 같은 깊은 주소에서도 그대로 나간다. 그 안의 <script src="qr.js">
         는 /e/qr.js 를 찾게 되고 404 가 난다. 파일로 열었을 때(file://)도 살아야 하니
         화면 쪽은 상대 경로로 두고, 어느 깊이로 오든 여기서 뿌리로 되돌린다. */
      const rel = p.endsWith('/qr.js') ? '/qr.js' : p;

      /* #region reuse:static — 경로 탈출 방지 + MIME + 스트림. 그대로 복사해 쓴다 */
      const f = path.join(ROOT,
        p === '/' ? 'home.html' : pub ? 'hack-on.html' : decodeURIComponent(rel));
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
  ok(/^[0-9a-f]{12}$/.test(evR.owner), '주최자 열쇠도 같이 발급된다');
  ok(!('okey' in getEvent(db, ev)), '열쇠는 안 내려보낸다');
  ok(board(db, ev, true).rows.length === 0, '빈 대회');
  ok(isAdmin(db, ev, okey) && !isAdmin(db, ev, 'x'), '열쇠가 맞아야 운영자다');
  ok(isAdmin(db, ev, '', evR.owner), '주최자 열쇠로도 열린다');
  ok(typeof secretOf(db) === 'string' && secretOf(db).length === 64, '쿠키 서명 열쇠가 생긴다');
  ok(secretOf(db) === secretOf(db), '서명 열쇠는 다시 만들지 않는다');
  const signed = sign(db, evR.owner);
  ok(unsign(db, signed) === evR.owner, '서명한 쿠키를 되읽는다');
  ok(unsign(db, evR.owner + '.deadbeef') === '', '서명이 틀리면 안 읽힌다');
  ok(!isAdmin(db, ev, '', 'nope'), '남의 주최자 열쇠로는 안 열린다');

  let bad = false;
  try { createEvent(db, { title: 'x', rubric: [{ key: 'a', label: 'a', weight: 50 }] }); }
  catch { bad = true; }
  ok(bad, '배점 합이 100 이 아니면 막는다');

  bad = false; try { joinTeam(db, ev, { name: '동의안함' }); } catch { bad = true; }
  ok(bad, '개인정보 동의 없이는 신청이 안 된다');

  // 신청 화면의 이메일 칸 — 꼴 검사, 소문자 다듬기, 협찬사 제공 동의는 따로
  const withMail = joinTeam(db, ev, { name: '메일팀', agree: true, email: ' Mail@X.Test ', share: true });
  const wm = db.prepare('SELECT contact, sponsor_ok, share FROM teams WHERE id=?').get(withMail);
  ok(wm.contact === 'mail@x.test', '신청 이메일은 소문자로 다듬어 연락처가 된다');
  ok(wm.sponsor_ok === 1 && wm.share !== '', '협찬사 제공 동의를 체크하면 동의와 시각이 남는다');
  const noShare = joinTeam(db, ev, { name: '메일팀2', agree: true, email: 'b@x.test' });
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(noShare).sponsor_ok === 0, '체크 안 하면 협찬사 제공 동의는 꺼져 있다');
  let badMail = false; try { joinTeam(db, ev, { name: '메일이상2', agree: true, email: 'not-mail' }); } catch { badMail = true; }
  ok(badMail, '이메일 꼴이 틀리면 신청을 막는다');
  ok(!('contact' in board(db, ev, false).rows[0]), '신청 이메일은 공개 순위에 안 나간다');
  db.prepare('DELETE FROM teams WHERE id IN (?,?)').run(withMail, noShare);

  // 문간에 발 담그기 — 이름과 동의만으로 신청되고, 나머지는 나중에 채운다
  const lite = joinTeam(db, ev, { name: '최소팀', agree: true });
  ok(!!lite, '이름과 동의만으로 신청된다');
  /* 팀 열쇠. 신청한 브라우저만 받는다 - 이게 '내가 그 팀 사람' 이라는 증거다. */
  const LK = db.prepare('SELECT tkey FROM teams WHERE id=?').get(lite).tkey;
  ok(/^[0-9a-f]{10}$/.test(LK), '팀 열쇠가 발급된다');
  ok(!('tkey' in board(db, ev, true).rows[0]), '팀 열쇠는 운영 화면에도 안 실린다');
  /* 팀 번호만 알고 열쇠가 없으면 빈 칸도 못 채운다.
     연락처는 한 번 쓰면 끝이라, 남이 먼저 채우면 진짜 참가자가 영영 밀려난다. */
  let 선점 = false;
  try { moreTeam(db, lite, { contact: '가로챈@x.test' }); } catch { 선점 = true; }
  ok(선점, '열쇠 없이는 남의 빈 팀을 선점할 수 없다');
  ok(db.prepare('SELECT contact FROM teams WHERE id=?').get(lite).contact === '',
     '선점 시도 뒤에도 연락처 칸은 비어 있다');
  ok(moreTeam(db, lite, { tkey: LK, contact: 'later@x.test', role: '기획' }).filled === 2,
     '나중에 두 칸을 채운다');
  /* 첫 칸에서는 연락처를 안 묻는다. 나중에 들어와도 사람으로 이어져야 한다. */
  ok(db.prepare('SELECT person FROM teams WHERE id=?').get(lite).person
     === pidOf(db, 'later@x.test'), '나중에 넣은 연락처로도 사람이 이어진다');
  moreTeam(db, lite, { contact: 'later@x.test', sponsor_ok: true });
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 1,
     '협찬사 제공 동의가 저장된다');
  moreTeam(db, lite, { contact: 'later@x.test', sponsor_ok: false });
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 0,
     '동의는 다시 뺄 수 있다');
  /* 남이 남의 동의를 켜면 그 사람 연락처가 협찬사에게 넘어간다.
     팀 번호는 1, 2, 3... 이라 아무나 찍어 볼 수 있다. */
  let 남의동의 = false;
  try { moreTeam(db, lite, { sponsor_ok: true }); } catch { 남의동의 = true; }
  ok(남의동의, '연락처 없이는 남의 협찬 동의를 못 켠다');
  try { moreTeam(db, lite, { contact: '남@x.test', sponsor_ok: true }); } catch { 남의동의 = true; }
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 0,
     '남의 연락처로도 남의 협찬 동의를 못 켠다');
  moreTeam(db, lite, { sponsor_ok: true }, { admin: true });
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 1,
     '운영자는 바꿀 수 있다');
  moreTeam(db, lite, { contact: 'later@x.test', sponsor_ok: false });
  /* 정원도 setSeats 와 같아야 한다. 여기로 우회되면 거기서 막은 뜻이 없다. */
  let 남의정원 = false;
  try { moreTeam(db, lite, { size: 9 }); } catch { 남의정원 = true; }
  ok(남의정원, '남이 이 길로 정원을 못 바꾼다');
  /* 열쇠를 가진 브라우저는 연락처를 안 대고도 자기 팀을 고친다.
     기기를 바꿔 열쇠를 잃은 사람에게는 연락처가 복구 경로로 남는다 - 길이 둘이다. */
  moreTeam(db, lite, { tkey: LK, sponsor_ok: true });
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 1,
     '팀 열쇠만으로도 본인 확인이 된다');
  moreTeam(db, lite, { tkey: LK, sponsor_ok: false });
  let 틀린열쇠 = false;
  try { moreTeam(db, lite, { tkey: '0123456789', sponsor_ok: true }); } catch { 틀린열쇠 = true; }
  ok(틀린열쇠, '틀린 팀 열쇠로는 안 된다');
  ok(db.prepare('SELECT sponsor_ok FROM teams WHERE id=?').get(lite).sponsor_ok === 0,
     '틀린 열쇠 뒤에도 동의는 꺼진 채다');
  ok(moreTeam(db, lite, { contact: '덮어쓰기' }).filled === 0, '이미 적은 것은 안 덮어쓴다');
  /* 다 채워진 팀도 사람으로 이어져야 한다. 전에는 일찍 반환해서 영영 안 이어졌다. */
  db.prepare("UPDATE teams SET person='' WHERE id=?").run(lite);
  moreTeam(db, lite, {});
  ok(db.prepare('SELECT person FROM teams WHERE id=?').get(lite).person
     === pidOf(db, 'later@x.test'), '채울 게 없어도 사람으로는 이어 붙인다');
  ok(board(db, ev, true).rows.find(r => r.id === lite).contact === 'later@x.test',
     '채운 값이 남는다');
  db.prepare('DELETE FROM teams WHERE id=?').run(lite);

  const t1 = joinTeam(db, ev, { name: '가팀', agree: true, photo: true });
  const t2 = joinTeam(db, ev, { name: '나팀', agree: true });
  bad = false; try { joinTeam(db, ev, { name: '가팀', agree: true }); } catch { bad = true; }
  ok(bad, '같은 팀 이름은 못 넣는다');
  ok(!!board(db, ev, true).rows.find(r => r.id === t1).agreed, '동의한 시각이 남는다');

  submit(db, t1, { url: 'https://example.com/a' });
  score(db, t1, { judge: '심사1', values: { idea: 90, make: 80, use: 70, tell: 60 } });
  score(db, t2, { judge: '심사1', values: { idea: 50, make: 50, use: 50, tell: 50 } });
  /* 점수 엔진을 보는 검사라 운영자 눈으로 본다. 손님에게는 마감 전 점수가 안 나간다. */
  const b = board(db, ev, true);
  ok(b.rows[0].name === '가팀', '점수 높은 팀이 1등');
  ok(typeof b.rows[0].words === 'number', '심사평을 몇 건 남겼는지 센다');
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

  // 주최자 열쇠 — 내가 연 대회가 따라온다
  const ev4 = createEvent(db, { title: '같은사람두번째', owner: evR.owner });
  ok(ev4.owner === evR.owner, '열쇠를 갖고 오면 같은 사람으로 묶인다');
  const my = mine(db, evR.owner);
  ok(my.events.length >= 2, '내가 연 대회가 모인다 (' + my.events.length + '개)');
  ok(typeof my.total.keptRate === 'number', '누적 약속 이행률이 나온다');
  ok(record(db, ev4.id) === null, '지난 대회가 없으면 이력이 없다');
  db.prepare('DELETE FROM events WHERE id=?').run(ev4.id);

  // 마감 전에는 제출 링크와 점수를 서버가 안 준다
  const shEv = createEvent(db, { title: '공개시험', starts: today(), ends: today() });
  editEvent(db, shEv.id, { due: '2099-01-01T00:00' });
  const shT = joinTeam(db, shEv.id, { name: '먼저낸팀', agree: true });
  submit(db, shT, { url: 'https://secret.test/abc', note: '무엇을 만드는지' });
  const guestB = board(db, shEv.id, false), adminB = board(db, shEv.id, true);
  ok(guestB.rows[0].url === undefined, '마감 전에는 제출 링크를 안 준다');
  ok(guestB.rows[0].hidden === true, '대신 냈다는 사실은 알린다');
  ok(guestB.rows[0].note === '무엇을 만드는지', '설명은 마감 전에도 보인다');
  ok(guestB.rows[0].score === null, '마감 전에는 점수도 안 준다');
  ok(adminB.rows[0].url === 'https://secret.test/abc', '운영자는 언제든 본다');
  ok(!JSON.stringify(guestB).includes('secret.test'), '응답 어디에도 링크가 안 남는다');
  editEvent(db, shEv.id, { due: '2000-01-01T00:00' });
  ok(board(db, shEv.id, false).rows[0].url === 'https://secret.test/abc',
     '마감이 지나면 링크가 공개된다');
  ok(board(db, shEv.id, false).closed === true, '마감 여부를 화면에 알려 준다');
  db.prepare('DELETE FROM events WHERE id=?').run(shEv.id);

  // 큰 화면 - 벽에 걸리는 것
  const tvEv = createEvent(db, { title: '큰화면시험', starts: today(), ends: today() });
  editEvent(db, tvEv.id, { due: '2099-01-01T00:00', wifi: 'hackon / 1234' });
  const tvT = joinTeam(db, tvEv.id, { name: '아직안낸팀', agree: true });
  const tv1 = tv(db, tvEv.id);
  ok(tv1.wifi === 'hackon / 1234', '큰 화면에 와이파이가 실린다');
  ok(tv1.waiting.length === 0, '마감이 멀면 미제출 명단을 안 띄운다');
  ok(tv1.urgent === false, '마감이 멀면 급하다고 안 한다');
  ok(tv1.ranks.length === 0, '마감 전에는 순위를 안 띄운다');
  db.prepare('DELETE FROM events WHERE id=?').run(tvEv.id);

  // 사람 — 연락처를 열쇠로 바꾼다
  const pEv = createEvent(db, { title: '사람시험', starts: '2020-01-01', ends: '2020-01-02' });
  const pA = joinTeam(db, pEv.id, { name: '가나', contact: 'a@x.test', agree: true,
                                    level: '해 봤음', size: 4 });
  const pB = joinTeam(db, pEv.id, { name: '다라', contact: 'B@X.TEST ', agree: true });
  const idA = pidOf(db, 'a@x.test'), idB = pidOf(db, 'b@x.test');
  ok(/^[0-9a-f]{12}$/.test(idA), '연락처가 열두 자 열쇠가 된다');
  ok(idA === pidOf(db, ' A@X.test '), '대소문자와 공백은 같은 사람으로 본다');
  ok(idA !== idB, '다른 연락처는 다른 사람이다');
  ok(pidOf(db, '') === '' && pidOf(db, 'a@b') === '', '너무 짧으면 열쇠를 안 만든다');
  const prof = profile(db, idA);
  ok(prof.level === '해 봤음', '처음에 고른 실력이 남는다');
  ok(!JSON.stringify(prof).includes('x.test'), '프로필에 연락처가 안 나간다');
  ok(prof.events === 1 && prof.noshow === 1, '안 온 것은 매너로 센다 (실력이 아니다)');
  ok(prof.placed === false, '한 번 나온 사람은 배치 중이다');

  // 평가 - 적으면 숫자를 안 보여 준다
  const one = shrink([5]);
  ok(one.n === 1 && one.show === false, '평가 한 건이면 등급을 안 보여 준다');
  ok(one.score < 5, '한 건짜리 만점은 그대로 안 쓴다 (' + one.score + ')');
  ok(shrink([5, 5, 5]).show === true, '세 건부터 보여 준다');
  ok(shrink([5, 5, 5]).score > shrink([3, 3, 3]).score, '높게 받으면 높게 나온다');
  ok(shrink([]).n === 0 && shrink([0, 0]).n === 0, '안 매긴 것은 안 센다');

  db.prepare('INSERT INTO ratings(event,giver,target,skill,manner) VALUES(?,?,?,?,?)')
    .run(pEv.id, idB, idA, 5, 2);
  const prof2 = profile(db, idA);
  ok(prof2.skill.n === 1 && prof2.manner.n === 1, '실력과 매너를 따로 센다');
  ok(prof2.skill.score !== prof2.manner.score, '실력과 매너가 섞이지 않는다');

  // 대회 평판
  db.prepare('INSERT INTO event_ratings(event,giver,run,worth,note) VALUES(?,?,?,?,?)')
    .run(pEv.id, idA, 5, 4, '진행이 매끄러웠습니다');
  const hr = hostRep(db, pEv.id);
  ok(hr.n === 1 && hr.run.show === false, '대회 평가도 세 건 미만이면 숫자를 안 보여 준다');
  ok(hr.notes.length === 1 && !JSON.stringify(hr).includes(idA),
     '후기에 누가 썼는지는 안 담긴다');

  // 빈자리
  setSeats(db, pA, { size: 4 }, { admin: true });
  const sA = seats(db.prepare('SELECT * FROM teams WHERE id=?').get(pA));
  ok(sA.size === 4 && sA.mem.length === 1 && sA.free === 3, '네 명 팀에 세 자리가 빈다');
  setSeats(db, pA, { add: '게스트1', guest: true });
  setSeats(db, pA, { add: '민지' });
  const sA2 = seats(db.prepare('SELECT * FROM teams WHERE id=?').get(pA));
  ok(sA2.free === 1 && sA2.mem[1].g === true, '밖에서 구한 사람은 게스트로 채운다');
  setSeats(db, pA, { add: '넷째' });
  let full = false;
  try { setSeats(db, pA, { add: '다섯째' }); } catch { full = true; }
  ok(full, '정원을 넘겨서는 못 넣는다');
  /* 빼기는 그 팀만. 지나가던 사람이 남의 팀원을 지울 수 있으면 안 된다. */
  let kicked = false;
  try { setSeats(db, pA, { remove: 1 }); } catch { kicked = true; }
  ok(kicked, '남이 남의 팀원을 못 뺀다');
  setSeats(db, pA, { remove: 1 }, { admin: true });
  ok(seats(db.prepare('SELECT * FROM teams WHERE id=?').get(pA)).free === 1,
     '운영자는 뺄 수 있다');
  setSeats(db, pA, { add: '다시' });
  setSeats(db, pA, { remove: 1, contact: 'a@x.test' });
  ok(seats(db.prepare('SELECT * FROM teams WHERE id=?').get(pA)).free === 1,
     '그 팀 연락처를 아는 사람도 뺄 수 있다');
  let resized = false;
  try { setSeats(db, pA, { size: 9 }); } catch { resized = true; }
  ok(resized, '남이 남의 팀 정원을 못 바꾼다');
  ok(crew(db, pEv.id).looking.some(x => x.id === pA && x.free === 1),
     '자리가 남으면 사람 찾는 목록에 저절로 오른다');
  db.prepare('DELETE FROM events WHERE id=?').run(pEv.id);

  // 로고 자동 찾기
  ok(logoFor('openai.com').ok && logoFor('openai.com').domain === 'openai.com',
     '도메인에서 로고 주소를 만든다');
  ok(logoFor('https://www.openai.com/about').domain === 'openai.com',
     '주소를 붙여 넣어도 도메인만 뽑는다');
  ok(!logoFor('오픈에이아이').ok && !logoFor('').ok && !logoFor('openai').ok,
     '도메인이 아니면 안 만든다');
  ok(logoFor('openai.com').url.startsWith('https://'), '로고 주소는 https 다');

  // 심사 기준 두 벌
  ok(Object.keys(RUBRICS).length === 2, '심사 기준이 두 벌이다');
  for (const [k, v] of Object.entries(RUBRICS))
    ok(v.rows.reduce((a, r) => a + r.weight, 0) === 100, k + ' 배점 합이 100 이다');
  const rbEv = createEvent(db, { title: '기준시험', rubricKind: '문제해결' });
  const rb = getEvent(db, rbEv.id).rubric;
  ok(rb[0].key === 'will' && rb[0].weight === 40, '문제해결 기준이 깔린다');
  ok(getEvent(db, createEvent(db, { title: '기본시험' }).id).rubric[0].key === 'idea',
     '안 고르면 만들기 기준이 깔린다');
  db.prepare('DELETE FROM events WHERE id=?').run(rbEv.id);

  // 대회 유형
  ok(Object.keys(KINDS).length === 3, '대회 유형이 셋이다');
  const on = draftPlan('10:00', '19:30', 6, '무박2일');
  ok(on.kind === '무박2일' && on.rows.some(r => r.what.includes('야식')),
     '무박 2일 초안에는 야식이 있다');
  const web = draftPlan('', '', 6, '온라인 1주');
  ok(web.rows[0].at === '1일차', '온라인은 날짜로 센다');
  ok(draftPlan('10:00', '19:30', 6).rows[0].at === '10:00', '유형을 안 주면 당일이 기본이다');

  // 진행 순서 표준
  const dp6 = draftPlan('10:00', '19:30', 6);
  ok(dp6.rows[0].at === '10:00', '초안이 시작 시각부터 시작한다');
  ok(dp6.rows.some(r => r.what.includes('팀 짜기')), '초안에 팀 짜기가 있다');
  ok(dp6.rows.some(r => r.what.includes('점심')), '점심때를 지나면 점심이 들어간다');
  ok(planWarn(dp6.rows, 6).length === 0,
     '표준 초안은 경고가 하나도 없다: ' + planWarn(dp6.rows, 6).join(' / '));
  const dp20 = draftPlan('10:00', '19:30', 20);
  const showAt = r => r.find(x => /^발표/.test(x.what)).at;
  ok(showAt(dp20.rows) < showAt(dp6.rows), '팀이 많으면 발표를 더 일찍 시작한다');
  ok(planWarn(dp20.rows, 20).length === 0, '20팀 초안도 경고가 없다');
  ok(draftPlan('10:00', '12:00', 6).tight, '시간이 모자라면 알려 준다');

  ok(planWarn([{ at: '10:00', what: '등록' }, { at: '10:20', what: '만들기' }], 6)
       .some(w => w.includes('팀 짜기')), '팀 짜기가 빠지면 잡아낸다');
  ok(planWarn([{ at: '10:00', what: '등록' }, { at: '10:20', what: '팀 짜기' },
               { at: '10:30', what: '만들기' }], 6)
       .some(w => w.includes('팀 짜기가')), '팀 짜기가 짧으면 잡아낸다');
  ok(planWarn([{ at: '16:00', what: '제출 마감' }, { at: '16:10', what: '발표' },
               { at: '18:00', what: '심사' }], 6)
       .some(w => w.includes('마감과 발표')), '마감 직후 발표를 잡으면 잡아낸다');
  ok(planWarn([{ at: '10:00', what: '등록' }, { at: '10:20', what: '팀 짜기' },
               { at: '11:00', what: '아이디어 발표' }], 10).every(w => !w.includes('발표가')),
     "'아이디어 발표' 를 최종 발표로 오인하지 않는다");
  ok(planWarn([{ at: '16:00', what: '발표' }, { at: '16:20', what: '심사' },
               { at: '17:00', what: '시상' }], 10)
       .some(w => w.includes('발표가')), '발표 시간이 팀 수에 모자라면 잡아낸다');

  // 이어가기 — 2·6·12주
  const fw1 = follow(db, ev, true);
  ok(fw1.weeks.join(',') === '2,6,12', '점검은 2·6·12주에 한다');
  ok(fw1.rows.length === board(db, ev, false).rows.length, '모든 팀이 점검 대상이다');
  ok(fw1.aliveRate === 0 && fw1.asked12 === 0, '아직 안 물어봤으면 생존율이 0이다');
  const fwTeam = fw1.rows[0].id;
  db.prepare('INSERT INTO checks(team,week,alive,live) VALUES(?,12,1,1)').run(fwTeam);
  const fw2 = follow(db, ev, true);
  ok(fw2.asked12 === 1 && fw2.alive12 === 1 && fw2.aliveRate === 100,
     '물어본 팀 기준으로 생존율을 센다 (' + fw2.aliveRate + '%)');
  ok(fw2.liveNow === 1, '링크가 아직 열리는 팀을 센다');
  ok(pack(db, ev, true).numbers.aliveRate === fw2.aliveRate, '협찬사 집계에 90일 생존율이 실린다');
  ok(pack(db, ev, true).leads !== undefined && pack(db, ev, false).leads === undefined,
     '동의자 수는 운영자만 본다');
  ok(!JSON.stringify(pack(db, ev, false)).includes('@'),
     '열쇠 없이 받은 집계에도 연락처가 없다');
  db.prepare('DELETE FROM checks WHERE team=?').run(fwTeam);

  // 전체 공지 — 한 시간만 산다
  const nEv = createEvent(db, { title: '공지시험', starts: today(), ends: today() });
  db.prepare('UPDATE events SET notice=?, notice_at=? WHERE id=?')
    .run('점심 도착했습니다', new Date().toISOString(), nEv.id);
  ok(tv(db, nEv.id).notice === '점심 도착했습니다', '공지가 큰 화면에 실린다');
  ok(board(db, nEv.id, false).event.notice === '점심 도착했습니다', '공지가 공개 화면에도 실린다');
  db.prepare('UPDATE events SET notice_at=? WHERE id=?')
    .run(new Date(Date.now() - 2 * 3600 * 1000).toISOString(), nEv.id);
  ok(tv(db, nEv.id).notice === '', '한 시간이 지난 공지는 사라진다');
  db.prepare("UPDATE events SET notice='', notice_at='' WHERE id=?").run(nEv.id);
  ok(!noticeOf(db.prepare('SELECT * FROM events WHERE id=?').get(nEv.id)), '비우면 없어진다');
  db.prepare('DELETE FROM events WHERE id=?').run(nEv.id);

  // 협찬사에게 넘길 한 벌 — 개인 식별 정보가 한 칸도 없어야 한다
  const pk = pack(db, ev, true);
  ok(pk.numbers.teams === outcomes(db, ev).teams, '협찬사 한 벌에 참가 팀 수가 실린다');
  ok(!JSON.stringify(pk).includes('@'), '협찬사 한 벌에 연락처가 안 실린다');
  ok(pk.mix.role.every(r => r.c >= 3 || r.merged), '세 건 미만인 칸은 뭉쳐서 나간다');
  ok(safeCount([{ k: 'ㄱ', c: 1 }, { k: 'ㄴ', c: 1 }]).length === 1
     && safeCount([{ k: 'ㄱ', c: 1 }, { k: 'ㄴ', c: 1 }])[0].c === 2,
     '작은 칸 둘이 하나로 합쳐진다');
  ok(safeCount([{ k: 'ㄱ', c: 5 }])[0].k === 'ㄱ', '세 건 이상은 그대로 둔다');
  ok(typeof pk.leads === 'number' && !pk.sponsors.some(x => x.contact),
     '동의자 수만 세고 명단은 안 담는다');

  const spId = db.prepare('SELECT id FROM sponsors WHERE event=?').get(ev);
  if (spId) {
    db.prepare("UPDATE sponsors SET kind='현금', done='0,2' WHERE id=?").run(spId.id);
    const pk2 = pack(db, ev, true).sponsors.find(x => x.id === spId.id);
    ok(pk2.total === TIERS['현금'].length, '등급을 고르면 약속이 자동으로 붙는다');
    ok(pk2.kept === 2 && pk2.promises[0].done && !pk2.promises[1].done,
       '지킨 약속만 표시된다 (' + pk2.kept + '/' + pk2.total + ')');
  }

  // 빌릴 수 있는 곳 — 네트워크 없이 거르는 규칙만 본다
  ok(parseCap('수용인원 120명입니다') === 120, '설명글에서 수용 인원을 뽑는다');
  ok(parseCap('정원 : 30 명') === 30, '띄어쓰기가 있어도 뽑는다');
  ok(parseCap('') === 0 && parseCap('수용인원 99999명') === 0, '없거나 말이 안 되면 안 쓴다');
  const fake = [
    { area: '마포구', kind: '강당', cap: 300, lo: 80, state: '접수중' },
    { area: '마포구', kind: '회의실', cap: 40, lo: 8, state: '접수중' },
    { area: '종로구', kind: '회의실', cap: 40, lo: 8, state: '접수종료' },
    { area: '마포구', kind: '회의실', cap: 12, lo: 8, state: '접수중' },
  ];
  const v24 = pickVenues(fake, 24);
  ok(!v24.some(r => r.cap < 24), '인원을 못 받는 곳은 안 나온다');
  ok(v24[0].cap <= v24[v24.length - 1].cap, '작은 곳부터 나온다 (빈 강당은 낭비다)');
  ok(pickVenues(fake, 24, '마포구').every(r => r.area === '마포구'), '지역으로 거른다');
  ok(pickVenues(fake, 24)[0].state === '접수중', '접수 중인 곳이 먼저 온다');
  ok(pickVenues(fake, 500).length === 0, '아무 데도 못 받으면 빈 목록을 준다');

  // 구하기 — 규모를 넣으면 필요한 것이 나온다
  const f24 = findHelp(24), f200 = findHelp(200);
  ok(f24.teams === 6, '24명이면 6팀 (' + f24.teams + ')');
  ok(f24.places.length > 0 && f24.places.every(x => x.max >= 24),
     '24명을 못 받는 곳은 안 나온다');
  ok(!f200.places.some(x => x.name.includes('카페')),
     '200명에 카페 통대관은 안 나온다');
  ok(f200.room.outlets > f24.room.outlets, '사람이 많으면 콘센트도 많이 필요하다');
  ok(f200.need.find(r => r.role === '심사위원').count
     > f24.need.find(r => r.role === '심사위원').count, '규모가 크면 심사위원도 는다');
  ok(f24.need.find(r => r.role === '운영 대행').count === 0,
     '작은 대회에 운영 대행은 0명이다');
  ok(findHelp(0).size >= 1 && findHelp(99999).size <= 2000, '이상한 인원은 잘라 낸다');

  // 후보 대장
  const ldEv = createEvent(db, { title: '대장시험' });
  db.prepare('INSERT INTO leads(event,kind,name,how) VALUES(?,?,?,?)')
    .run(ldEv.id, '장소', '어느센터', 'you@x.test');
  const ld = db.prepare('SELECT * FROM leads WHERE event=?').all(ldEv.id);
  ok(ld.length === 1 && ld[0].state === '보냄', '연락한 곳이 보냄 상태로 남는다');
  db.prepare('DELETE FROM events WHERE id=?').run(ldEv.id);
  ok(!db.prepare('SELECT 1 FROM leads WHERE event=?').get(ldEv.id),
     '대회를 지우면 대장도 따라 지워진다');

  // 목록 공개 — 이름만 넣은 대회는 첫 화면에 안 뜬다
  const bare = createEvent(db, { title: '이름만넣은대회' }).id;
  ok(db.prepare('SELECT listed FROM events WHERE id=?').get(bare).listed === 0,
     '만들자마자는 목록에 안 뜬다');
  const miss = getEvent(db, bare).missing;
  ok(miss.includes('여는 사람') && miss.includes('날짜') && miss.includes('제출 마감'),
     '무엇이 비었는지 알려 준다 (' + miss.join() + ')');
  editEvent(db, bare, { host: '유재원', starts: '2026-12-05', ends: '2026-12-05',
                        due: '2026-12-05T17:00' });
  ok(getEvent(db, bare).missing.length === 0, '채우면 빈 것이 없어진다 ('
     + JSON.stringify(getEvent(db, bare).missing) + ')');
  db.prepare('UPDATE events SET listed=1 WHERE id=?').run(bare);
  ok(db.prepare('SELECT COUNT(*) c FROM events WHERE listed=1').get().c === 1,
     '공개한 것만 목록에 든다');
  db.prepare('DELETE FROM events WHERE id=?').run(bare);

  // 제출할 때 AI 를 어떻게 썼는지 남긴다.
  // 따로 연 대회에서 본다 — 여기에 제출을 하나 더하면 아래 제출 현황 검사가 흔들린다.
  const evAI = createEvent(db, { title: 'AI기록시험' }).id;
  const ta = joinTeam(db, evAI, { name: '기록팀', agree: true });
  submit(db, ta, { url: 'https://example.com/b', aiuse: '화면 만들 때', aidrop: '추천 로직은 버렸다' });
  const sb = board(db, evAI, true).rows.find(r => r.id === ta);
  ok(sb.aiuse === '화면 만들 때' && sb.aidrop === '추천 로직은 버렸다', 'AI 사용 기록이 남는다');
  db.prepare('DELETE FROM events WHERE id=?').run(evAI);

  // 팀 짜기 — 혼자 온 사람과 자리 남은 팀
  const soloTeam = joinTeam(db, ev, { name: '혼자온사람', agree: true, solo: true, role: '기획' });
  moreTeam(db, t2, { want: '만드는 사람 한 분' }, { admin: true });
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
  /* 미제출 명단은 마감 한 시간 전부터만 나온다. 종일 벽에 걸어 두면 망신이다. */
  ok(tv0.waiting.length === 0, '마감이 멀면 미제출 명단이 안 나온다');
  /* toISOString 은 UTC 다. 마감 시각은 타임존 없는 로컬 문자열이라 그대로 쓰면 9시간 밀린다. */
  const soon = new Date(Date.now() + 20 * 60000);
  const pad2 = v => String(v).padStart(2, '0');
  const dueSoon = `${soon.getFullYear()}-${pad2(soon.getMonth() + 1)}-${pad2(soon.getDate())}`
                + `T${pad2(soon.getHours())}:${pad2(soon.getMinutes())}`;
  editEvent(db, ev, { due: dueSoon });
  ok(tv(db, ev).waiting.includes('나팀'), '마감이 임박하면 아직 안 낸 팀이 나온다');
  ok(tv(db, ev).urgent === true, '마감 임박을 알린다');
  editEvent(db, ev, { due: '' });
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
  const spEv = createEvent(db, { title: '로고시험' });
  db.prepare('INSERT INTO sponsors(event,name,kind,amount,note,logo,link) VALUES(?,?,?,?,?,?,?)')
    .run(spEv.id, '어떤회사', '크레딧', 0, '', 'https://x.test/l.png', 'https://x.test');
  ok(tv(db, spEv.id).sponsors[0].logo === 'https://x.test/l.png', '큰 화면에 협찬 로고가 실린다');
  ok(webUrl('https://x.test/a.png') === 'https://x.test/a.png', 'http(s) 주소는 통과한다');
  ok(webUrl('javascript:alert(1)') === '', 'javascript: 주소는 버린다');
  ok(webUrl('JaVaScRiPt:alert(1)') === '', '대소문자를 섞어도 버린다');
  ok(webUrl('data:text/html,<script>') === '', 'data: 주소도 버린다');
  ok(webUrl('  https://x.test  ') === 'https://x.test', '앞뒤 공백은 털어 낸다');
  ok(tv(db, spEv.id).sponsors[0].amount === undefined, '큰 화면에 협찬 금액은 안 실린다');
  db.prepare('DELETE FROM events WHERE id=?').run(spEv.id);
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

  // ── 빈자리 판 · 공개 장부 · 2주 확인 (PLAN.md §API) ──
  const nbEv = createEvent(db, { title: '빈자리시험' });
  /* 운영자 열쇠 없이는 자리를 못 올린다. needAdmin 이 막히면 뒤의 addNeed 는 안 간다 */
  let 락 = false;
  try { needAdmin(db, nbEv.id, '틀린열쇠', ''); addNeed(db, nbEv.id, { kind: 'venue', label: '장소' }); }
  catch { 락 = true; }
  ok(락, '운영자 열쇠 없이는 자리를 못 올린다');

  const n1 = addNeed(db, nbEv.id, { kind: 'venue', label: '주말 대관 한 곳', qty: 2, note: '콘센트 많은 곳' });
  ok(n1.kind === 'venue' && n1.filled === 0 && n1.pledges.length === 0 && n1.note === '콘센트 많은 곳',
     '운영자가 자리를 올린다');
  ok(addNeed(db, nbEv.id, { kind: 'party', label: '이상한 종류' }).kind === 'other',
     '모르는 종류는 other 로 둔다');
  addNeed(db, nbEv.id, { kind: 'snack', label: '<script>alert(1)</script>간식',
                         note: '<img src=x onerror=alert(1)>' });
  ok(!JSON.stringify(needsOf(db, nbEv.id)).includes('<'), '라벨·메모의 꺾쇠는 저장 전에 뺀다');

  /* 누구나 신청한다. 연락처는 운영자가 볼 것 - 공개 응답 어디에도 안 실린다 */
  const pg1 = addPledge(db, n1.id, nbEv.id,
    { name: '김실무', org: '어느회사', contact: 'kim@x.test', note: '심사도 같이 봅니다' });
  ok(pg1.status === 'pending', '신청은 pending 으로 시작한다');
  ok(db.prepare('SELECT contact FROM pledges WHERE id=?').get(pg1.id).contact === 'kim@x.test',
     '연락처는 저장된다 - 운영자가 본다');
  const pubN = needsOf(db, nbEv.id).find(x => x.id === n1.id);
  ok(pubN.pledges.length === 1 && pubN.pledges[0].name === '김실무'
     && pubN.pledges[0].org === '어느회사' && pubN.pledges[0].status === 'pending',
     '신청이 자리에 붙는다');
  ok(!('contact' in pubN.pledges[0])
     && !JSON.stringify(needsOf(db, nbEv.id)).includes('kim@x.test'),
     '공개 needs 응답에 연락처가 안 실린다');
  ok(pubN.filled === 0, 'pending 는 아직 채운 것이 아니다');
  ok(!JSON.stringify(ledgerOf(db, nbEv.id)).includes('김실무'), 'pending 는 장부에도 안 나온다');

  /* 운영자가 확인하면 공개 장부에 이름이 남는다 */
  setPledge(db, pg1.id, { status: 'ok' });
  const led = ledgerOf(db, nbEv.id);
  ok(led.length === 1 && led[0].name === '김실무' && led[0].status === 'ok' && !!led[0].at,
     '확인하면 공개 장부에 이름이 남는다');
  ok(Object.keys(led[0]).sort().join() === 'at,kind,label,name,org,status', '장부 칸이 약속과 같다');
  const pg2 = addPledge(db, n1.id, nbEv.id, { name: '아직인사람', contact: 'wait@x.test' });
  ok(ledgerOf(db, nbEv.id).length === 1, '새 pending 는 장부에 안 나온다');
  setPledge(db, pg2.id, { status: 'no' });
  ok(ledgerOf(db, nbEv.id).length === 1, '거절한 신청도 장부에 안 나온다');
  setPledge(db, pg1.id, { status: 'done' });
  ok(needsOf(db, nbEv.id).find(x => x.id === n1.id).filled === 1,
     'ok·done 은 자리를 채운 것으로 센다');
  let 이상한상태 = false;
  try { setPledge(db, pg1.id, { status: 'maybe' }); } catch { 이상한상태 = true; }
  ok(이상한상태, '상태는 정해진 넷 중 하나다');

  /* 2주 확인 - 팀 열쇠나 신청 때 적은 연락처로만 쓴다 */
  let 막힘 = false;
  try { addFollowup(db, nbEv.id, { tool: '뭔가' }, { headers: {} }); } catch { 막힘 = true; }
  ok(막힘, '열쇠나 연락처 없이는 2주 확인을 못 쓴다');
  const f1 = joinTeam(db, nbEv.id, { name: '후팀가', agree: true, contact: 'f1@x.test' });
  const f2 = joinTeam(db, nbEv.id, { name: '후팀나', agree: true, contact: 'f2@x.test' });
  const f3 = joinTeam(db, nbEv.id, { name: '후팀다', agree: true, contact: 'f3@x.test' });
  const f4 = joinTeam(db, nbEv.id, { name: '후팀라', agree: true, contact: 'f4@x.test' });
  addFollowup(db, nbEv.id, { tool: '핵온도구', still_using: 1, note: '계속 씁니다' },
    { headers: { 'x-tkey': db.prepare('SELECT tkey FROM teams WHERE id=?').get(f1).tkey } });
  addFollowup(db, nbEv.id, { tool: '핵온도구', still_using: 1, contact: 'f2@x.test' }, { headers: {} });
  addFollowup(db, nbEv.id, { tool: '핵온도구', still_using: 0,
    tkey: db.prepare('SELECT tkey FROM teams WHERE id=?').get(f3).tkey }, { headers: {} });
  addFollowup(db, nbEv.id, { tool: '딴도구', still_using: 1, contact: 'f4@x.test' }, { headers: {} });
  /* 다시 쓰면 팀이 늘지 않고 덮어쓴다 */
  addFollowup(db, nbEv.id, { tool: '핵온도구', still_using: 0, contact: 'f2@x.test' }, { headers: {} });
  const sum = followSummary(db, nbEv.id);
  const ht = sum.tools.find(x => x.tool === '핵온도구');
  ok(ht && ht.teams === 3 && ht.still_using === 1,
     '도구별로 몇 팀이 아직 쓰는지 모은다 (다시 쓰면 덮어쓴다)');
  ok(sum.tools.some(x => x.merged), '세 팀 미만 도구는 뭉쳐서 나간다');
  const sumTxt = JSON.stringify(sum);
  ok(!sumTxt.includes('후팀') && !sumTxt.includes('@') && !sumTxt.includes('계속'),
     '요약에 팀 이름·연락처·메모가 안 나간다');

  /* 운영자가 신청자 연락처를 보는 명단. pending 가 하나 있어야 점판 숫자 검사도 공이니 하나 추가한다 */
  addPledge(db, n1.id, nbEv.id, { name: '대기중인사람', contact: 'pen@x.test' });
  let 열쇠없음 = false;
  try { needAdmin(db, nbEv.id, '', ''); } catch { 열쇠없음 = true; }
  ok(열쇠없음, '열쇠 없이는 신청 명단을 못 본다');
  const 남의대회 = createEvent(db, { title: '남의대회' });
  let 남의열쇠 = false;
  try { needAdmin(db, nbEv.id, 남의대회.okey, ''); } catch { 남의열쇠 = true; }
  ok(남의열쇠, '다른 대회 열쇠로도 신청 명단을 못 본다');
  db.prepare('DELETE FROM events WHERE id=?').run(남의대회.id);
  const pls = pledgesOf(db, nbEv.id);
  ok(pls.some(p => p.id === pg1.id && p.contact === 'kim@x.test' && p.status === 'done'
                  && p.kind === 'venue' && p.label === n1.label),
     '맞는 열쇠로는 연락처가 포함된 명단을 본다');
  ok(Object.keys(pls[0]).sort().join()
     === 'contact,created,id,kind,label,name,need,note,org,status', '신청 명단 칸이 약속과 같다');

  /* 자리 점판 — 숫자를 박지 않고 needs 목록에서 직접 세어 비교한다 */
  const 점판 = needsSummary(db, nbEv.id);
  const 직접 = { total: 0, filled: 0, pending: 0 }, 직접종류 = {};
  for (const n of needsOf(db, nbEv.id)) {
    const pen = n.pledges.filter(p => p.status === 'pending').length;
    직접.total += n.qty; 직접.filled += n.filled; 직접.pending += pen;
    const k = 직접종류[n.kind] || (직접종류[n.kind] = { qty: 0, filled: 0, pending: 0 });
    k.qty += n.qty; k.filled += n.filled; k.pending += pen;
  }
  ok(점판.total === 직접.total && 점판.filled === 직접.filled && 점판.pending === 직접.pending
     && 직접.total > 0 && 직접.pending > 0, '자리 점판 숫자가 needs 에서 직접 센 값과 같다');
  ok(점판.kinds.length > 0 && 점판.kinds.every(k =>
     k.qty === 직접종류[k.kind].qty && k.filled === 직접종류[k.kind].filled
     && k.pending === 직접종류[k.kind].pending), '종류별 숫자도 직접 센 값과 같다');
  ok(!JSON.stringify(점판).includes('@x.test'), '자리 점판 응답에 연락처가 안 실린다');

  db.prepare('DELETE FROM events WHERE id=?').run(nbEv.id);
  ok(!db.prepare('SELECT 1 FROM needs WHERE event=?').get(nbEv.id),
     '대회를 지우면 빈자리 판도 따라 지워진다');

  db.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });
  ok(Array.isArray(lanIPs()), '랜 주소를 찾는다 (' + (lanIPs()[0] || '없음') + ')');



  // 심사 계획 — MLH 가이드의 예시(175팀·2시간 → 18명)와 맞는지로 검산한다


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
                   card, support, assign, spread, judgeView, lanIPs, findHelp, webUrl, pack, safeCount, TIERS, draftPlan, planWarn, follow, closed, KINDS, RUBRICS, logoFor, pidOf, profile, hostRep, seats, setSeats, shrink, LEVELS, pickVenues, parseCap, noticeOf, tv, crew, mine, record,
                   dump, backup, isAdmin,
                   addNeed, addPledge, setPledge, needsOf, ledgerOf, addFollowup, followSummary,
                   pledgesOf, needsSummary };
