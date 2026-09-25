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
  check: 15,     // 팀 짜기 뒤 «계획 1분 발표» — 초반 체크포인트가 완주를 올린다(Nolte, CSCW 2020)
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
  /* 초반 필수 체크포인트 — 팀마다 «무엇을 만들지» 1분씩. 아이디어를 초반에 잡아 주면 완주율이 오른다(Nolte, 뉴커머 멘토링 CSCW 2020) */
  rows.push({ at: hhmm(t), what: '계획 1분 발표 · 멘토 점검' }); t += R.check;

  /* 12시를 지나면 점심을 넣는다. 안 넣으면 그 시간에 절반이 사라진다. */
  if (t <= 12 * 60 + 30 && z - tail > 13 * 60) {   /* 12시 반까지 만들기가 못 시작하면 점심부터 — 아침 순서가 12시를 살짝 넘겨도 */
    const lunchAt = Math.max(12 * 60, t);
    rows.push({ at: hhmm(lunchAt), what: '점심' });
    t = lunchAt + R.lunch;
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
  const e = db.prepare('SELECT ends, due FROM events WHERE id=?').get(event);
  const base = e ? new Date(e.ends) : new Date();
  /* 마감 전에는 손님에게 제출 링크를 안 준다 — board() 와 같은 규칙.
     이걸 빼먹으면 순위판이 숨긴 링크가 여기로 새서 뒤에 내는 팀이 먼저 낸 팀 것을 본다. */
  const hideUrl = !admin && !!e && !closed(e);
  const teams = db.prepare(`SELECT t.id, t.name, s.url FROM teams t
                            LEFT JOIN submissions s ON s.team = t.id
                            WHERE t.event=? ORDER BY t.id`).all(event);
  const all = db.prepare(`SELECT c.* FROM checks c JOIN teams t ON t.id=c.team
                          WHERE t.event=?`).all(event);
  const rows = teams.map(t => ({
    id: t.id, name: t.name, url: hideUrl ? '' : (t.url || ''),
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
/* ── 예산 배분 산식 ──
   여는 사람이 «금액 하나»만 정하면 그 돈을 자리(장소·간식·상품·심사)로 나눠 카드로 깐다.
   숫자는 전부 «기본값(추정)»이다. 근거가 있는 것만 적는다 -
   구간 경계 30만(PLAN §2 «상금은 없거나 30만 원»)·100만(PLAN §3 «현금 소액 100만원 이하»),
   간식 1인 6,000원, 심사위원은 열 팀 이하 3명(PLAN §12-1). 나머지 비율은 추정이라 화면에 그렇게 적는다.
   앱은 돈을 만지지 않는다. «얼마를 어디에 쓰기로 했나»를 카드로 보여 줄 뿐이고 정산은 운영자와 제공자가 직접 한다.
   한 곳에만 둔다 - 문서·화면·검사가 전부 여기를 본다. */
const BUDGET_RULE = {
  tiers: [['zero', 0], ['small', 300000], ['mid', 1000000], ['big', Infinity]],
  snackPer: 6000,          // 간식 1인 (GUIDE §4)
  judgeFee: { big: 200000 },   // 심사 사례 1인 «기본값(추정)». 큰 금액 구간에서만. 그 아래는 무보수가 표준
  unit: 1000,              // 원 단위 내림
};
function tierOf(budget) {
  const b = Math.max(0, Math.floor(+budget || 0));
  for (const [k, max] of BUDGET_RULE.tiers) if (b <= max) return k;
  return 'big';
}
/** 예산과 정원으로 자리 카드 초안을 만든다. 순수 함수 - DB 를 모른다.
    반환하는 rows 의 amount 합은 절대 budget 을 넘지 않는다(검사가 잠근다). */
function allocate(budget, cap) {
  const B = Math.max(0, Math.floor(+budget || 0));
  const n = Math.max(1, Math.min(2000, +cap || 20));
  const R = BUDGET_RULE, u = R.unit;
  const dn = x => Math.max(0, Math.floor(x / u) * u);
  const tier = tierOf(B);
  const rows = [];
  const add = (kind, label, qty, amount, note) => rows.push({ kind, label, qty, amount: dn(amount), note });
  if (tier === 'zero') return { tier, mode: 'online', budget: B, rows, left: 0 };
  if (tier === 'small') {
    const snack = Math.min(n * R.snackPer, B * 0.6);
    add('venue', '장소', 1, 0, '무료로 내줄 곳을 찾는 판입니다. 돈은 간식·상품에만 씁니다');
    add('judge', '심사위원', 2, 0, '무보수. 관객 평가(별점)를 같이 켭니다');
    add('snack', '간식', 1, snack, `${n}명 × ${R.snackPer.toLocaleString()}원 기준`);
    add('prize', '상품', 1, B - dn(snack), '남는 돈 전부. 상품권이 무난합니다');
  } else if (tier === 'mid') {
    const venue = B * 0.30, snack = Math.min(n * R.snackPer, B * 0.20);
    add('venue', '장소', 1, venue, '30% 기본값(추정). 무료로 확보되면 이 돈은 상품으로');
    add('snack', '간식', 1, snack, `${n}명 × ${R.snackPer.toLocaleString()}원 기준`);
    /* 심사는 무보수가 소규모 커뮤니티 해커톤의 국제 표준(기획메모). 기본값을 사례비로 두면
       한 번도 안 고친 운영자에게 문서와 반대되는 판이 깔린다. 사례를 주려면 고친다. */
    add('judge', '심사위원', 3, 0, '무보수가 표준입니다. 사례를 주려면 금액을 고치세요');
    const used = dn(venue) + dn(snack);
    add('prize', '상품·상금', 1, B - used, '남는 돈 전부');
  } else {
    const judges = 3 + Math.floor(Math.max(0, n - 30) / 10);
    const fee = Math.min(R.judgeFee.big, (B * 0.16) / judges);
    const prize = B * 0.40, venue = B * 0.20, snack = Math.min(B * 0.12, n * R.snackPer * 2), promo = B * 0.08;
    add('prize', '상금', 1, prize, '40% 기본값(추정)');
    add('venue', '장소', 1, venue, '20% 기본값(추정)');
    add('judge', '심사위원', judges, fee, '1인 사례 기본값(추정)');
    add('snack', '식사·간식', 1, snack, `${n}명 기준`);
    add('other', '홍보·기록', 1, promo, '포스터·사진·영상');
    const used = rows.reduce((a, r) => a + r.amount * r.qty, 0);
    add('other', '예비', 1, B - used, '남는 돈. 큰 금액은 운영자가 직접 나누세요');
  }
  const used = rows.reduce((a, r) => a + r.amount * r.qty, 0);
  return { tier, mode: 'onsite', budget: B, rows, left: B - used };
}

/** 산식 결과를 needs 로 굽는다. 산식이 만든 줄(auto=1) 중 손대지 않은 것(held=0)과
    아직 아무도 맡지 않은 것만 갈아엎는다. 손으로 올린 자리(auto=0)는 절대 안 건드린다. */
function reallocate(db, event) {
  const e = db.prepare('SELECT budget, cap, mode FROM events WHERE id=?').get(event);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  const a = allocate(e.budget, e.cap);
  const pledged = new Set(db.prepare('SELECT DISTINCT need FROM pledges WHERE event=?').all(event).map(r => r.need));
  const olds = db.prepare('SELECT id, held FROM needs WHERE event=? AND auto=1').all(event);
  let kept = 0;
  for (const o of olds) {
    if (o.held || pledged.has(o.id)) { kept++; continue; }
    db.prepare('DELETE FROM needs WHERE id=?').run(o.id);
  }
  /* 손으로 올린 자리(auto=0)와 같은 종류는 안 깐다. 안 그러면 «장소»와 «장소 ₩X»가 한 판에 같이 산다.
     그 종류는 건너뛰고 알린다 - 돈은 운영자가 그 손 자리에 직접 적으면 된다. */
  const manualKinds = new Set(db.prepare('SELECT DISTINCT kind FROM needs WHERE event=? AND auto=0').all(event).map(r => r.kind));
  const skipped = a.rows.filter(r => manualKinds.has(r.kind)).map(r => r.kind);
  const ins = db.prepare('INSERT INTO needs(event,kind,label,qty,note,amount,auto) VALUES(?,?,?,?,?,?,1)');
  let made = 0;
  for (const r of a.rows) { if (manualKinds.has(r.kind)) continue; ins.run(event, r.kind, r.label, r.qty, r.note, r.amount); made++; }
  /* 0원이면 온라인판. 심사 카드가 없으니 관객 평가를 같이 켠다(운영 화면에서 끌 수 있다). */
  if (a.tier === 'zero') db.prepare("UPDATE events SET mode='online', vmode=1 WHERE id=?").run(event);
  /* 산식 출력만 보면 합이 예산 이하지만, 손고침으로 남은 줄까지 더하면 넘을 수 있다. 판 전체를 다시 센다. */
  const total = db.prepare('SELECT COALESCE(SUM(amount*qty),0) s FROM needs WHERE event=?').get(event).s;
  return { ...a, kept, made, skipped, total, over: total > a.budget };
}

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
  /* 포도 한 상자·커피·간식 같은 현물. 답례는 이름과 «○○ 제공» 현장 안내다. 작은 후원이 후원을 부른다 */
  '현물':   ['공개 페이지와 첫 화면에 이름', '현장 안내에 «○○ 제공»', '결과 보고서에 이름'],
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
    /* 후원자·의뢰자에게 상위 셋만 보였다. 준 사람이 결과물 «전체»를 볼 수 있어야
       후원의 «받는 것»이 생긴다. 연락처는 여기에도 없다 — 공개 장부와 같은 선. */
    all: closed(e) ? board(db, event, true).rows
      .filter(r => r.url)
      .map(r => ({ rank: r.rank, name: r.name, note: r.note, url: r.url })) : [],
    top: closed(e) ? board(db, event, true).rows
      .filter(r => r.url).slice(0, 3)
      .map(r => ({ rank: r.rank, name: r.name, note: r.note, url: r.url,
                   aiuse: r.aiuse, aidrop: r.aidrop,
                   /* 연락해도 되는 팀인지. 동의한 팀만 true 다. */
                   reachable: !!r.sponsor_ok })) : [],
    /* 끝난 뒤 설문(추천·좋았던 것·고칠 것). 세 건 미만이면 숫자 없음 */
    survey: surveySummary(db, event, admin),
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
  /* 수상 — 끝난 대회에서 순위 3 안. 순위는 board 가 매긴 것을 그대로 쓴다(여기서 다시 안 센다). */
  let wins = 0;
  for (const r of past) if (r.made) {
    try { const b = board(db, r.event, true).rows.find(x => x.id === r.id); if (b && b.rank && b.rank <= 3) wins++; } catch {}
  }
  const skillAvg = rt.length ? rt.reduce((a, r) => a + r.skill, 0) / rt.length : 0;
  const tier = rankOf(made, wins, skillAvg, rt.length);

  return {
    id: me.id, handle: me.handle, level: me.level,
    events: past.length, wins, tier, xp: xpOf(db, pid),
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

/* 기여(XP) — 비트코인의 채굴처럼, 남을 위해 한 일이 곧 내 기록이 된다.
   완주·참가·동료 평가 주기·문제 올리기·풀이 보내기·판정하기·자리 맡기. 전부 «연락처 해시 = 사람» 하나에 모인다.
   ponytail: 사람 수만큼 전체 표를 훑는다(pidOf 는 HMAC 이라 SQL 로 못 잇는다). 수천 명 넘으면 solutions·requests·pledges 에 pid 열을 둔다 */
const XP = { made: 10, came: 3, rated: 2, ratedEvent: 2, solved: 5, asked: 3, judged: 3, pledged: 5 };
const XP_LABEL = { made: '완주', came: '참가', rated: '동료 평가 주기', ratedEvent: '대회 평가 주기', solved: '문제 풀이', asked: '문제 올리기', judged: '풀이 판정', pledged: '자리 맡기(확정)' };
function xpOf(db, pid) {
  const past = db.prepare(`SELECT t.came, s.url IS NOT NULL AS made FROM teams t JOIN events e ON e.id = t.event
                           LEFT JOIN submissions s ON s.team = t.id WHERE t.person=? AND e.ends < date('now')`).all(pid);
  const mine = rows => rows.filter(r => pidOf(db, r.contact) === pid).length;
  const n = {
    made: past.filter(r => r.made).length,
    came: past.filter(r => r.came).length,
    rated: db.prepare('SELECT COUNT(*) c FROM ratings WHERE giver=?').get(pid).c,
    ratedEvent: db.prepare('SELECT COUNT(*) c FROM event_ratings WHERE giver=?').get(pid).c,
    solved: mine(db.prepare("SELECT contact FROM solutions WHERE contact<>''").all()),
    asked: mine(db.prepare("SELECT contact FROM requests WHERE contact<>''").all()),
    judged: mine(db.prepare("SELECT r.contact FROM verdicts v JOIN requests r ON r.id = v.request WHERE r.contact<>''").all()),
    pledged: mine(db.prepare("SELECT contact FROM pledges WHERE status IN ('ok','done') AND contact<>''").all()),
  };
  const items = Object.keys(XP).filter(k => n[k] > 0).map(k => ({ key: k, label: XP_LABEL[k], count: n[k], xp: n[k] * XP[k] }));
  return { total: items.reduce((a, x) => a + x.xp, 0), items };
}
/* 순위 — 백준 랭킹처럼 기여 순. 이름을 정한 사람만 오른다(이름 없는 해시는 아무 뜻이 없다) */
function rank(db, limit = 50) {
  return db.prepare("SELECT id, handle FROM people WHERE handle<>''").all()
    .map(p => { const pr = profile(db, p.id); return { id: p.id, handle: p.handle, tier: pr.tier.name, level: pr.tier.level, finished: pr.finished, wins: pr.wins, xp: pr.xp.total }; })
    .filter(r => r.xp > 0).sort((a, b) => b.xp - a.xp || b.level - a.level).slice(0, limit);
}

/* 티어 5단계 — 캐글 progression(참가→기여→전문가→마스터→그랜드마스터)을 완주·수상·동료 실력으로 옮긴 것.
   티어가 곧 이력이 되려면 «완주» 가 바탕이어야 한다. 앉아만 있다 간 사람은 새싹에 머문다. */
const RANKS = [
  { name: '새싹',   need: () => true },
  { name: '브론즈', need: (m, w, s, n) => m >= 1 },
  { name: '실버',   need: (m, w, s, n) => m >= 3 || (m >= 1 && w >= 1) },
  { name: '골드',   need: (m, w, s, n) => m >= 5 && w >= 1 && (n < 3 || s >= 3.5) },
  { name: '플래티넘', need: (m, w, s, n) => m >= 10 && w >= 3 && n >= 3 && s >= 4 },
];
const TIER_NEXT = ['완주 1번이면 브론즈', '완주 3번 또는 완주 1 + 수상 1이면 실버', '완주 5 + 수상 1이면 골드', '완주 10 + 수상 3 + 동료 실력 4 이상이면 플래티넘', '가장 높은 단계입니다'];
function rankOf(made, wins, skill, n) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (RANKS[k].need(made, wins, skill, n)) i = k;
  return { name: RANKS[i].name, level: i, next: TIER_NEXT[i] };
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
/* 주소가 여럿이다(hackon.kr · hackon.mandeun.com). 돌아갈 주소를 SITE 하나로
   박으면 hackon.kr 에서 로그인한 사람이 다른 도메인으로 튕긴다. 들어온 주소로
   되돌린다. host 는 사용자가 보내는 값이라 목록에 있는 것만 쓴다. */
const SITES = (process.env.SITES || SITE).split(',')
  .map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
const siteOf = (req) => {
  const h = String(req.headers.host || '').toLowerCase();
  return SITES.find((x) => x.toLowerCase().replace(/^https?:\/\//, '') === h)
      || SITE || `http://${h || 'localhost'}`;
};

/* ── 검색 엔진 ─────────────────────────────────────────
   주소가 셋(hackon.kr · www · mandeun)이라 구글이 같은 글을 세 번 보고 점수를 나눈다.
   대표 주소는 SITES 의 첫 번째(hackon.kr). www. 로 오면 301 로 떼고,
   robots · sitemap 은 대표 주소로 쓴다. 화면 쪽 canonical 은 home.html 에 박혀 있다. */
const CANON = () => (SITES[0] || SITE || '').replace(/\/$/, '');
/* www.hackon.kr → https://hackon.kr. 목록(SITES)에 있는 주소로만 보낸다 — 열린 리다이렉트 방지 */
const wwwTo = (host) => {
  const h = String(host || '').toLowerCase();
  if (!h.startsWith('www.')) return '';
  const bare = h.slice(4);
  return SITES.some((s) => s.toLowerCase().replace(/^https?:\/\//, '') === bare) ? 'https://' + bare : '';
};
function robots() {
  return 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /j/\nDisallow: /p/\nDisallow: /r/\nDisallow: /s/\n'
    + (CANON() ? 'Sitemap: ' + CANON() + '/sitemap.xml\n' : '');
}
/* 열린 대회 줄 세우기.
   X 가 공개한 랭킹에서 하나를 빌렸다 — «가볍게 누른 것»과 «깊이 관여한 것»의 무게가
   스무 배 넘게 다르다(like 1 · reply 13.5 · retweet 20 · 글쓴이가 답하면 150).
   우리도 같다. 구경하러 온 사람보다 «한 자리 맡겠다»가 훨씬 센 신호다.
   신선도 감쇠는 해커뉴스 식(점수 / (나이+2)^중력)인데, 대회는 트윗보다 오래 살아서
   중력을 시간이 아니라 «일» 에 약하게 건다. */
const RANK = { team: 1, filled: 12, sponsor: 8, openSeat: 6, gravity: 0.45 };

function rankScore(r) {
  const engage = RANK.team * Math.min(r.teams || 0, 30)
    + RANK.filled * (r.filled || 0)
    + RANK.sponsor * Math.min((r.sponsors || []).length, 4)
    + (r.openNeeds > 0 ? RANK.openSeat : 0);
  const soon = r.dueDays <= 3 ? 1.6 : (r.dueDays <= 7 ? 1.25 : 1);
  const live = r.dueDays >= 0 ? 1 : 0.02;        /* 끝난 대회는 맨 아래로 */
  return live * soon * (1 + engage) / Math.pow(Math.max(r.ageDays, 0) + 2, RANK.gravity);
}

/* 저자 다양성(X 도 같은 이름으로 건다). 한 사람 대회가 연달아 오면
   목록이 «한 사람 놀이터»로 읽힌다. 다음 자리는 다른 주최자에게 먼저 준다. */
function spreadHosts(rows) {
  const rest = rows.slice(); const out = []; let last = null;
  while (rest.length) {
    let i = rest.findIndex((r) => r.host !== last);
    if (i < 0) i = 0;
    const [x] = rest.splice(i, 1);
    out.push(x); last = x.host;
  }
  return out;
}

/* ── 메일 — 이메일 한 채널만 (레드팀 09-25: 웹푸시·알림톡은 안 한다).
   Resend 한 곳에 fetch 로 보낸다. 의존성 0. RESEND_KEY 가 없으면 보내지 않고 장부에 «건너뜀»으로만 남긴다 —
   로컬·파일 모드가 그대로 돌아간다. 보내는 주소(MAIL_FROM)는 Resend 에서 도메인 확인을 마친 것이어야 한다. */
const RESEND_KEY = process.env.RESEND_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'HACK:ON <hi@mandeun.com>';
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || ''));
function logMail(db, m, status, err) {
  db.prepare('INSERT INTO mail_log(event,kind,ref,rcpt,subject,status,err) VALUES(?,?,?,?,?,?,?)')
    .run(m.event || '', m.kind || '', String(m.ref || ''), m.to || '', m.subject || '', status, String(err || '').slice(0, 200));
}
async function sendMail(db, m) {
  if (!isEmail(m.to)) return false;
  if (!RESEND_KEY) { logMail(db, m, 'skipped', 'RESEND_KEY 없음'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { authorization: 'Bearer ' + RESEND_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!r.ok) throw new Error('resend ' + r.status);
    logMail(db, m, 'sent'); return true;
  } catch (e) { logMail(db, m, 'failed', e.message); return false; }
}
const mailSite = () => SITES[0] || `http://localhost:${PORT}`;
/* 신청 직후 — 팀 링크를 메일로도 남긴다(GUIDE §9 «확인 메일은 즉시 보냅니다»). 링크를 잃으면 재확인도 못 한다(이탈 감사 P6). */
function joinMail(db, tid) {
  const t = db.prepare('SELECT t.id, t.name, t.contact, t.tkey, e.id AS event, e.title, e.starts FROM teams t JOIN events e ON e.id=t.event WHERE t.id=?').get(tid);
  if (!t || !isEmail(t.contact)) return null;
  return { event: t.event, kind: 'join', ref: t.id, to: t.contact, subject: `[HACK:ON] ${t.title} — 신청됐습니다. 팀 링크를 보관하세요`,
    text: `${t.name} 팀, 신청됐습니다.\n\n대회: ${t.title} (${t.starts || '날짜 미정'})\n팀 링크: ${mailSite()}/e/${t.event}?t=${t.tkey}\n\n이 링크가 팀 열쇠입니다. 나에게만 보관하세요. 폰을 바꿔도 이 링크로 되찾습니다.\n대회 3일 전과 하루 전에 «오시나요»를 한 번 더 묻습니다. 못 오게 되면 그 화면에서 «못 가요»를 눌러 주세요 — 그 자리가 다른 분께 갑니다.\n\n답장은 hi@mandeun.com 으로.` };
}
/* D-3·D-1 리마인더 — 이중 발송 자체에 건다(타이밍 확신은 낮다: 근거 RCT 가 병원 데이터, 레드팀 09-25).
   한 팀에 한 종류씩 한 번만. 못 온다고 한 팀·이메일 없는 팀·이미 답한 팀은 건너뛴다. 실패는 다음 시간에 다시. */
function remindDue(db, now = new Date()) {
  const out = [];
  for (const [kind, days] of [['d3', 3], ['d1', 1]]) {
    const day = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
    const rows = db.prepare(`SELECT t.id, t.name, t.contact, t.tkey, e.id AS event, e.title, e.starts
      FROM teams t JOIN events e ON e.id = t.event
      WHERE e.starts = ? AND t.confirmed = '' AND t.contact LIKE '%@%'
        AND NOT EXISTS (SELECT 1 FROM mail_log l WHERE l.kind = ? AND l.ref = CAST(t.id AS TEXT) AND l.status = 'sent')`).all(day, kind);
    for (const t of rows) if (isEmail(t.contact)) out.push({ event: t.event, kind, ref: t.id, to: t.contact,
      subject: `[HACK:ON] ${t.title} — ${days}일 뒤입니다. 오시나요?`,
      text: `${t.name} 팀, ${t.title} 이 ${t.starts} 에 열립니다. ${days}일 뒤입니다.\n\n아래 팀 링크를 열고 «올 거예요» 또는 «못 가요»를 눌러 주세요. 못 오시면 그 자리가 다른 분께 갑니다.\n${mailSite()}/e/${t.event}?t=${t.tkey}\n\n이 링크는 팀 열쇠입니다. 나에게만 보관하세요.` });
  }
  return out;
}

/* 의뢰자에게 «끝났다» — 붙은 대회가 마감됐고 제출물이 하나라도 있으면 받는 화면 링크를 한 번 보낸다.
   받는 화면(/r/)은 마감 뒤에만 결과물을 여니(server: publicRequest 규칙) 그 뒤에 부르는 게 맞다. */
function doneDue(db) {
  const rows = db.prepare(`SELECT r.id, r.rkey, r.contact, r.name, r.topic, r.pain, e.id AS event, e.title, e.ends, e.due
    FROM requests r JOIN events e ON e.id = r.event
    WHERE r.event <> '' AND r.contact LIKE '%@%'
      AND EXISTS (SELECT 1 FROM submissions s JOIN teams t ON t.id = s.team WHERE t.event = e.id AND s.url <> '')
      AND NOT EXISTS (SELECT 1 FROM mail_log l WHERE l.kind = 'done' AND l.ref = r.id AND l.status = 'sent')`).all();
  return rows.filter(r => closed(r) && isEmail(r.contact)).map(r => ({
    event: r.event, kind: 'done', ref: r.id, to: r.contact,
    subject: `[HACK:ON] «${r.topic || r.pain}» — 결과물이 준비됐습니다`,
    text: `${r.name} 님, 올리신 문제 «${r.topic || r.pain}» 로 ${r.title} 이 끝났습니다.\n\n받는 화면: ${mailSite()}/r/${r.id}?k=${r.rkey}\n\n결과물 주소와, 동의한 만든 분의 연락처가 있습니다. 「이거면 됩니다 / 아직 아니에요」를 남겨 주시면 만든 분에게 갑니다. 만든 분은 무료 외주가 아닙니다 — 이어 가려면 그분과 직접 정하세요.\n\n이 링크는 열쇠입니다. 나에게만 보관하세요.` }));
}

/* 자리가 난 만큼 대기자를 앞에서부터 팀으로 올린다. 올라간 팀에는 새 번호가 붙고(GUIDE §12) 팀 링크가 메일로 간다.
   이름이 그새 겹치면 그 줄은 버린다. 부르는 곳: 못 가요 · 팀 지움 · 정원 늘림. */
function promoteWaiting(db, event) {
  const out = [];
  for (;;) {
    const e = getEvent(db, event);
    if (!e.cap || e.seatsLeft === 0) break;
    const w = db.prepare('SELECT * FROM waitlist WHERE event=? ORDER BY id LIMIT 1').get(event);
    if (!w) break;
    db.prepare('DELETE FROM waitlist WHERE id=?').run(w.id);
    let tid;
    try { tid = joinTeam(db, event, { name: w.name, email: w.contact, share: !!w.share, agree: true, _promote: true }); }
    catch { continue; }
    if (typeof tid !== 'number') continue;
    const t = db.prepare('SELECT tkey FROM teams WHERE id=?').get(tid);
    out.push({ id: tid, name: w.name });
    void sendMail(db, { event, kind: 'promote', ref: tid, to: w.contact, subject: `[HACK:ON] ${e.title} — 자리가 났습니다. 팀이 됐습니다`,
      text: `${w.name} 팀, 대기하시던 ${e.title} 에 자리가 나서 팀으로 올라갔습니다.\n\n팀 링크: ${mailSite()}/e/${event}?t=${t.tkey}\n\n이 링크가 팀 열쇠입니다. 나에게만 보관하세요. 못 오게 되면 이 링크에서 «못 가요»를 눌러 주세요 — 다음 분께 자리가 갑니다.` });
  }
  return out;
}

/* 깃허브 링크에서 아이디만. github.com/아이디 또는 github.com/아이디/저장소 — 그 밖은 '' */
function ghLogin(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})(?:\/|$)/i.exec(String(url || '').trim());
  return m ? m[1] : '';
}
async function ghProfile(db, login) {
  const k = 'gh:' + login.toLowerCase();
  const c = db.prepare('SELECT v FROM meta WHERE k=?').get(k);
  if (c) { const v = JSON.parse(c.v); if (Date.now() - v.at < 86400000) return v.data; }
  let data = { ok: false };
  try {
    const h = { 'user-agent': 'hackon.kr', accept: 'application/vnd.github+json' };
    const u = await (await fetch(`https://api.github.com/users/${login}`, { headers: h, signal: AbortSignal.timeout(6000) })).json();
    if (u && u.login) {
      const rs = await (await fetch(`https://api.github.com/users/${login}/repos?per_page=100&sort=updated`, { headers: h, signal: AbortSignal.timeout(6000) })).json();
      const list = Array.isArray(rs) ? rs.filter(r => !r.fork) : [];
      const top = list.slice().sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 3)
        .map(r => ({ name: r.name, url: r.html_url, stars: r.stargazers_count, lang: r.language || '' }));
      data = { ok: true, login: u.login, repos: u.public_repos, stars: list.reduce((s, r) => s + r.stargazers_count, 0), top };
    }
  } catch {}
  if (data.ok) db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run(k, JSON.stringify({ at: Date.now(), data }));
  return data;
}

/* ── 해커온뉴스 — 제목·주소만 모은다(저작권: 본문 없음). 실패한 출처는 건너뛰고 나머지는 산다. ── */
const NEWS_SRC = { hf: '허깅페이스 모델', paper: '오늘의 논문', space: '허깅페이스 앱', ds: '허깅페이스 데이터', gh: '깃허브 새 저장소', ai: 'AI타임스', geek: 'GeekNews', hn: 'Hacker News', ph: 'Product Hunt', yozm: '요즘IT', hackon: 'HACK:ON 우승작', tip: '제보' };
/* RSS 도 Atom 도 같은 함수로 — GeekNews·Product Hunt 는 Atom(<entry>, <link href>)이라 RSS 정규식만 쓰면 조용히 0건이 된다(실제로 그랬다) */
function parseFeed(x, max) {
  const de = t => String(t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim();
  const out = [];
  for (const chunk of String(x).split(/<(?:item|entry)[\s>]/).slice(1)) {
    if (out.length >= max) break;
    const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(chunk);
    const l = /<link[^>]*href="([^"]+)"/.exec(chunk) || /<link[^>]*>([\s\S]*?)<\/link>/.exec(chunk);
    const url = de(l && l[1]), title = de(t && t[1]).slice(0, 140);
    if (title && /^https?:\/\//.test(url)) out.push({ title, url });
  }
  return out;
}
/* 직무 태그 — 제목 낱말로 거칠게. 틀리면 «전체» 로 남는다. 제보는 제보자가 고른다 */
const JOBS = ['마케팅', '기획', '디자인', '개발', '영업·CS', '데이터', '소상공인'];
const JOB_RE = {
  '마케팅': /마케팅|광고|브랜드|카피|sns|인스타|유튜브|콘텐츠|캠페인|marketing|ads?\b|brand|creator|influenc|seo/i,
  '디자인': /디자인|figma|ui|ux|이미지 생성|image|video|영상|일러스트|폰트|design|diffusion|flux|midjourney|canva/i,
  '데이터': /데이터|분석|sql|dashboard|대시보드|통계|analytics|dataset|엑셀|spreadsheet|bi\b/i,
  '영업·CS': /영업|세일즈|sales|crm|고객|cs\b|상담|챗봇|support|콜센터|리드/i,
  '기획': /기획|pm\b|product|프로덕트|노션|notion|로드맵|스펙|요구사항|workflow|자동화|automation|n8n|agent|에이전트/i,
  '소상공인': /가게|매장|자영업|소상공인|사장|카페|식당|배달|네이버 플레이스|예약|재고|pos\b/i,
  '개발': /개발|코드|code|github|api|모델|llm|오픈소스|open.?source|파이썬|python|javascript|typescript|rust|sdk|cli|프레임워크|framework|repo/i,
};
/* 좁은 것부터 본다 — «가게 예약 자동화» 는 기획(자동화)이 아니라 소상공인이다 */
const JOB_ORDER = ['소상공인', '마케팅', '디자인', '데이터', '영업·CS', '기획', '개발'];
function jobOf(title) { for (const j of JOB_ORDER) if (JOB_RE[j].test(String(title || ''))) return j; return ''; }
function addTip(db, ownerId, ownerName, b) {
  const job = JOBS.includes(b.job) ? b.job : '';
  const title = plain(b.title, 140), url = String(b.url || '').trim(), note = plain(b.note, 200);
  if (!title) throw new HttpError(400, '제목을 넣어 주세요');
  if (!/^https?:\/\//i.test(url) || url.length > 500) throw new HttpError(400, 'https:// 로 시작하는 주소를 넣어 주세요');
  if (db.prepare("SELECT COUNT(*) c FROM news WHERE owner=? AND at=date('now')").get(ownerId).c >= 5) throw new HttpError(429, '제보는 하루 다섯 건까지입니다');
  const r = db.prepare('INSERT OR IGNORE INTO news(src,key,title,url,note,job,by,owner) VALUES(?,?,?,?,?,?,?,?)').run('tip', url, title, url, note, job, plain(ownerName, 40), ownerId);
  if (!r.changes) throw new HttpError(409, '이미 올라온 주소입니다');
  return { id: Number(r.lastInsertRowid), job, title, url };
}
async function newsTick(db) {
  const got = [];
  const j = async u => { const r = await fetch(u, { headers: { 'user-agent': 'hackon.kr', accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : null; };
  try { for (const m of (await j('https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=8')) || [])
    got.push({ src: 'hf', title: m.id, url: 'https://huggingface.co/' + m.id, note: `♥ ${m.likes || 0}` }); } catch {}
  try { for (const p of (await j('https://huggingface.co/api/daily_papers?limit=8')) || []) if (p.paper && p.paper.title)
    got.push({ src: 'paper', title: p.paper.title, url: 'https://huggingface.co/papers/' + p.paper.id, note: `▲ ${p.paper.upvotes || 0}` }); } catch {}
  try { for (const sp of (await j('https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=5')) || [])
    got.push({ src: 'space', title: sp.id, url: 'https://huggingface.co/spaces/' + sp.id, note: `♥ ${sp.likes || 0}` }); } catch {}
  /* RSS 셋 — 제목·주소만. 어느 하나가 죽어도 나머지는 산다 */
  const de = t => String(t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  for (const [src, feed, max] of [['ai', 'https://www.aitimes.com/rss/allArticle.xml', 12], ['geek', 'https://news.hada.io/rss/news', 10], ['hn', 'https://hnrss.org/frontpage', 8],
                                  ['ph', 'https://www.producthunt.com/feed', 8], ['yozm', 'https://yozm.wishket.com/magazine/feed/', 8]]) {
    try {
      const x = await (await fetch(feed, { headers: { 'user-agent': 'hackon.kr' }, signal: AbortSignal.timeout(8000) })).text();
      for (const it of parseFeed(x, max)) got.push({ src, ...it, note: '' });
    } catch {}
  }
  /* 깃허브 — 이번 주 생긴 저장소 중 별 많은 것(트렌딩 API 는 없다). 데이터셋은 허깅페이스 */
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    for (const r of ((await j(`https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=6`)) || {}).items || [])
      got.push({ src: 'gh', title: r.full_name + (r.description ? ' — ' + String(r.description).slice(0, 80) : ''), url: r.html_url, note: `★ ${r.stargazers_count}`, job: '개발' });
  } catch {}
  try { for (const d of (await j('https://huggingface.co/api/datasets?sort=trendingScore&direction=-1&limit=4')) || [])
    got.push({ src: 'ds', title: d.id, url: 'https://huggingface.co/datasets/' + d.id, note: `♥ ${d.likes || 0}`, job: '데이터' }); } catch {}
  /* 우리 우승작 — 끝난 대회의 1위, 쇼케이스에 동의(show)한 팀만. */
  try {
    for (const e of db.prepare("SELECT id, title FROM events WHERE listed=1 AND ends < date('now') ORDER BY ends DESC LIMIT 20").all()) {
      const top = board(db, e.id, true).rows.find(r => r.rank === 1 && r.url && r.show);
      if (top) got.push({ src: 'hackon', title: `${e.title} — 1위 ${top.name}`, url: top.url, note: top.note || '' });
    }
  } catch {}
  const ins = db.prepare('INSERT OR IGNORE INTO news(src,key,title,url,note,job) VALUES(?,?,?,?,?,?)');
  let added = 0;
  for (const g of got) if (g.title && /^https?:\/\//.test(g.url)) added += Number(ins.run(g.src, g.url, String(g.title).slice(0, 160), g.url.slice(0, 500), String(g.note).slice(0, 200), g.src === 'hackon' ? '' : (g.job || jobOf(g.title))).changes);
  db.prepare("DELETE FROM news WHERE at < date('now','-30 days')").run();
  return { got: got.length, added };
}
function newsList(db, days = 9, job = '') {
  return db.prepare("SELECT src, title, url, note, at, job, by FROM news WHERE at >= date('now', ?) AND (?='' OR job=?) ORDER BY at DESC, id DESC").all(`-${days} days`, job, job);
}
/* 클로드에 붙여넣는 마크다운. 첫 줄이 «직무에 맞게 골라 달라» 는 지시라 링크만 복붙해도 된다. */
function newsMd(db, job = '') {
  const rows = newsList(db, 9, job);
  const by = {}; for (const r of rows) (by[r.at] = by[r.at] || []).push(r);
  let out = `# 해커온뉴스${job ? ' · ' + job : ''} — hackon.kr/news (${today()})\n\n` +
    `> 아래는 최근 9일 동안 새로 뜬 AI 모델·논문·앱·기사와 HACK:ON 우승작의 제목과 주소입니다.\n` +
    `> 내 직무를 말하면, 이 중에서 내 일에 바로 쓸 수 있는 것만 골라 «오늘 해 볼 것 3가지» 로 정리해 주세요. 본문은 주소를 열어 확인하세요.\n\n`;
  for (const d of Object.keys(by)) { out += `## ${d}\n`; for (const r of by[d]) out += `- [${r.title}](${r.url}) — ${NEWS_SRC[r.src] || r.src}${r.job ? ' · ' + r.job : ''}${r.by ? ' · 제보 ' + r.by : ''}${r.note ? ' · ' + r.note : ''}\n`; out += '\n'; }
  return out;
}

/* ── MCP — 카카오 PlayMCP·클로드에서 «hackon 대회 열어 줘» 가 되게. JSON-RPC 2.0 over HTTP, 읽기 셋 + 문제 올리기 하나.
   쓰기 도구는 문제 올리기뿐(누구나 /ask 에서 하는 것과 같다). 대회 열기는 로그인이 필요해 웹으로 보낸다. */
const MCP_TOOLS = [
  { name: 'list_hackathons', description: '지금 열려 있는 HACK:ON 대회 목록(제목·날짜·주최·남은 자리·주소)', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_problems', description: '문제 은행 — 가게·모임이 올린 «풀어 달라는 문제» 목록', inputSchema: { type: 'object', properties: {} } },
  { name: 'post_problem', description: '문제 올리기. name(가게·별명), pain(뭐가 번거로운지), done(«됐다»의 기준), contact(연락처, 만드는 팀만 봄)', inputSchema: { type: 'object', properties: { name: { type: 'string' }, pain: { type: 'string' }, done: { type: 'string' }, contact: { type: 'string' } }, required: ['name', 'pain', 'contact'] } },
  { name: 'news', description: '해커온뉴스 — 최근 새로 뜬 AI 모델·논문·도구·기사. job 으로 직무 필터(마케팅·기획·디자인·개발·영업·CS·데이터·소상공인)', inputSchema: { type: 'object', properties: { job: { type: 'string' } } } },
];
function mcpCall(db, msg) {
  const id = msg.id ?? null, m = msg.method || '';
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (m === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'hackon', version: '1' } });
  if (m === 'ping') return ok({});
  if (m.startsWith('notifications/')) return null;
  if (m === 'tools/list') return ok({ tools: MCP_TOOLS });
  if (m === 'tools/call') {
    const name = (msg.params || {}).name, a = (msg.params || {}).arguments || {};
    const text = t => ok({ content: [{ type: 'text', text: t }] });
    try {
      if (name === 'list_hackathons') {
        const rows = db.prepare("SELECT id,title,host,starts,ends,cap FROM events WHERE listed=1 AND ends >= date('now') ORDER BY starts LIMIT 20").all().map(e => getEvent(db, e.id));
        return text(rows.length ? rows.map(e => `- ${e.title} · ${e.starts}${e.ends !== e.starts ? '~' + e.ends : ''} · ${e.host} 주최 · 참가 ${e.teams}팀${e.cap ? ' · 남은 자리 ' + e.seatsLeft : ''} · ${mailSite()}/e/${e.id}`).join('\n') : '지금 열린 대회가 없습니다. 열려면 ' + mailSite() + '/app');
      }
      if (name === 'list_problems') {
        const rows = openRequests(db);
        return text(rows.length ? rows.map(r => `- [${r.id}] ${r.name}: ${r.topic || r.pain}${r.done ? ' (됐다의 기준: ' + r.done + ')' : ''} · 풀이 ${r.solutions}`).join('\n') + `\n\n풀이는 ${mailSite()}/problems 에서` : '올라온 문제가 없습니다.');
      }
      if (name === 'post_problem') { const r = addRequest(db, { kind: 'requester', name: a.name, pain: a.pain, done: a.done || '', contact: a.contact }); return text(`올렸습니다. 받는 링크(열쇠 포함, 본인만): ${mailSite()}/r/${r.id}?k=${r.rkey}`); }
      if (name === 'news') return text(newsMd(db, JOBS.includes(a.job) ? a.job : ''));
    } catch (e) { return text('실패: ' + e.message); }
    return err(-32602, '없는 도구입니다');
  }
  return err(-32601, '없는 메서드입니다');
}

/* 팀에 딸린 표를 이름으로 찾는다 — 스키마가 늘어도 휴지통이 반쪽이 안 되게. */
function teamChildTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('teams','team_trash')").all()
    .map(r => r.name)
    .filter(n => db.prepare(`PRAGMA table_info(${n})`).all().some(c => c.name === 'team'));
}
function trashTeam(db, teamId, by) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
  if (!t) throw new HttpError(404, '없는 팀입니다');
  const kids = {};
  for (const n of teamChildTables(db)) kids[n] = db.prepare(`SELECT * FROM ${n} WHERE team=?`).all(teamId);
  const r = db.prepare('INSERT INTO team_trash(team,event,name,tkey,json,by) VALUES(?,?,?,?,?,?)')
    .run(teamId, t.event, t.name, t.tkey, JSON.stringify({ team: t, kids }), by || '');
  for (const n of Object.keys(kids)) db.prepare(`DELETE FROM ${n} WHERE team=?`).run(teamId);
  db.prepare('DELETE FROM teams WHERE id=?').run(teamId);
  return Number(r.lastInsertRowid);
}
function untrashTeam(db, trashId) {
  const row = db.prepare('SELECT * FROM team_trash WHERE id=?').get(trashId);
  if (!row) throw new HttpError(404, '휴지통에 없습니다');
  const d = JSON.parse(row.json);
  const ins = (table, r) => {
    const ks = Object.keys(r);
    return Number(db.prepare(`INSERT INTO ${table}(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`)
      .run(...ks.map(k => r[k])).lastInsertRowid);
  };
  /* 같은 id 로 돌아오는 게 목표(팀 링크가 산다). 그 사이 누가 그 id 를 썼으면 새 id 로. 이름이 부딪히면 못 살린다. */
  let id;
  try { id = ins('teams', d.team); }
  catch {
    const { id: _drop, ...rest } = d.team;
    try { id = ins('teams', rest); }
    catch { throw new HttpError(409, '같은 이름의 팀이 새로 생겨 되살릴 수 없습니다. 그 팀 이름을 바꾼 뒤 다시 하세요'); }
  }
  for (const [n, rows] of Object.entries(d.kids || {})) for (const r of rows) {
    const { id: _k, ...rest } = r;
    try { ins(n, { ...rest, team: id }); } catch {}
  }
  db.prepare('DELETE FROM team_trash WHERE id=?').run(trashId);
  return { id, same: id === row.team, name: row.name };
}

/* 첫 화면 · 매뉴얼 · 아직 안 끝난 공개 대회. 끝난 대회는 빼서 검색에 죽은 링크가 안 남게 한다 */
/* ───────────────────────── 유입 ───────────────────────── */
/* 경로를 뭉친다. /e/ab12 가 천 줄 쌓이면 보이는 게 없다.
   목록에 없는 것(그림·스크립트·없는 주소)은 아예 안 센다 — 숫자가 의미를 잃는다. */
function visitPath(p) {
  if (/^\/e\//.test(p)) return '/e/';
  if (/^\/j\//.test(p)) return '/j/';
  if (/^\/tv\//.test(p)) return '/tv/';
  return ['/', '/app', '/manual'].includes(p) ? p : '';
}

/* 보낸 곳은 도메인만 남긴다. 주소 뒤에 붙는 것에 남의 개인 정보가 실려 올 수 있다.
   우리 사이트 안에서 넘어온 것은 «내부» 로 묶는다 — 유입이 아니다. */
function visitRef(ref, host) {
  if (!ref) return '직접';
  try {
    const from = new URL(ref).hostname.replace(/^www\./, '');
    const here = String(host || '').split(':')[0].replace(/^www\./, '');
    return from === here ? '내부' : from.slice(0, 60);
  } catch { return '직접'; }
}

function countVisit(db, p, ref, host) {
  const where = visitPath(p);
  if (!where) return;
  db.prepare(`INSERT INTO visits(day,path,ref,n) VALUES(date('now'),?,?,1)
              ON CONFLICT(day,path,ref) DO UPDATE SET n = n + 1`).run(where, visitRef(ref, host));
}

function visitsOf(db, days) {
  const d = Math.min(90, Math.max(1, Math.floor(+days || 7)));
  return db.prepare(`SELECT day, path, ref, n FROM visits
                     WHERE day >= date('now', ?) ORDER BY day DESC, n DESC`).all('-' + d + ' days');
}

function sitemap(db) {
  const base = CANON();
  const urls = ['/', '/manual'].concat(
    db.prepare("SELECT id FROM events WHERE listed=1 AND ends >= date('now') ORDER BY ends").all()
      .map((r) => '/e/' + r.id));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((x) => '<url><loc>' + base + x + '</loc></url>').join('\n') + '\n</urlset>\n';
}

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

    /* 유입 기록. 어느 화면을 몇 번 봤는지, 어디서 왔는지만 하루 단위로 센다.
       IP 도 사람도 남기지 않는다 — «어느 홍보가 먹혔나» 는 셈만 있으면 알 수 있고,
       그 이상을 남기면 지켜 줄 것이 늘어난다. */
    CREATE TABLE IF NOT EXISTS visits(
      day  TEXT NOT NULL,                -- YYYY-MM-DD
      path TEXT NOT NULL,                -- 본 화면. /e/<id> 는 /e/ 로 묶는다
      ref  TEXT NOT NULL DEFAULT '',     -- 보낸 곳. 도메인만 남긴다
      n    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, path, ref)
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
      show   INTEGER NOT NULL DEFAULT 0, -- 끝난 뒤 첫 화면 쇼케이스에 실어도 되는가 (본인 동의)
      show_at TEXT NOT NULL DEFAULT '',  -- 그 동의를 켠 시각. 증거는 이것뿐이다
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
      kind    TEXT NOT NULL DEFAULT 'other',   -- venue|cash|judge|prize|mentor|snack|other
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

    /* 자리 밖 제안. 운영자가 안 올린 역할이라도 '이거 제가 할 수 있어요' 를 앱에서 바로 보낸다.
       메일을 대신한다. 운영자가 확인하면 그 자리를 하나 만들어 확정 기여로 넘긴다.
       contact 는 운영자만 본다 - 공개 응답엔 절대 안 실린다(pledges 와 같은 규칙). */
    CREATE TABLE IF NOT EXISTS offers(
      id      INTEGER PRIMARY KEY,
      event   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      kind    TEXT NOT NULL DEFAULT 'other',   -- venue|cash|judge|prize|mentor|snack|other
      name    TEXT NOT NULL,
      org     TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      note    TEXT NOT NULL DEFAULT '',
      status  TEXT NOT NULL DEFAULT 'pending',  -- pending|ok|no
      created TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* 관객·참가자 상호평가. 심사위원을 못 구했을 때 그 자리를 대신한다.
       한 사람(voter 토큰)이 한 팀에 한 번, 1~5점. 현장 큰 화면의 QR 로 열어 폰으로 준다.
       심사 점수(scores)와 별개 테이블 — 섞이지 않는다. */
    CREATE TABLE IF NOT EXISTS votes(
      id     INTEGER PRIMARY KEY,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      voter  TEXT NOT NULL,
      score  INTEGER NOT NULL,   -- 1~5
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event, team, voter)
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
  /* 참석 재확인. 대회 며칠 전 «올 거예요/못 가요». '' 미응답 · ISO시각 = 온다 · 'no' = 못 온다.
     노쇼는 이걸로 «미리» 잡는다 — 당일 came 는 사후 기록일 뿐이다. */
  try { db.exec("ALTER TABLE teams ADD COLUMN confirmed TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 만든 것 링크(깃허브·포트폴리오·이 사이트 결과물). 선택. 팀 짜기 화면에서 «처음이에요»와 나란히 — 경력이 없어도 밀리지 않게 */
  try { db.exec("ALTER TABLE teams ADD COLUMN link TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 결과물을 필요한 분께 넘길 의향(«무료로 드려요» «5만원에» «협의»). 앱은 돈을 만지지 않는다 — 조건은 당사자가 직접 */
  try { db.exec("ALTER TABLE submissions ADD COLUMN sale TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 팀 휴지통. 지우면 팀 행과 딸린 것(제출·점수·심사평·투표…)을 JSON 으로 옮겨 둔다.
     되살리면 같은 id 로 돌아오니 참가자가 저장해 둔 팀 링크(tkey)가 그대로 산다.
     teams 를 읽는 SQL 이 80군데라 «지운 표시» 열을 넣으면 80곳을 다 고쳐야 한다 — 그래서 옮긴다. */
  /* 메일 장부. 보낸 것·못 보낸 것·발송 열쇠가 없어 건너뛴 것이 전부 남는다.
     리마인더는 «이 팀에 이 종류가 sent 로 있나»로 한 번만 보낸다. */
  db.exec(`CREATE TABLE IF NOT EXISTS mail_log(
    id INTEGER PRIMARY KEY, event TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
    rcpt TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', err TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL DEFAULT (datetime('now')))`);
  /* 대기자. 정원이 차면 teams 대신 여기 들어간다 — teams 를 읽는 SQL 80군데가 대기자를 팀으로 세지 않게.
     자리가 나면(못 가요·지움·정원 늘림) 앞에서부터 팀으로 올리고 팀 링크를 메일로 보낸다. 페널티는 없다(레드팀 09-25). */
  db.exec(`CREATE TABLE IF NOT EXISTS waitlist(
    id INTEGER PRIMARY KEY, event TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', share INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS team_trash(
    id INTEGER PRIMARY KEY, team INTEGER NOT NULL, event TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', tkey TEXT NOT NULL DEFAULT '', json TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')), by TEXT NOT NULL DEFAULT '')`);
  /* 쇼케이스 동의 칸. 옛 배포판에는 없다. 없으면 0(=동의 안 함)으로 시작한다 -
     «모름» 을 «있음» 으로 그리지 않는다(오답노트 E22). 동의는 본인이 켜야 생긴다. */
  try { db.exec("ALTER TABLE submissions ADD COLUMN show INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE submissions ADD COLUMN show_at TEXT NOT NULL DEFAULT ''"); } catch {}
  for (const c of ['aiuse', 'aidrop'])
    try { db.exec(`ALTER TABLE submissions ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN photo INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN size INTEGER NOT NULL DEFAULT 1'); } catch {}
  for (const c of ['role', 'found', 'note', 'agreed', 'came', 'want'])
    try { db.exec(`ALTER TABLE teams ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN solo INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE teams ADD COLUMN featured INTEGER NOT NULL DEFAULT 0'); } catch {}   // 운영자가 고른 추천작
  /* 열쇠가 없던 시절의 팀에도 열쇠를 하나씩 채워 둔다.
     빈 열쇠를 그냥 두면 '열쇠가 비면 아무나' 라는 구멍이 남는다.
     이 팀들의 브라우저에는 열쇠가 없지만, 연락처를 준 팀은 연락처로,
     아닌 팀은 운영자가 고칠 수 있다 - 여는 쪽이 아니라 잠그는 쪽으로 틀린다. */
  try {
    const 빈것 = db.prepare("SELECT id FROM teams WHERE tkey=''").all();
    const 채움 = db.prepare('UPDATE teams SET tkey=? WHERE id=?');
    for (const r of 빈것) 채움.run(crypto.randomBytes(5).toString('hex'), r.id);
  } catch {}
  /* 심사 열쇠. 점수를 넣는 사람만 받는다 — 공개 링크만 알면 아무나 점수를 넣던 것을 막는다.
     열쇠가 없던 시절의 대회에도 하나씩 채운다. 빈 열쇠를 두면 '비면 아무나' 구멍이 남는다. */
  try { db.exec("ALTER TABLE events ADD COLUMN jkey TEXT NOT NULL DEFAULT ''"); } catch {}
  try {
    const 빈대회 = db.prepare("SELECT id FROM events WHERE jkey=''").all();
    const 채움 = db.prepare('UPDATE events SET jkey=? WHERE id=?');
    for (const r of 빈대회) 채움.run(crypto.randomBytes(5).toString('hex'), r.id);
  } catch {}
  /* 관객 평가. 심사위원 자리가 비면 켠다. 투표 열쇠도 심사 열쇠처럼 빈 것을 채운다. */
  try { db.exec('ALTER TABLE events ADD COLUMN vmode INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN vkey TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 예산 기반 개설. events.budget 은 여는 사람이 정한 총액(원), mode 는 판의 모양.
     기본값이 'onsite' 인 것이 이관의 핵심이다 — 지금까지 연 대회는 전부 현장 대회였으니
     옛 행이 «0원 = 온라인» 규칙에 소급되어 온라인판으로 뒤집히는 사고를 여기서 막는다. */
  try { db.exec('ALTER TABLE events ADD COLUMN budget INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN mode TEXT NOT NULL DEFAULT 'onsite'"); } catch {}
  /* 2026-09-23 심사 넛지·실시간 정보.
     judged — 심사위원 상태 셋: '' 모름 · 'no' 못 구함 · 'yes:n' 구함. 운영자만 본다(모름을 0 으로 그리지 않는다).
     vpeer  — 관객 평가 대신 참가자 상호평가(팀 열쇠로만, 자기 팀 제외).
     chat   — 오픈 대화방 주소. 공개 페이지에 그대로 걸린다(webUrl 로 거른다). */
  try { db.exec("ALTER TABLE events ADD COLUMN judged TEXT NOT NULL DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE events ADD COLUMN vpeer INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE events ADD COLUMN chat TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 2026-09-24 퍼실리테이션 자료(MLH 심사 계획·국민대 매뉴얼·복사용 루브릭) 반영.
     safety — «문제가 생기면 이 사람에게» (운영자가 적는 공개 연락 한 줄. 행동강령의 신고 창구)
     ranked — 순위를 심사위원별 등수로 보정(관대한 심사위원 하나가 순위를 흔드는 것을 막는다)
     pledges/offers.pkey — 준 사람의 열쇠. /s/<ref>?k= 로 자기 후원 상태·결과를 본다(받는 사람 rkey 와 같은 모양)
     surveys — 끝난 뒤 설문 3문항(추천 0~10·좋았던 것·고칠 것). 팀 열쇠로만, 팀당 하나
     questions — 대회 안 묻고 답하기. 팀 열쇠로 묻고 운영자만 답한다. 익명 없음, 커뮤니티 아님 */
  try { db.exec("ALTER TABLE events ADD COLUMN safety TEXT NOT NULL DEFAULT ''"); } catch {}
  /* teams.no — 자리 번호. 신청할 때 한 번 받고 그 뒤로는 안 바뀐다(팀이 빠져도 뒤가 안 당겨진다 — 인쇄한 자리표와 어긋나면 점수가 딴 팀에 붙는다).
     이미 있는 팀은 신청 순으로 한 번 매긴다 */
  try { db.exec('ALTER TABLE teams ADD COLUMN no INTEGER NOT NULL DEFAULT 0'); } catch {}
  db.exec('UPDATE teams SET no = (SELECT COUNT(*) FROM teams t2 WHERE t2.event = teams.event AND t2.id <= teams.id) WHERE no = 0');
  try { db.exec('ALTER TABLE events ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE pledges ADD COLUMN pkey TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 심사·멘토로 오는 분의 이해관계 확인(참가자·후원사와 같은 회사·가족·금전 관계 없음). 본인 선언이다 — 앱이 검증하지 않는다 */
  try { db.exec("ALTER TABLE pledges ADD COLUMN coi INTEGER NOT NULL DEFAULT 0"); } catch {}
  /* 협찬사 로고 파일. 찾은 로고가 틀릴 때 운영자가 직접 올린다. 작게(400KB) 잘라서 받는다 */
  db.exec(`CREATE TABLE IF NOT EXISTS sponsor_logos(sponsor INTEGER PRIMARY KEY REFERENCES sponsors(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL)`);
  try { db.exec("ALTER TABLE offers ADD COLUMN pkey TEXT NOT NULL DEFAULT ''"); } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS surveys(
      event     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      recommend INTEGER NOT NULL,                  -- 0~10 «친구에게 추천하겠나»
      good      TEXT NOT NULL DEFAULT '',
      fix       TEXT NOT NULL DEFAULT '',
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event, team))`);
  db.exec(`CREATE TABLE IF NOT EXISTS questions(
      id          INTEGER PRIMARY KEY,
      event       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      text        TEXT NOT NULL,
      answer      TEXT NOT NULL DEFAULT '',
      hidden      INTEGER NOT NULL DEFAULT 0,      -- 운영자가 내린 것. 지우지 않고 감춘다
      at          TEXT NOT NULL DEFAULT (datetime('now')),
      answered_at TEXT NOT NULL DEFAULT '')`);
  /* 공지는 한 줄(events.notice, 큰 화면 띠)로 남기되 지난 소식도 쌓아 둔다 —
     참가자가 «지금 뭐가 바뀌었나»를 공개 페이지에서 시각과 함께 본다. */
  db.exec(`CREATE TABLE IF NOT EXISTS notices(
      id    INTEGER PRIMARY KEY,
      event TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      text  TEXT NOT NULL,
      at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  /* ── 2026-09-23 밤 ── «받는 사람»(후원자·의뢰자), 한 줄 평가, 앱 피드백, 팀이 고른 주제 */
  db.exec(`CREATE TABLE IF NOT EXISTS requests(
      id      TEXT PRIMARY KEY,                 -- 공개 id (events.id 처럼 8자)
      rkey    TEXT NOT NULL DEFAULT '',         -- 받는 사람 열쇠. 공개 응답에 절대 안 실린다
      kind    TEXT NOT NULL DEFAULT 'requester',-- sponsor(후원자) | requester(의뢰자)
      name    TEXT NOT NULL,                    -- 공개될 이름(가게·회사·별명)
      topic   TEXT NOT NULL DEFAULT '',         -- 주제 한 줄 (후원자) / 요청 제목 (의뢰자)
      pain    TEXT NOT NULL DEFAULT '',         -- 의뢰자 화면 1 «요즘 뭐가 제일 번거로우세요»
      now     TEXT NOT NULL DEFAULT '',         -- 화면 2 «지금은 어떻게 하세요»
      done    TEXT NOT NULL DEFAULT '',         -- 화면 3 «이렇게 되면 됐다고 하실 수 있어요» — 판정 기준
      contact TEXT NOT NULL DEFAULT '',         -- 운영자만
      event   TEXT NOT NULL DEFAULT '',         -- 어느 대회의 주제로 붙었나 ('' 이면 후보)
      status  TEXT NOT NULL DEFAULT 'open',     -- open | closed
      followup    TEXT NOT NULL DEFAULT '',     -- D+14: using | sometimes | no | broken ('' 모름)
      followup_at TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS verdicts(
      id      INTEGER PRIMARY KEY,
      request TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      team    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      ok      INTEGER NOT NULL DEFAULT 0,       -- 1 이거면 됩니다 · 0 아직 아니에요
      note    TEXT NOT NULL DEFAULT '',
      at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(request, team)
    );
    CREATE TABLE IF NOT EXISTS feedback(
      id      INTEGER PRIMARY KEY,
      page    TEXT NOT NULL DEFAULT '',
      text    TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      at      TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  try { db.exec("ALTER TABLE teams ADD COLUMN request TEXT NOT NULL DEFAULT ''"); } catch {}   // 팀이 고른 주제·요청
  /* 아이폰 앱의 푸시 토큰. 기기 하나가 대회 하나를 «따라가기» 하면 새 소식을 APNs 로 보낸다.
     발송 열쇠(APNS_KEY 등)가 없으면 저장만 하고 보내지 않는다 — 계정이 생기면 켠다. */
  db.exec(`CREATE TABLE IF NOT EXISTS push_tokens(
      id     INTEGER PRIMARY KEY,
      token  TEXT NOT NULL,
      event  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(token, event)
    )`);
  try { db.exec("ALTER TABLE votes ADD COLUMN note TEXT NOT NULL DEFAULT ''"); } catch {}
  /* 문제 은행 — 대회 없이 «풀었습니다» 하고 보낸 결과. 연락처는 낸 사람(의뢰자)만 본다. */
  db.exec(`CREATE TABLE IF NOT EXISTS solutions(
    id INTEGER PRIMARY KEY, request TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (datetime('now')))`);
  /* 해커온뉴스 — 6시간마다 밖에서 제목·주소만 모은다(본문은 안 가져온다). key 가 주소라 같은 글은 한 번만. */
  db.exec(`CREATE TABLE IF NOT EXISTS news(
    id INTEGER PRIMARY KEY, src TEXT NOT NULL, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (date('now')))`);
  try { db.exec("ALTER TABLE news ADD COLUMN job TEXT NOT NULL DEFAULT ''"); } catch {}      // 직무 태그(자동 분류 또는 제보자가 고른 것)
  try { db.exec("ALTER TABLE news ADD COLUMN by TEXT NOT NULL DEFAULT ''"); } catch {}       // 제보자 이름(카카오 닉네임)
  try { db.exec("ALTER TABLE news ADD COLUMN owner TEXT NOT NULL DEFAULT ''"); } catch {}    // 제보자 계정 — 하루 5건 상한      // 별점 옆 한 줄
  /* 이 표가 생기기 전에 띄운 공지(events.notice)를 한 번 옮겨 둔다 — 안 그러면 큰 화면엔 공지가 있는데
     공개 페이지 «소식»은 비어 «있는 것을 없음으로» 그린다. 시각은 notice_at 그대로 */
  for (const r of db.prepare("SELECT id, notice, notice_at FROM events WHERE notice<>'' AND id NOT IN (SELECT event FROM notices)").all())
    db.prepare('INSERT INTO notices(event, text, at) VALUES(?,?,?)')
      .run(r.id, r.notice, r.notice_at ? r.notice_at.replace('T', ' ').slice(0, 19) : new Date().toISOString().replace('T', ' ').slice(0, 19));
  /* 자리마다 배정된 돈(amount). 0 = «무료로 내줄 분을 찾는» 카드.
     held = 운영자가 손으로 고친 줄 - «다시 나누기»가 절대 덮어쓰지 않는다.
     auto = 산식이 만든 줄 - 다시 나누기는 이것만 갈아엎는다. 손으로 올린 자리(auto=0)는 안 건드린다. */
  try { db.exec('ALTER TABLE needs ADD COLUMN amount INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE needs ADD COLUMN held INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE needs ADD COLUMN auto INTEGER NOT NULL DEFAULT 0'); } catch {}
  /* price = 협찬 희망가. amount(쓰려는 돈)와 다르다 — amount 는 «우리가 얼마 쓴다»,
     price 는 «이 자리를 맡으려면 얼마»다. 0 = 금액 미정. 확정 금액이 아니라 부르는 값이다. */
  try { db.exec('ALTER TABLE needs ADD COLUMN price INTEGER NOT NULL DEFAULT 0'); } catch {}
  try {
    const 빈투표 = db.prepare("SELECT id FROM events WHERE vkey=''").all();
    const 채움v = db.prepare('UPDATE events SET vkey=? WHERE id=?');
    for (const r of 빈투표) 채움v.run(crypto.randomBytes(5).toString('hex'), r.id);
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

function privacyPage() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HACK:ON 개인정보 처리방침</title>
<style>body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:680px;margin:0 auto;padding:24px 20px;line-height:1.7;color:#191F28}h1{font-size:24px}h2{font-size:17px;margin-top:26px}li{margin:4px 0}</style></head><body>
<h1>HACK:ON 개인정보 처리방침</h1>
<p>HACK:ON(hackon.mandeun.com 과 같은 이름의 아이폰 앱)은 로그인 없이 씁니다. 아래에 적은 것만 받고, 적은 기간만 두며, 적은 사람에게만 보입니다.</p>
<h2>1. 받는 것과 이유</h2>
<ul>
<li><b>참가 신청</b> — 이름(팀 이름), 이메일. 대회 운영·참가 확인·결과 안내·상금 지급. 협찬사 제공은 따로 동의한 사람만.</li>
<li><b>자리 맡기·제안</b> — 이름, 소속(선택), 연락처. 운영자가 확인할 때만 씁니다. 공개 장부에는 이름·소속만 나갑니다.</li>
<li><b>주제·문제 올리기(받는 사람)</b> — 공개될 이름, 연락처. 결과 안내에만 씁니다.</li>
<li><b>앱 피드백</b> — 적은 글, 연락처(선택).</li>
<li><b>푸시 알림</b> — 기기 토큰. 사람 정보가 아니며 «따라가기»를 끄면 지웁니다.</li>
</ul>
<h2>2. 보는 사람</h2>
<p>연락처는 그 대회의 운영자만 봅니다. 공개 페이지·큰 화면·결과 보고서에는 연락처가 나가지 않습니다. 협찬사에는 «협찬사 제공 동의»를 한 참가자의 이메일만, 그 대회의 협찬사에만 갑니다.</p>
<h2>3. 두는 기간</h2>
<p>대회 종료 후 6개월. 그 뒤 지웁니다. 운영자가 대회를 지우면 그 자리에서 함께 지워집니다(운영자가 사본 파일을 보관할 수 있습니다).</p>
<h2>4. 앱이 쓰는 기기 기능</h2>
<ul><li>카메라 — 심사·투표 링크의 QR 을 찍을 때만. 사진은 저장하지 않습니다.</li><li>알림 — 대회 전날·마감 30분 전·새 소식. 켜고 끄는 것은 본인이 정합니다.</li><li>저장 공간 — 마지막으로 받은 대회 정보를 기기에 두어 인터넷이 끊겨도 진행표를 보여 줍니다.</li></ul>
<h2>5. 하지 않는 것</h2>
<p>광고 추적, 제3자 분석 도구, 위치 수집, 연락처 접근, 앱 안 결제를 하지 않습니다.</p>
<h2>6. 묻는 곳</h2>
<p>hi@mandeun.com · 개정 2026-09-24</p>
</body></html>`;
}

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
<title>해커톤 운영 매뉴얼 — 처음 여는 사람을 위한 준비표 | HACK:ON</title>
<meta name="description" content="해커톤을 처음 여는 사람을 위한 운영 매뉴얼. 준비표부터 끝나고 2주까지.">
<link rel="canonical" href="https://hackon.kr/manual">
<meta property="og:title" content="해커톤 운영 매뉴얼 — HACK:ON">
<meta property="og:description" content="해커톤을 처음 여는 사람을 위한 운영 매뉴얼. 준비표부터 끝나고 2주까지.">
<meta property="og:image" content="https://hackon.kr/og.png">
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
/* hint — 점수마다 «무엇이 그 점수인가». 가중치만 주면 7점이 심사위원마다 다르다.
   복사용 루브릭(Rathour)의 2·5·9점 서술자를 이 앱의 0~100 눈금(20·50·90)으로 옮겼다. */
const RUBRIC_HINT = {
  idea: { low: '어디서 본 것', mid: '아는 문제를 다른 길로', high: '이 자리에서 처음 보는 접근' },
  make: { low: '화면 그림뿐', mid: '준비한 입력으로는 돈다', high: '심사위원이 고른 입력으로도 돈다' },
  use:  { low: '누가 쓸지 없음', mid: '쓸 사람이 있다', high: '그 사람이 오늘 쓰겠다고 할 만함' },
  tell: { low: '무엇인지 못 알아듣겠다', mid: '3분 안에 문제·해법이 들린다', high: '질문에 바로 답하고 한계도 말한다' },
  will: { low: '오늘로 끝', mid: '다음 할 일이 있다', high: '다음 주에 할 일과 사람이 정해졌다' },
  real: { low: '슬라이드', mid: '준비한 입력으로는 돈다', high: '지금 주소를 열면 돈다' },
  who:  { low: '모두', mid: '집단 하나', high: '이름 댈 수 있는 사람 다섯' },
  /* 10/31 선릉 대회가 손으로 정한 기준(ship·mission·run). 저장된 기준표는 안 건드리고 서술자만 붙는다 */
  ship: { low: '주소가 안 열린다', mid: '열리지만 일부만 된다', high: '지금 열어서 끝까지 된다' },
  mission: { low: '현장 조건 언급 없음', mid: '조건 하나를 반영', high: '그날의 조건이 설계에 들어가 있다' },
  run:  { low: '어디에 썼는지 말 못 한다', mid: '대략 말한다', high: '시간 배분과 버린 것을 말한다' },
};
const RUBRICS = {
  '만들기': {
    what: '그날 무엇을 만들어 냈는지를 봅니다. 하루짜리 해커톤 기본값입니다.',
    rows: [
      { key: 'idea', label: '독창성', weight: 30, hint: RUBRIC_HINT.idea },
      { key: 'make', label: '완성도', weight: 30, hint: RUBRIC_HINT.make },
      { key: 'use', label: '실용성', weight: 25, hint: RUBRIC_HINT.use },
      { key: 'tell', label: '전달력', weight: 15, hint: RUBRIC_HINT.tell },
    ],
  },
  '문제해결': {
    what: '끝까지 갈 팀인지를 봅니다. 창업 지원 사업의 실제 배점을 옮겼습니다.',
    rows: [
      { key: 'will', label: '끝까지 갈 준비', weight: 40, hint: RUBRIC_HINT.will },
      { key: 'real', label: '실제로 돌아가나', weight: 30, hint: RUBRIC_HINT.real },
      { key: 'who', label: '누가 쓸지 정해졌나', weight: 20, hint: RUBRIC_HINT.who },
      { key: 'tell', label: '전달력', weight: 10, hint: RUBRIC_HINT.tell },
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
  if (b.budget !== undefined) { set.push('budget=?'); val.push(Math.max(0, Math.floor(+b.budget || 0))); }
  /* 오픈 대화방 주소. http(s) 가 아니면 빈 값으로 — javascript: 같은 것이 공개 페이지에 걸리면 안 된다 */
  if (b.chat !== undefined) { set.push('chat=?'); val.push(webUrl(b.chat)); }
  /* «문제가 생기면 이 사람에게». 참가자 화면에 그대로 나가는 공개 연락 한 줄이다 — 운영자가 스스로 적는다 */
  if (b.safety !== undefined) { set.push('safety=?'); val.push(plain(b.safety, 120)); }
  if (b.mode !== undefined) {
    if (!['onsite', 'online'].includes(b.mode)) throw new HttpError(400, 'mode 는 onsite·online 중 하나입니다');
    set.push('mode=?'); val.push(b.mode);
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
  const 채울것 = ['contact', 'role', 'found', 'note', 'want', 'link']
    .some(k => b[k] !== undefined && String(b[k]).trim() && !t[k])
    || (b.solo !== undefined && !t.solo && !!b.solo)
    || (b.photo !== undefined && !t.photo && !!b.photo);
  if (채울것 && !owns)
    throw new HttpError(403, '이 팀은 신청한 분이나 운영자만 고칠 수 있습니다');
  for (const k of ['contact', 'role', 'found', 'note', 'want', 'link']) {
    if (b[k] === undefined || !String(b[k]).trim()) continue;
    if (t[k]) continue;                       // 이미 적힌 것은 안 건드린다
    if (k === 'link' && !webUrl(b[k])) continue;   // 주소 꼴이 아니면 버린다 — href 에 들어가는 값이다
    set.push(`${k}=?`); val.push(k === 'link' ? webUrl(b[k]) : String(b[k]).slice(0, 300));
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
  const jkey = crypto.randomBytes(5).toString('hex');   // 심사 열쇠. 심사위원에게만 준다
  const vkey = crypto.randomBytes(5).toString('hex');   // 관객 투표 열쇠. 현장 큰 화면에 QR 로
  const rubric = Array.isArray(b.rubric) && b.rubric.length ? b.rubric
    : (RUBRICS[b.rubricKind] || RUBRICS['만들기']).rows;
  const sum = rubric.reduce((a, r) => a + Number(r.weight || 0), 0);
  if (sum !== 100) throw new HttpError(400, `심사 배점 합이 ${sum} 입니다. 100 이어야 합니다`);
  db.prepare(`INSERT INTO events(id,title,host,topic,starts,ends,prize,cap,rubric,due)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.title, b.host || '주최자', plain(b.topic, 120),
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
  db.prepare('UPDATE events SET okey=?, jkey=?, vkey=?, plan=? WHERE id=?')
    .run(okey, jkey, vkey, JSON.stringify(Array.isArray(b.plan) && b.plan.length ? b.plan : DEFAULT_PLAN), id);
  /* 예산을 «주었을 때만» 산식을 돌린다. 이름 하나로 여는 길은 전과 똑같이 현장 대회·자리 없음이다.
     0원을 «주면» 온라인판이 된다 - 안 준 것과 0원을 준 것은 다르다(모름 ≠ 없음). */
  let alloc = null;
  if (b.budget !== undefined && b.budget !== null && b.budget !== '') {
    db.prepare('UPDATE events SET budget=? WHERE id=?').run(Math.max(0, Math.floor(+b.budget || 0)), id);
    alloc = reallocate(db, id);
  }
  return { id, okey, jkey, vkey, owner, alloc };
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
/* 점수를 넣거나 심사 화면을 여는 자격. 운영자이거나, 그 대회의 심사 열쇠를 든 사람. */
function canJudge(db, event, key, owner, jkey) {
  if (isAdmin(db, event, key, owner)) return true;
  const e = db.prepare('SELECT jkey FROM events WHERE id=?').get(event);
  return !!(e && e.jkey && jkey && jkey === e.jkey);
}
/* 관객 평가에 표를 던질 자격. 운영자이거나, 관객 평가가 켜진 그 대회의 투표 열쇠를 든 사람. */
function canVote(db, event, key, owner, vkey, tkey) {
  if (isAdmin(db, event, key, owner)) return true;
  const e = db.prepare('SELECT vmode, vpeer, vkey FROM events WHERE id=?').get(event);
  if (!(e && e.vmode)) return false;
  /* 상호평가면 투표 열쇠가 아니라 팀 열쇠다. 관객은 못 찍고, 참가자는 자기 팀 열쇠로만 */
  if (e.vpeer) return !!peerTeam(db, event, tkey);
  return !!(e.vkey && vkey && vkey === e.vkey);
}
/* 상호평가에서 «내 팀». 이 대회의 팀 열쇠와 맞는 팀만. 없으면 null */
function peerTeam(db, event, tkey) {
  if (!tkey) return null;
  return db.prepare('SELECT id FROM teams WHERE event=? AND tkey=?').get(event, String(tkey)) || null;
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
  delete e.jkey;                     // 심사 열쇠도 안 내려보낸다 — 운영자에게만 따로 준다
  delete e.vkey;                     // 관객 투표 열쇠도 마찬가지
  delete e.judged;                   // 심사위원 상태는 운영자 화면에만 — 손님에게 «못 구함»을 보일 이유가 없다
  e.rubric = JSON.parse(e.rubric);
  for (const r of e.rubric) if (!r.hint && RUBRIC_HINT[r.key]) r.hint = RUBRIC_HINT[r.key];
  try { e.plan = JSON.parse(e.plan || '[]'); } catch { e.plan = []; }
  e.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(id).c;
  e.waiting = db.prepare('SELECT COUNT(*) c FROM waitlist WHERE event=?').get(id).c;
  /* «못 가요»라고 한 팀은 자리를 돌려준다 — 표에는 남지만(운영자가 본다) 정원에서는 뺀다 */
  e.seatsLeft = e.cap ? Math.max(0, e.cap - db.prepare("SELECT COUNT(*) c FROM teams WHERE event=? AND confirmed<>'no'").get(id).c) : null;
  e.sponsors = db.prepare('SELECT * FROM sponsors WHERE event=? ORDER BY amount DESC').all(id);
  e.missing = ready(e);
  return e;
}

function joinTeam(db, event, b) {
  const e = getEvent(db, event);
  if (!b.name) throw new HttpError(400, '팀 이름이 필요합니다');
  /* 동의 없이 연락처를 받지 않는다. 화면에서 체크박스를 지워도 여기서 막힌다. */
  if (!b.agree) throw new HttpError(400, '개인정보 수집·이용에 동의해 주세요');
  /* 신청 화면은 이메일을 처음부터 받는다 — 확정 안내와 후원사 크레딧이 전부 이메일로 간다.
     꼴이 틀리면 막고, 맞으면 소문자로 다듬어 연락처로 쓴다. 협찬사 제공 동의(share)는 수집 동의와 별개 체크. */
  if (b.email !== undefined) {
    const em = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new HttpError(400, '이메일을 적어 주세요');
    b.contact = em;
  }
  if (e.cap && e.seatsLeft === 0 && !b._promote) {
    /* 정원이 찼다 — 대기자로. 같은 이름이 팀이나 대기자에 이미 있으면 막는다(재신청 도배 방지) */
    if (db.prepare('SELECT 1 FROM teams WHERE event=? AND name=?').get(event, b.name) ||
        db.prepare('SELECT 1 FROM waitlist WHERE event=? AND name=?').get(event, b.name))
      throw new HttpError(409, '같은 이름이 이미 있습니다');
    if (!b.contact) throw new HttpError(400, '대기자는 이메일이 필요합니다 — 자리가 나면 거기로 팀 링크를 보냅니다');
    db.prepare('INSERT INTO waitlist(event,name,contact,share) VALUES(?,?,?,?)').run(event, b.name, b.contact, b.share ? 1 : 0);
    return { waiting: db.prepare('SELECT COUNT(*) c FROM waitlist WHERE event=?').get(event).c };
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
  /* 자리 번호 — 이 대회에서 지금까지 나온 가장 큰 번호 + 1. 빠진 팀의 번호는 다시 안 쓴다(인쇄한 자리표와 어긋나지 않게) */
  db.prepare('UPDATE teams SET no = (SELECT COALESCE(MAX(no),0)+1 FROM teams t2 WHERE t2.event=? AND t2.id<>teams.id) WHERE id=?').run(event, Number(r.lastInsertRowid));
    return Number(r.lastInsertRowid);
  } catch {
    throw new HttpError(409, '같은 이름의 팀이 있습니다. 이미 신청한 팀이면 팀 링크로 들어오고, 기기를 바꿨다면 운영자에게 링크 재발급을 부탁하세요. 새 팀이면 이름 뒤에 소속을 붙여 보세요');
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
  const prev = db.prepare('SELECT show, show_at FROM submissions WHERE team=?').get(team);
  /* 제출 폼도 동의 체크칸을 같이 보낸다. 안 보내면 지금 값을 그대로 둔다 -
     칸이 없는 옛 화면이 저장할 때 남의 동의를 꺼 버리면 안 된다. */
  const on = b.show === undefined ? (prev ? prev.show : 0) : (b.show ? 1 : 0);
  const at = on ? ((prev && prev.show && prev.show_at) || new Date().toISOString()) : '';
  const sale = b.sale === undefined ? (db.prepare('SELECT sale FROM submissions WHERE team=?').get(team) || {}).sale || '' : plain(b.sale, 60);
  db.prepare(`INSERT INTO submissions(team,url,note,aiuse,aidrop,show,show_at,sale)
                VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(team) DO UPDATE SET url=excluded.url, note=excluded.note,
                aiuse=excluded.aiuse, aidrop=excluded.aidrop,
                show=excluded.show, show_at=excluded.show_at, sale=excluded.sale, at=datetime('now')`)
    .run(team, webUrl(b.url), b.note || '',
         (b.aiuse || '').slice(0, 500), (b.aidrop || '').slice(0, 500), on, at, sale);
  /* 어느 주제·요청으로 만들었나. 이 대회에 붙은 요청만 고를 수 있다. 안 보내면 그대로 */
  if (b.request !== undefined) {
    const rq = String(b.request || '');
    const t = db.prepare('SELECT event FROM teams WHERE id=?').get(team);
    if (rq && !db.prepare('SELECT 1 FROM requests WHERE id=? AND event=?').get(rq, t.event))
      throw new HttpError(400, '이 대회의 주제가 아닙니다');
    db.prepare('UPDATE teams SET request=? WHERE id=?').run(rq, team);
  }
}

/** 쇼케이스 동의만 켜고 끈다.
    제출(submit)은 마감이 지나면 막히는데, 쇼케이스는 **마감이 지난 뒤에야** 화면에 걸린다.
    그러니 동의를 submit 안에만 두면 «걸린 뒤에는 내릴 수 없는» 꼴이 된다.
    뺄 수 없는 동의는 동의가 아니므로, 이 길은 마감을 보지 않는다. */
function showConsent(db, team, on) {
  const s = db.prepare('SELECT show, show_at FROM submissions WHERE team=?').get(team);
  if (!s) throw new HttpError(404, '아직 제출한 것이 없습니다');
  const v = on ? 1 : 0;
  const at = v ? (s.show && s.show_at ? s.show_at : new Date().toISOString()) : '';
  db.prepare('UPDATE submissions SET show=?, show_at=? WHERE team=?').run(v, at, team);
  return { show: !!v, at };
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
    SELECT t.id, t.name, t.contact, t.role, t.solo, t.found, t.note AS apply, t.featured, t.request, t.confirmed,
           t.agreed, t.photo, t.came, t.size, t.want, t.no,
           s.url, s.note, s.aiuse, s.aidrop, s.show, s.show_at
    FROM teams t LEFT JOIN submissions s ON s.team = t.id
    WHERE t.event = ? ORDER BY t.id`).all(event);
  /* 심사위원별 등수 보정(MLH 의 stack ranking 을 눈금으로). 관대한 심사위원의 90점과 짠 심사위원의 70점이
     같은 «1등»일 수 있다 — 각 심사위원 안에서 등수를 매겨 100~0 으로 펴고, 팀은 자기를 본 심사위원들의 평균을 받는다.
     한 팀만 본 심사위원은 그 팀에 100 을 준다(비교가 없으니 «모름»이지만 0 으로 그리면 벌이 된다). */
  const perJudge = {};
  for (const sc of db.prepare(`SELECT s.team, s.judge, s.key, s.value FROM scores s
                               JOIN teams t ON t.id = s.team WHERE t.event = ?`).all(event)) {
    const w = (e.rubric.find(r => r.key === sc.key) || {}).weight || 0;
    perJudge[sc.judge] = perJudge[sc.judge] || {};
    perJudge[sc.judge][sc.team] = (perJudge[sc.judge][sc.team] || 0) + sc.value * w / 100;
  }
  const rankPts = {};   // team -> [points per judge]
  for (const j of Object.keys(perJudge)) {
    const ts = Object.entries(perJudge[j]).sort((a, b) => b[1] - a[1]);
    /* 두 팀만 본 심사위원은 표본이 없어 1등·꼴찌로 벌어진다 — 셋 미만이면 보정에서 뺀다(대회에 팀이 셋 이상일 때).
       동점은 평균 등수로 — 같은 점수를 줬는데 앞뒤가 갈리면 그건 입력 순서가 순위를 정한 것이다 */
    if (ts.length < 3 && teams.length >= 3) continue;
    let i = 0;
    while (i < ts.length) {
      let k = i; while (k + 1 < ts.length && ts[k + 1][1] === ts[i][1]) k++;
      const pos = (i + k) / 2;
      const pts = ts.length === 1 ? 100 : Math.round((1 - pos / (ts.length - 1)) * 1000) / 10;
      for (let x = i; x <= k; x++) (rankPts[ts[x][0]] = rankPts[ts[x][0]] || []).push(pts);
      i = k + 1;
    }
  }
  const rows = teams.map((t, ti) => {
    let total = 0, judged = new Set();
    const rp = rankPts[t.id] || [];
    const rscore = rp.length ? Math.round(rp.reduce((a, b) => a + b, 0) / rp.length * 10) / 10 : 0;
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
    /* 관객 평가. 심사위원 자리를 대신하는 표. 심사 점수와 별개다. */
    const v = db.prepare('SELECT AVG(score) a, COUNT(*) c FROM votes WHERE team=?').get(t.id);
    /* no — 자리 번호(신청 순). 과학전람회식 심사에서 심사위원이 찾아가는 번호이자 큰 화면·팀 화면이 같이 쓴다.
       팀이 지워지면 뒤 번호가 당겨진다 — 그래서 대회 당일 아침 이후로는 팀을 지우지 말라고 매뉴얼에 적는다. */
    const row = { ...t, no: t.no || ti + 1, score: Math.round(total * 10) / 10, rscore, judges: judged.size,
                  vote: v.c ? Math.round((v.a || 0) * 10) / 10 : 0, votes: v.c,
                  words, by: [...judged].sort(), done: !!t.url };
    /* 마감 전에는 제출 링크를 안 내려보낸다.
       먼저 낸 팀의 결과물을 뒤에 내는 팀이 보고 만들 수 있기 때문이다.
       제목과 설명은 그대로 둔다 - 무엇을 만들고 있는지는 서로 알아야 같이 하는 느낌이 난다.
       운영자와 심사위원은 언제든 본다. */
    if (!admin && !closed(e)) { delete row.url; row.hidden = !!t.url; }
    /* 개인정보는 운영자에게만. 화면에서 감추면 브라우저 콘솔에서 다 보인다. */
    if (!admin) { delete row.contact; delete row.found; delete row.agreed;
                  delete row.photo; delete row.came; delete row.apply;
                  delete row.show_at; }
    return row;
  });
  /* 관객 평가 모드면 표 평균으로 줄 세운다. 아니면 심사 점수로. */
  rows.sort((a, b) => e.vmode ? (b.vote - a.vote) || (b.votes - a.votes)
                    : e.ranked ? (b.rscore - a.rscore) || (b.score - a.score) : b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  e.admin = admin;   // 화면이 운영 칸을 그릴지 말지 이걸로 정한다
  /* 이 대회에 한 번이라도 점수를 넣은 사람 전부. 화면이 '아직 안 본 사람' 을 계산하는 근거다. */
  const judges = db.prepare(`SELECT DISTINCT s.judge FROM scores s
                             JOIN teams t ON t.id = s.team
                             WHERE t.event = ? ORDER BY s.judge`).all(event).map(r => r.judge);
  /* 마감 전에는 점수도 안 준다. 심사 중에 순위가 보이면 심사위원이 그걸 보고 맞춘다.
     Kaggle 이 public/private 리더보드를 나눈 것과 같은 이유다. */
  if (!admin && !closed(e)) for (const r of rows) { r.score = null; r.rscore = null; r.rank = null; r.vote = null; r.votes = null; }
  /* 관객·참가팀이 별점 옆에 남긴 한 줄. 마감 뒤에만, 누가 썼는지는 없다 */
  if (closed(e)) for (const r of rows)
    r.words_public = db.prepare("SELECT note FROM votes WHERE team=? AND note<>'' ORDER BY at").all(r.id).map(x => x.note);
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
  const rows = db.prepare(`SELECT id, name, role, solo, size, want, note, members, person, link
                           FROM teams WHERE event = ? ORDER BY id`).all(event);
  return {
    solo: rows.filter(r => r.solo).map(r => ({
      id: r.id, name: r.name, role: r.role, note: r.note, link: webUrl(r.link) })),
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
  const rows = db.prepare(`SELECT t.name, t.no, s.url FROM teams t
                           LEFT JOIN submissions s ON s.team = t.id
                           WHERE t.event = ? ORDER BY t.id`).all(event);
  const b = board(db, event, false);
  const judged = b.rows.some(r => r.judges > 0);
  return {
    title: e.title, host: e.host, due: e.due, plan: e.plan,
    starts: e.starts, ends: e.ends,
    /* 로고 벽 — 후원 로고와 같은 크기로 심사·멘토 «이름»도 건다. 시간을 준 사람의 자리다 */
    judges: db.prepare(`SELECT p.name FROM pledges p JOIN needs n ON n.id = p.need
                        WHERE n.event=? AND n.kind IN ('judge','mentor') AND p.status IN ('ok','done') ORDER BY p.id`).all(event).map(r => r.name),
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
      ? b.rows.slice(0, 5).map(r => ({ rank: r.rank, name: r.name, score: e.ranked ? r.rscore : r.score })) : [],
    /* 자리 번호 — 마감 뒤 심사 시간에 벽에 띄운다. 심사위원이 «몇 번 테이블»로 찾아간다 */
    seats: closed(e) ? rows.map((r, i) => ({ no: r.no || i + 1, name: r.name })) : [],
    /* 발표 순서 — 자리 번호 순, 낸 팀만. 운영사가 늘 종이에 적던 것(브레인스톰 §3-6). 마감 뒤에만 */
    order: closed(e) ? rows.filter(r => r.url).map((r, i) => ({ no: r.no || i + 1, name: r.name })) : [],
    crew: crew(db, event),
    /* 협찬사 로고. 금액은 안 보낸다 - 벽에 걸리는 화면이다. */
    sponsors: db.prepare('SELECT name, kind, logo, link FROM sponsors WHERE event=? ORDER BY amount DESC')
                .all(event),
  };
}

/** 심사위원이 보는 것. 남의 점수도 순위도 안 내려보낸다 —
    화면에서 감추는 게 아니라 서버가 안 준다. 심사 중에 순위를 보면 점수가 끌려간다. */
function judgeView(db, event, judge, admin = false) {
  const e = getEvent(db, event);
  /* 심사 주소는 무열쇠라 공개 event id 만 알면 누구나 연다. 마감 전에는 제출 링크를 숨긴다 —
     board() 와 같은 규칙. 안 그러면 경쟁 팀이 /j/<id> 로 남의 링크를 미리 본다. 심사는 마감 뒤라
     그때 링크가 열린다. 운영자(admin)는 언제든 본다. */
  const hideUrl = !admin && !closed(e);
  const teams = db.prepare(`SELECT t.id, t.name, t.no, s.url, s.note, s.aiuse, s.aidrop
                            FROM teams t LEFT JOIN submissions s ON s.team = t.id
                            WHERE t.event = ? ORDER BY t.id`).all(event);
  if (hideUrl) for (const t of teams) t.url = '';
  teams.forEach((t, i) => { t.no = t.no || i + 1; });   // 자리 번호 — 신청 때 받은 고정 번호
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
    /* 첫 팀은 옆 심사위원과 같이 채점하라는 안내를 화면이 띄우는 근거 — 아직 아무 점수도 없을 때만 */
    first: !db.prepare('SELECT 1 FROM scores s JOIN teams t ON t.id = s.team WHERE t.event = ? LIMIT 1').get(event),
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

/* ── 대회 지우기 ──
   화면이 «빈 대회» 를 판정하면 경합이 난다(아침에 연 탭, 오후에 들어온 신청). 그래서 서버가 판정한다:
   팀·제출·자리·제안·투표가 하나라도 있으면 본문 confirm 이 제목과 같아야 지운다(아니면 409).
   백업은 «요청 순서» 로 묶지 않는다 — 다운로드가 실패해도 삭제가 나가면 백업 없는 삭제다.
   서버가 지우기 직전 backup/ 에 사본을 남기고, 응답에도 같은 사본을 실어 화면이 파일로 저장한다. */
function eventLoad(db, event) {
  const ids = db.prepare('SELECT id FROM teams WHERE event=?').all(event).map(t => t.id);
  const inIds = ids.length ? `(${ids.join(',')})` : '(0)';
  return {
    teams: ids.length,
    submissions: db.prepare(`SELECT COUNT(*) c FROM submissions WHERE team IN ${inIds}`).get().c,
    needs: db.prepare('SELECT COUNT(*) c FROM needs WHERE event=?').get(event).c,
    offers: db.prepare('SELECT COUNT(*) c FROM offers WHERE event=?').get(event).c,
    votes: db.prepare('SELECT COUNT(*) c FROM votes WHERE event=?').get(event).c,
  };
}
const emptyEvent = load => Object.values(load).every(v => v === 0);
function deleteEvent(db, event, b) {
  const e = db.prepare('SELECT id, title FROM events WHERE id=?').get(event);
  if (!e) throw new HttpError(404, '없는 대회입니다');
  const load = eventLoad(db, event);
  if (!emptyEvent(load) && String((b && b.confirm) || '').trim() !== e.title)
    throw new HttpError(409, `신청·자리·제안이 있는 대회입니다. 지우려면 대회 이름을 그대로 적어 보내세요: ${e.title}`);
  const copy = dump(db, event);
  let saved = '';
  try {
    const dir = path.join(path.dirname(DBFILE), 'backup');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    saved = path.join(dir, `hackon-${event}-${stamp}.json`);
    fs.writeFileSync(saved, JSON.stringify(copy, null, 2));
  } catch { saved = ''; }   // 디스크가 없어도 응답의 사본은 나간다. 화면이 파일로 받는다
  db.prepare('DELETE FROM events WHERE id=?').run(event);
  return { ok: true, saved: path.basename(saved), dump: copy, load };
}

/* ── «받는 사람» — 후원자·의뢰자 역할 하나 ──
   둘 다 주제(문제)를 내고, 마감 뒤 그 주제로 만든 결과물·동의한 제작자 연락을 열쇠 하나로 받는다.
   다른 것은 돈이 앞에 오나(후원자) 안 오나(의뢰자)뿐이라 표 하나로 그린다.
   열쇠 패턴은 okey·jkey 와 같다: 공개 응답에서 rkey·contact 를 지운다. 순위·인기순은 두지 않는다(올라온 순). */
const REQUEST_KINDS = ['sponsor', 'requester'];
function addRequest(db, b) {
  const kind = REQUEST_KINDS.includes(b.kind) ? b.kind : 'requester';
  const name = plain(b.name, 40);
  const topic = plain(b.topic, 120), pain = plain(b.pain, 300), now = plain(b.now, 300), done = plain(b.done, 300);
  if (!name) throw new HttpError(400, '공개될 이름을 적어 주세요');
  if (!topic && !pain) throw new HttpError(400, '주제나 번거로운 일을 한 줄 적어 주세요');
  let event = String(b.event || '');
  if (event && !db.prepare('SELECT 1 FROM events WHERE id=?').get(event)) throw new HttpError(404, '없는 대회입니다');
  const id = nid(), rkey = crypto.randomBytes(5).toString('hex');   // events 와 같은 모양: 공개 id 8자 + 열쇠 10자
  db.prepare('INSERT INTO requests(id,rkey,kind,name,topic,pain,now,done,contact,event) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, rkey, kind, name, topic || pain.slice(0, 60), pain, now, done, plain(b.contact, 100), event);
  return { id, rkey };
}
/* 공개가 봐도 되는 것만. rkey·contact 는 이 함수를 거쳐서는 한 번도 나가지 않는다 */
function publicRequest(r) {
  return { id: r.id, kind: r.kind, name: r.name, topic: r.topic, pain: r.pain, now: r.now, done: r.done,
           event: r.event, status: r.status, created: r.created,
           teams: r.teams === undefined ? undefined : r.teams };
}
function requestsOf(db, event, admin = false) {
  const rows = db.prepare('SELECT * FROM requests WHERE event=? ORDER BY created, id').all(event);
  const cnt = db.prepare("SELECT request, COUNT(*) c FROM teams WHERE event=? AND request<>'' GROUP BY request").all(event);
  const by = {}; for (const c of cnt) by[c.request] = c.c;
  return rows.map(r => { const o = publicRequest({ ...r, teams: by[r.id] || 0 }); if (admin) o.contact = r.contact; return o; });
}
/* 후보 — 아직 어느 대회에도 안 붙은 요청. 운영자가 «이 대회 주제로» 가져간다. 올라온 순 */
function openRequests(db) {
  return db.prepare("SELECT * FROM requests WHERE event='' AND status='open' ORDER BY created, id LIMIT 50").all()
    .map(r => ({ ...publicRequest(r), solutions: db.prepare('SELECT COUNT(*) c FROM solutions WHERE request=?').get(r.id).c }));
}
/* 대회 없이 푼 결과. 백준처럼 «문제 → 풀이» 만 있고 점수는 없다 — 판정은 낸 사람이 «이거면 됩니다» 로. */
function addSolution(db, request, b) {
  const r = db.prepare('SELECT id, status FROM requests WHERE id=?').get(request);
  if (!r) throw new HttpError(404, '없는 문제입니다');
  if (r.status !== 'open') throw new HttpError(409, '닫힌 문제입니다');
  const name = plain(b.name, 40), url = String(b.url || '').trim(), note = plain(b.note, 200), contact = plain(b.contact, 80);
  if (!name) throw new HttpError(400, '이름을 넣어 주세요');
  if (!/^https?:\/\//i.test(url) || url.length > 500) throw new HttpError(400, 'https:// 로 시작하는 주소를 넣어 주세요');
  if (db.prepare('SELECT COUNT(*) c FROM solutions WHERE request=?').get(request).c >= 50) throw new HttpError(409, '풀이가 가득 찼습니다');
  const id = Number(db.prepare('INSERT INTO solutions(request,name,url,note,contact) VALUES(?,?,?,?,?)').run(request, name, url, note, contact).lastInsertRowid);
  return { id, request, name, url, note };
}
function canReceive(db, id, rkey) {
  const r = db.prepare('SELECT rkey FROM requests WHERE id=?').get(id);
  return !!(r && r.rkey && rkey && rkey === r.rkey);
}
/* 받는 화면. 마감 전엔 «누가 만들고 있나»만, 마감 뒤엔 결과물 주소·동의한 제작자 연락까지.
   연락은 참가 신청 때의 «협찬사 제공 동의»(sponsor_ok)를 한 사람만 — 동의 안 한 사람은 이름뿐이다. */
function requestView(db, id) {
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  if (!r) throw new HttpError(404, '없는 요청입니다');
  const e = r.event ? getEvent(db, r.event) : null;
  const isClosed = e ? closed(e) : false;
  const teams = r.event ? db.prepare(`SELECT t.id, t.name, t.contact, t.sponsor_ok, s.url, s.note, s.show, s.sale
                                       FROM teams t LEFT JOIN submissions s ON s.team = t.id
                                       WHERE t.event=? AND t.request=? ORDER BY t.id`).all(r.event, r.id) : [];
  const vd = {}; for (const v of db.prepare('SELECT team, ok, note, at FROM verdicts WHERE request=?').all(id)) vd[v.team] = v;
  return {
    request: publicRequest(r), followup: r.followup, followupAt: r.followup_at,
    solutions: db.prepare('SELECT id,name,url,note,contact,at FROM solutions WHERE request=? ORDER BY id').all(id),
    event: e ? { id: e.id, title: e.title, starts: e.starts, ends: e.ends, due: e.due, closed: isClosed } : null,
    teams: teams.map(t => ({
      id: t.id, name: t.name, note: t.note || '',
      url: isClosed ? webUrl(t.url) : '',                       // 마감 전엔 링크 없음 — board 의 규칙과 같다
      sale: isClosed ? (t.sale || '') : '',                     // «넘길 수 있어요» 제안. 거래는 당사자 간 — 앱은 돈을 안 만진다
      contact: isClosed && t.sponsor_ok ? t.contact : '',        // 동의한 사람만, 마감 뒤에만
      verdict: vd[t.id] ? { ok: !!vd[t.id].ok, note: vd[t.id].note, at: vd[t.id].at } : null,
    })),
  };
}
function setVerdict(db, id, b) {
  const r = db.prepare('SELECT event FROM requests WHERE id=?').get(id);
  if (!r || !r.event) throw new HttpError(409, '아직 대회에 붙지 않은 요청입니다');
  if (!closed(getEvent(db, r.event))) throw new HttpError(409, '제출 마감 뒤에 판정할 수 있습니다');
  const t = db.prepare('SELECT id FROM teams WHERE id=? AND event=? AND request=?').get(+b.team, r.event, id);
  if (!t) throw new HttpError(404, '이 요청으로 만든 팀이 아닙니다');
  db.prepare(`INSERT INTO verdicts(request,team,ok,note) VALUES(?,?,?,?)
              ON CONFLICT(request,team) DO UPDATE SET ok=excluded.ok, note=excluded.note, at=datetime('now')`)
    .run(id, t.id, b.ok ? 1 : 0, plain(b.note, 200));
  return { ok: !!b.ok };
}
const FOLLOWUPS = ['using', 'sometimes', 'no', 'broken'];   // 네 번째가 있어야 «모델이 죽었는지 물건이 죽었는지» 갈린다
function setFollowup(db, id, b) {
  if (!FOLLOWUPS.includes(b.status)) throw new HttpError(400, 'status 는 using·sometimes·no·broken 중 하나입니다');
  db.prepare("UPDATE requests SET followup=?, followup_at=datetime('now') WHERE id=?").run(b.status, id);
  return { followup: b.status };
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
    /* 2026-09-23 밤 — 되살리기(restore)가 쓰는 나머지 표. 이게 없으면 사본이 절반이다 */
    needs: db.prepare('SELECT * FROM needs WHERE event=? ORDER BY id').all(event),
    pledges: db.prepare('SELECT * FROM pledges WHERE event=? ORDER BY id').all(event),
    offers: db.prepare('SELECT * FROM offers WHERE event=? ORDER BY id').all(event),
    votes: db.prepare('SELECT * FROM votes WHERE event=? ORDER BY id').all(event),
    notices: db.prepare('SELECT * FROM notices WHERE event=? ORDER BY id').all(event),
    requests: db.prepare('SELECT * FROM requests WHERE event=? ORDER BY created, id').all(event),
    verdicts: db.prepare(`SELECT v.* FROM verdicts v JOIN requests r ON r.id = v.request WHERE r.event=?`).all(event),
    surveys: db.prepare('SELECT * FROM surveys WHERE event=? ORDER BY at').all(event),
    questions: db.prepare('SELECT * FROM questions WHERE event=? ORDER BY id').all(event),
  };
}

/* ── 지운 대회 되살리기 ──
   사본(dump JSON)을 그대로 넣는다. 주최자 열쇠(owner)가 사본의 것과 같아야 한다 — 열쇠가 흘러 지워진 대회를
   주최자가 되찾는 길이다(레드팀 길 3). 같은 id 의 대회가 살아 있으면 409.
   SQLite 는 지워진 rowid 를 재사용하므로 팀·자리 id 는 새로 받고, 딸린 표는 새 id 로 다시 잇는다. */
function restoreEvent(db, d, owner) {
  if (!d || !d.event || !d.event.id) throw new HttpError(400, '사본 파일이 아닙니다');
  const e = d.event;
  if (!owner || !e.owner || owner !== e.owner) throw new HttpError(403, '이 사본을 만든 주최자 열쇠가 필요합니다');
  if (db.prepare('SELECT 1 FROM events WHERE id=?').get(e.id)) throw new HttpError(409, '같은 id 의 대회가 살아 있습니다');
  const cols = db.prepare('PRAGMA table_info(events)').all().map(c => c.name);
  const okey = crypto.randomBytes(5).toString('hex');   // 사본엔 운영자 열쇠가 없다. 새로 준다
  const row = { ...e, okey };
  const keys = cols.filter(c => row[c] !== undefined);
  db.prepare(`INSERT INTO events(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
  const ins = (table, r, drop = ['id']) => {
    const tc = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const ks = tc.filter(c => !drop.includes(c) && r[c] !== undefined);
    return Number(db.prepare(`INSERT INTO ${table}(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...ks.map(k => r[k])).lastInsertRowid);
  };
  const tmap = {}, nmap = {};
  for (const t of d.teams || []) tmap[t.id] = ins('teams', t);
  for (const n of d.needs || []) nmap[n.id] = ins('needs', n);
  for (const x of d.submissions || []) if (tmap[x.team]) ins('submissions', { ...x, team: tmap[x.team] });
  for (const x of d.scores || []) if (tmap[x.team]) ins('scores', { ...x, team: tmap[x.team] });
  for (const x of d.reviews || []) if (tmap[x.team]) ins('reviews', { ...x, team: tmap[x.team] });
  for (const x of d.assignments || []) if (tmap[x.team]) ins('assignments', { ...x, team: tmap[x.team] });
  for (const x of d.votes || []) if (tmap[x.team]) ins('votes', { ...x, team: tmap[x.team] });
  for (const x of d.pledges || []) if (nmap[x.need]) ins('pledges', { ...x, need: nmap[x.need] });
  for (const x of d.offers || []) ins('offers', x);
  for (const x of d.notices || []) ins('notices', x);
  for (const x of d.sponsors || []) ins('sponsors', x);
  for (const x of d.outcomes || []) ins('outcomes', x);
  for (const x of d.supporters || []) ins('supporters', x);
  for (const x of d.requests || []) if (!db.prepare('SELECT 1 FROM requests WHERE id=?').get(x.id)) ins('requests', x, []);
  for (const x of d.verdicts || []) if (tmap[x.team]) ins('verdicts', { ...x, team: tmap[x.team] });
  for (const x of d.surveys || []) if (tmap[x.team]) ins('surveys', { ...x, team: tmap[x.team] });
  for (const x of d.questions || []) if (tmap[x.team]) ins('questions', { ...x, team: tmap[x.team] });
  /* 팀이 고른 주제(teams.request)는 그대로 옮겨졌다(요청 id 는 안 바뀐다) */
  return { id: e.id, okey, teams: Object.keys(tmap).length, needs: Object.keys(nmap).length };
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
const NEED_KINDS = ['venue', 'cash', 'credit', 'judge', 'prize', 'mentor', 'snack', 'other'];   // credit: AI·클라우드 크레딧 — 현금 대신, 결제 없이
const PLEDGE_STATUS = ['pending', 'ok', 'done', 'no'];
/* 꺾쇠는 저장 전에 뺀다. JSON 응답을 화면이 그대로 그려도 돌지 않게 - esc 를 잊어도 안전하다 */
const plain = (s, n) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, n);
/* 사람이 손으로 넣는 돈. 음수·글자·1e999·null 이 들어와도 0 ~ 10억 사이의 정수로 떨어진다.
   화면이 막아 주길 기대하지 않는다 — API 를 직접 때리면 화면은 없다. */
const MAX_WON = 1000000000;
const money = v => Math.min(Math.max(0, Math.floor(Number(v)) || 0), MAX_WON);

function addNeed(db, event, b) {
  const label = plain(b.label, 100);
  if (!label) throw new HttpError(400, '무슨 자리인지 적어 주세요');
  const qty = Math.min(Math.max(+b.qty || 1, 1), 99);
  const kind = NEED_KINDS.includes(b.kind) ? b.kind : 'other';
  const note = plain(b.note, 300);
  const price = money(b.price);
  const r = db.prepare('INSERT INTO needs(event,kind,label,qty,note,price) VALUES(?,?,?,?,?,?)')
    .run(event, kind, label, qty, note, price);
  return { id: Number(r.lastInsertRowid), kind, label, qty, note, price, filled: 0, pledges: [] };
}

function addPledge(db, need, event, b) {
  const name = plain(b.name, 40);
  if (!name) throw new HttpError(400, '이름을 적어 주세요');
  const pkey = crypto.randomBytes(5).toString('hex');   // 준 사람의 열쇠. 응답에서 한 번만 나간다
  const r = db.prepare('INSERT INTO pledges(need,event,name,org,contact,note,pkey,coi) VALUES(?,?,?,?,?,?,?,?)')
    .run(need, event, name, plain(b.org, 60), plain(b.contact, 100), plain(b.note, 300), pkey, b.coi ? 1 : 0);
  return { id: Number(r.lastInsertRowid), status: 'pending', ref: 'p' + Number(r.lastInsertRowid), pkey };
}

function setPledge(db, id, b) {
  if (!PLEDGE_STATUS.includes(b.status))
    throw new HttpError(400, '상태는 pending·ok·done·no 중 하나입니다');
  db.prepare('UPDATE pledges SET status=? WHERE id=?').run(b.status, id);
  /* 운영자 전용 응답이라 contact 가 실린다 - 공개 주소가 아니다 */
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
}

/* ── 자리 밖 제안(offer) — 메일 대신 앱에서 바로 ── */
const OFFER_STATUS = ['pending', 'ok', 'no'];
const OFFER_KIND_LABEL = { venue:'장소', cash:'돈', credit:'크레딧', judge:'심사', prize:'상품', mentor:'멘토', snack:'간식', other:'기타' };
function addOffer(db, event, b) {
  if (!db.prepare('SELECT 1 FROM events WHERE id=?').get(event)) throw new HttpError(404, '없는 대회입니다');
  const name = plain(b.name, 40);
  if (!name) throw new HttpError(400, '이름을 적어 주세요');
  const kind = NEED_KINDS.includes(b.kind) ? b.kind : 'other';
  const pkey = crypto.randomBytes(5).toString('hex');
  const r = db.prepare('INSERT INTO offers(event,kind,name,org,contact,note,pkey) VALUES(?,?,?,?,?,?,?)')
    .run(event, kind, name, plain(b.org, 60), plain(b.contact, 100), plain(b.note, 300), pkey);
  return { id: Number(r.lastInsertRowid), status: 'pending', ref: 'o' + Number(r.lastInsertRowid), pkey };
}
/* 운영자 전용 — contact 가 실린다 */
function offersOf(db, event) {
  return db.prepare("SELECT * FROM offers WHERE event=? AND status<>'no' ORDER BY id").all(event);
}
function setOffer(db, id, b) {
  if (!OFFER_STATUS.includes(b.status)) throw new HttpError(400, '상태는 pending·ok·no 중 하나입니다');
  const o = db.prepare('SELECT * FROM offers WHERE id=?').get(id);
  if (!o) throw new HttpError(404, '없는 제안입니다');
  /* 확인하면 그 종류의 자리를 하나 만들어 확정 기여로 넘긴다 — 공개 장부·점판이 그대로 쓴다.
     한 제안을 두 번 확인해도 자리가 두 개 생기지 않게, 이미 ok 면 그냥 둔다. */
  if (b.status === 'ok' && o.status !== 'ok') {
    const label = plain(o.note, 80) || OFFER_KIND_LABEL[o.kind] || '기타';
    const nr = db.prepare('INSERT INTO needs(event,kind,label,qty,note) VALUES(?,?,?,1,?)')
      .run(o.event, o.kind, label, '제안으로 들어온 자리');
    db.prepare("INSERT INTO pledges(need,event,name,org,contact,note,status,pkey) VALUES(?,?,?,?,?,?,'ok',?)")
      .run(Number(nr.lastInsertRowid), o.event, o.name, o.org, o.contact, o.note, o.pkey || '');
  }
  db.prepare('UPDATE offers SET status=? WHERE id=?').run(b.status, id);
  return { id, status: b.status };
}

/* ── 준 사람의 화면(/s/<ref>?k=). ref 는 p<pledge id> 또는 o<offer id>.
   보는 것: 내 후원이 확인됐나(대기·확인·거절 — 모름은 «아직 확인 전»), 대회가 어디까지 왔나(신청·제출),
   끝난 뒤엔 결과물 상위 셋·설문 요약·보고서 주소. 연락처는 어디에도 없다(공개 장부와 같은 선). */
function giveView(db, ref, k) {
  const m = /^([po])(\d+)$/.exec(String(ref || ''));
  if (!m) throw new HttpError(404, '없는 후원입니다');
  let row, kind, label;
  if (m[1] === 'p') {
    row = db.prepare(`SELECT p.*, n.kind AS nkind, n.label AS nlabel FROM pledges p JOIN needs n ON n.id = p.need WHERE p.id=?`).get(+m[2]);
    if (row) { kind = row.nkind; label = row.nlabel; }
  } else {
    row = db.prepare('SELECT * FROM offers WHERE id=?').get(+m[2]);
    if (row) { kind = row.kind; label = plain(row.note, 80) || OFFER_KIND_LABEL[row.kind] || '기타'; }
  }
  if (!row) throw new HttpError(404, '없는 후원입니다');
  if (!row.pkey || !k || k !== row.pkey) throw new HttpError(403, '열쇠가 맞지 않습니다');
  const e = getEvent(db, row.event);
  const o = outcomes(db, row.event);
  const isClosed = closed(e);
  const pk = isClosed ? pack(db, row.event, false) : null;
  /* 제안(offer)이 확인되면 같은 열쇠로 확정 기여(pledge)가 생긴다 — 그쪽 상태가 진짜다 */
  let status = row.status;
  if (m[1] === 'o' && row.status === 'ok') {
    const pl = db.prepare('SELECT status FROM pledges WHERE pkey=? AND event=? ORDER BY id DESC').get(row.pkey, row.event);
    if (pl) status = pl.status;
  }
  return {
    gift: { ref, kind, label, name: row.name, org: row.org || '', status, at: row.created },
    event: { id: e.id, title: e.title, host: e.host, starts: e.starts, ends: e.ends, due: e.due,
             closed: isClosed, ended: !!e.ends && today() > e.ends,
             teams: o.teams, finished: o.finished, finishRate: isClosed ? o.finishRate : null },
    top: pk ? pk.top.map(t => ({ rank: t.rank, name: t.name, note: t.note, url: t.url })) : [],
    all: pk ? pk.all : [],
    survey: isClosed ? surveySummary(db, row.event) : null,
    report: '/e/' + e.id + '/report',
  };
}

/* ── 끝난 뒤 설문 3문항 — 국민대 매뉴얼의 «추천하겠나·좋았던 것·고칠 것». 팀 열쇠로만, 마감 뒤에만, 팀당 하나 ── */
function addSurvey(db, event, b, req) {
  const tk = String((req && req.headers && req.headers['x-tkey']) || b.tkey || '');
  const team = tk ? db.prepare('SELECT id FROM teams WHERE event=? AND tkey=?').get(event, tk) : null;
  if (!team) throw new HttpError(403, '팀 열쇠가 필요합니다');
  if (!closed(getEvent(db, event))) throw new HttpError(409, '제출 마감 뒤에 답할 수 있습니다');
  const rec = Number(b.recommend);
  if (!Number.isInteger(rec) || rec < 0 || rec > 10) throw new HttpError(400, 'recommend 는 0~10 정수입니다');
  db.prepare(`INSERT INTO surveys(event,team,recommend,good,fix) VALUES(?,?,?,?,?)
              ON CONFLICT(event,team) DO UPDATE SET recommend=excluded.recommend, good=excluded.good, fix=excluded.fix, at=datetime('now')`)
    .run(event, team.id, rec, plain(b.good, 200), plain(b.fix, 200));
  return { ok: true };
}
/* 공개 요약. 세 건 미만이면 숫자를 안 낸다 — 두 팀의 점수는 «어느 팀이 몇 점»이 드러난다(모름≠0) */
function surveySummary(db, event, admin = false) {
  const rows = db.prepare('SELECT recommend, good, fix FROM surveys WHERE event=? ORDER BY at').all(event);
  const n = rows.length;   // 팀 수다 — UNIQUE(event, team) 라 같은 팀이 두 번 답해도 하나
  if (n < MIN_CELL) return { n, recommend: null, good: [], fix: [], minCell: MIN_CELL };
  const avg = Math.round(rows.reduce((a, r) => a + r.recommend, 0) / n * 10) / 10;
  /* 서술 원문(«총무가 …»)은 운영자만 본다. 공개 보고서와 후원자 화면에는 숫자와 «n팀»만 */
  return { n, recommend: avg,
           good: admin ? rows.map(r => r.good).filter(Boolean) : [],
           fix: admin ? rows.map(r => r.fix).filter(Boolean) : [], minCell: MIN_CELL };
}

/* ── 대회 안 묻고 답하기. 커뮤니티가 아니다 — 팀 열쇠로 묻고 운영자만 답하고, 답은 소식에 쌓인다. ── */
const ended = e => !!e.ends && today() > e.ends;
function askQuestion(db, event, b, req) {
  const tk = String((req && req.headers && req.headers['x-tkey']) || b.tkey || '');
  const team = tk ? db.prepare('SELECT id FROM teams WHERE event=? AND tkey=?').get(event, tk) : null;
  if (!team) throw new HttpError(403, '팀 열쇠가 필요합니다 — 신청한 브라우저에서 물어 주세요');
  if (ended(getEvent(db, event))) throw new HttpError(409, '끝난 대회입니다. 읽기만 됩니다');
  const text = plain(b.text, 200);
  if (!text) throw new HttpError(400, '질문을 적어 주세요');
  /* 도배 상한 — 답이 안 달린 질문이 셋이면 더 못 묻는다 */
  const open = db.prepare("SELECT COUNT(*) c FROM questions WHERE event=? AND team=? AND answer='' AND hidden=0").get(event, team.id).c;
  if (open >= 3) throw new HttpError(409, '답을 기다리는 질문이 셋입니다. 답이 달리면 더 물을 수 있습니다');
  const r = db.prepare('INSERT INTO questions(event,team,text) VALUES(?,?,?)').run(event, team.id, text);
  return { id: Number(r.lastInsertRowid) };
}
function answerQuestion(db, id, b) {
  const q = db.prepare('SELECT * FROM questions WHERE id=? AND hidden=0').get(+id);
  if (!q) throw new HttpError(404, '없는 질문입니다');
  const answer = plain(b.answer, 300);
  if (!answer) throw new HttpError(400, '답을 적어 주세요');
  db.prepare("UPDATE questions SET answer=?, answered_at=datetime('now') WHERE id=?").run(answer, q.id);
  /* 답은 묻지 않은 팀도 알아야 한다 — 소식에 자동으로. 물은 팀 이름은 안 싣는다 */
  db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(q.event, plain('답변 · ' + q.text.slice(0, 30) + (q.text.length > 30 ? '…' : '') + ' → ' + answer, 200));
  return { ok: true };
}
function hideQuestion(db, id) {
  const q = db.prepare('SELECT event FROM questions WHERE id=?').get(+id);
  if (!q) throw new HttpError(404, '없는 질문입니다');
  db.prepare('UPDATE questions SET hidden=1 WHERE id=?').run(+id);
  return { ok: true };
}
/* 팀이 자기 질문을 닫는다 — 답이 안 달린 것만. 열쇠를 본 사람이 셋을 채워 문을 잠가도 진짜 팀원이 연다 */
function closeOwnQuestion(db, id, tk) {
  const q = db.prepare('SELECT q.id, q.answer, t.tkey FROM questions q JOIN teams t ON t.id = q.team WHERE q.id=? AND q.hidden=0').get(+id);
  if (!q) throw new HttpError(404, '없는 질문입니다');
  if (!tk || tk !== q.tkey) throw new HttpError(403, '그 팀의 열쇠가 아닙니다');
  if (q.answer) throw new HttpError(409, '답이 달린 질문은 닫을 수 없습니다');
  db.prepare('UPDATE questions SET hidden=1 WHERE id=?').run(q.id);
  return { ok: true };
}
/* 공개 목록. 팀 이름은 나간다(익명 없음) — 연락처는 없다. 24시간 넘게 답이 없으면 waiting */
function questionsOf(db, event) {
  return db.prepare(`SELECT q.id, q.text, q.answer, q.at, q.answered_at, t.name AS team
                     FROM questions q JOIN teams t ON t.id = q.team
                     WHERE q.event=? AND q.hidden=0 ORDER BY q.id DESC LIMIT 50`).all(event)
    .map(q => ({ ...q, waiting: !q.answer && (Date.now() - new Date(q.at.replace(' ', 'T') + 'Z')) > 86400000 }));
}

/* ── 캘린더 파일. 종일 일정은 날짜만 적는다(시간대·오프셋을 붙이면 하루가 밀린다 — E38) ── */
function icsOf(e, base) {
  const d = s => String(s || '').replace(/-/g, '');
  const next = s => { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10).replace(/-/g, ''); };
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HACK:ON//KO', 'BEGIN:VEVENT',
    'UID:hackon-' + e.id + '@hackon.mandeun.com',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    'DTSTART;VALUE=DATE:' + d(e.starts), 'DTEND;VALUE=DATE:' + next(e.ends || e.starts),
    'SUMMARY:' + esc(e.title), 'URL:' + base + '/e/' + e.id,
    'DESCRIPTION:' + esc((e.topic ? '주제 ' + e.topic + '. ' : '') + (e.due ? '제출 마감 ' + e.due.replace('T', ' ') + '. ' : '') + base + '/e/' + e.id),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/* ── 내보내기(CSV). 운영자만 — 연락처가 실린다. 첫 줄에 BOM 을 넣어 엑셀이 한글을 제대로 연다 ── */
function csvOf(db, event, withContact = true) {
  const b = board(db, event, true);
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  /* 스태프 방에 올릴 판은 «연락 빼고»로 받는다 — 연락처 열 자체가 없다 */
  const head = ['자리', '팀', ...(withContact ? ['연락처'] : []), '역할', '체크인', '제출 주소', '점수', '보정 점수', '순위'];
  const lines = [head.join(',')];
  for (const r of b.rows) lines.push([r.no, r.name, ...(withContact ? [r.contact] : []), r.role, r.came, r.url || '', r.score, r.rscore, r.rank].map(cell).join(','));
  lines.push('', ['자리 종류', '자리', '이름', '소속', '상태'].join(','));
  for (const x of pledgesOf(db, event).filter(x => x.status === 'ok' || x.status === 'done'))
    lines.push([x.kind, x.label, x.name, x.org, x.status].map(cell).join(','));
  return '\ufeff' + lines.join('\n') + '\n';
}

/* 공개가 봐도 되는 것만 골라 붙인다. contact 는 이 함수를 거쳐서는 한 번도 나가지 않는다 */
function needsOf(db, event) {
  const pl = db.prepare('SELECT id, need, name, org, status, coi FROM pledges WHERE event=? ORDER BY id')
    .all(event);
  return db.prepare('SELECT * FROM needs WHERE event=? ORDER BY id').all(event)
    .map(n => ({
      id: n.id, kind: n.kind, label: n.label, qty: n.qty, note: n.note,
      amount: +n.amount || 0, price: +n.price || 0, held: !!n.held, auto: !!n.auto,
      filled: pl.filter(p => p.need === n.id && (p.status === 'ok' || p.status === 'done')).length,
      pledges: pl.filter(p => p.need === n.id)
                 .map(p => ({ id: p.id, name: p.name, org: p.org, status: p.status, coi: !!p.coi })),
    }));
}

/* 첫 화면 '지난 대회 우수작'. 운영자가 별표한 팀만. 목록에 올린 대회에서, 링크는 마감 뒤에만.
   메일·연락처 같은 개인정보는 절대 안 싣는다 — 팀 이름·대회 제목·설명·제출 링크뿐. */
function showcase(db) {
  /* 문 세 개를 다 지나야 실린다 - 운영자 별표(featured) · 목록 공개(listed) ·
     그리고 만든 사람 본인의 동의(s.show). 앞의 둘은 우리가 켜고, 마지막은 본인만 켠다.
     별표만으로 남의 결과물을 첫 화면에 거는 것은 게시가 아니라 전시다. */
  const rows = db.prepare(`SELECT t.name, t.event, e.title AS event_title, e.due, e.ends,
                                  s.url, s.note
                           FROM teams t JOIN events e ON e.id = t.event
                           JOIN submissions s ON s.team = t.id
                           WHERE t.featured=1 AND e.listed=1 AND s.show=1 AND s.url<>''
                           ORDER BY t.id DESC LIMIT 24`).all();
  return rows
    .filter(r => closed({ due: r.due, ends: r.ends }))   // 마감 전 링크 보호 규칙과 같은 선
    /* 주소를 한 번 더 거른다. 저장할 때 webUrl 로 막지만, 그 칸이 생기기 전에 들어간 값과
       DB 를 직접 만진 경우가 남는다. 첫 화면은 이 주소를 <iframe src> 와 <a href> 에 그대로
       넣으므로 javascript: 하나가 들어오면 그게 우리 첫 화면에서 돈다.
       열쇠를 «지우고 + 참검사» 두 번 보는 것과 같은 이유다. */
    .filter(r => webUrl(r.url))
    .map(r => ({ name: r.name, event: r.event, eventTitle: r.event_title,
                 url: webUrl(r.url), note: r.note || '' }));
}

function ledgerOf(db, event) {
  /* direct — 운영자가 «밖에서 구했어요»로 직접 올린 줄. 신청을 거쳐 확인된 줄과 구분해 보여 준다(레드팀: 운영자 사칭) */
  return db.prepare(`SELECT n.kind, n.label, p.name, p.org, p.status, p.created AS at,
                            CASE WHEN p.note = '앱 밖에서 구함' THEN 1 ELSE 0 END AS direct
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
    req.on('end', () => { try {
      const v = s ? JSON.parse(s) : {};
      /* null·배열·문자열 본문은 빈 것으로 친다. 안 그러면 라우트가 v.title 을 읽다 500 이 난다
         (본문이 정상 JSON 이라 400 으로도 안 걸린다). 빈 것이면 각 라우트의 '필수' 검사가 400 을 낸다. */
      res(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    } catch { rej(new HttpError(400, 'JSON 이 아닙니다')); } });
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
      const bare = wwwTo(req.headers.host);
      if (bare) { res.writeHead(301, { location: bare + req.url }); return res.end(); }
      /* 화면을 연 것만 센다. api 호출까지 세면 한 사람이 열 번으로 보인다. */
      if (req.method === 'GET' && !p.startsWith('/api/'))
        try { countVisit(db, p, req.headers.referer || '', req.headers.host); } catch { /* 셈이 사이트를 죽이면 안 된다 */ }
      if (p === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(robots());
      }
      if (p === '/sitemap.xml') {
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-cache' });
        return res.end(sitemap(db));
      }
      /* /news.md 와 /mcp 는 /api/ 밖에 있다 — 클로드·카카오 AI 채팅이 그대로 부르는 주소라 짧게 둔다 */
      if (p === '/news.md' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); return res.end(newsMd(db, JOBS.includes(u.searchParams.get('job')) ? u.searchParams.get('job') : '')); }
      if (p === '/mcp' && req.method === 'POST') {
        const msg = await body(req);
        const out = Array.isArray(msg) ? msg.map(x => mcpCall(db, x)).filter(Boolean) : mcpCall(db, msg);
        if (out === null) { res.writeHead(202); return res.end(); }
        return json(res, 200, out);
      }
      if (p === '/mcp' && req.method === 'GET') return json(res, 200, { name: 'hackon', transport: 'streamable-http (POST only)', tools: MCP_TOOLS.map(t => t.name) });
      if (p.startsWith('/api/')) {
        const q = Object.fromEntries(u.searchParams);
        let m;

        if (p === '/api/events' && req.method === 'GET')
          /* 목록에는 공개한 것만 싣는다. 이름만 넣고 만 대회가 첫 화면에 쌓이면
             들어온 사람이 "여긴 빈 곳이구나" 하고 나간다. */
        {
          const rows = db.prepare(
            `SELECT id,title,host,starts,ends,prize,
                    (julianday('now') - julianday(created)) AS ageDays,
                    (julianday(ends)  - julianday('now'))   AS dueDays
             FROM events WHERE listed = 1 ORDER BY created DESC LIMIT 50`).all();
          /* 고를 근거를 목록에 같이 싣는다.
             설명회에서 "어느 기관이 유명한가, 경쟁률이 낮은가만 보고 고르지 말고
             프로필을 확인하라" 고 했는데, 확인하러 들어가야 하면 아무도 안 한다.
             지난 실적을 카드에 미리 얹어 둔다. */
          for (const r of rows) {
            r.teams = db.prepare('SELECT COUNT(*) c FROM teams WHERE event=?').get(r.id).c;
            /* 함께한 곳 — 포도 한 상자도 여기 이름이 실린다. 첫 화면이 «함께: ○○» 한 줄로 그린다 */
            r.sponsors = db.prepare('SELECT name FROM sponsors WHERE event=? ORDER BY id LIMIT 4').all(r.id).map(x => x.name);
            const rec = record(db, r.id);
            if (rec) { r.pastEvents = rec.events; r.pastFinish = rec.finishRate; }
            /* 깊은 신호. 확인된 기여는 «한 자리 맡겠다»가 운영자 확인까지 간 것이다. */
            r.filled = db.prepare(
              "SELECT COUNT(*) c FROM pledges WHERE event=? AND status IN ('ok','done')").get(r.id).c;
            const want = db.prepare('SELECT COALESCE(SUM(qty),0) t FROM needs WHERE event=?').get(r.id).t;
            r.openNeeds = Math.max(0, want - r.filled);
          }
          rows.sort((a, b) => rankScore(b) - rankScore(a));
          const ranked = spreadHosts(rows);
          for (const r of ranked) { delete r.ageDays; delete r.dueDays; }
          return json(res, 200, ranked);
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
        /* 심사 열쇠. 심사 화면 링크(/j/<id>?k=…)로 받아 브라우저가 x-jkey 로 실어 보낸다. */
        const jkey = req.headers['x-jkey'] || '';

        if (p === '/api/events' && req.method === 'POST') {
          const b = await body(req);
          if (owner) b.owner = owner;   // 이미 연 적이 있으면 그 사람 것으로 묶는다
          /* «지난 대회에서 가져오기». 그 대회의 운영 열쇠(fromKey)나 주최자여야 한다 — 공개 id 만으로 남의 설정을 베끼는 길을 막는다.
             가져오는 것: 기준표·주제·상금·정원·진행 순서·현장/온라인·대화방·신고 창구·자리(개수만). 사람은 안 가져온다. */
          let src = null;
          if (b.from) {
            if (!isAdmin(db, String(b.from), String(b.fromKey || ''), owner)) throw new HttpError(403, '지난 대회의 운영 열쇠가 필요합니다');
            src = getEvent(db, String(b.from));
            b.rubric = src.rubric; b.topic = b.topic || src.topic; b.cap = src.cap; b.plan = src.plan;   // 상금·날짜는 안 가져온다 — 새로 정할 것
          }
          const made = createEvent(db, b);
          /* «이 문제로 내 대회 열기» — 열린 의뢰(어느 대회에도 안 붙은 것)를 새 대회의 첫 주제로 붙인다.
             의뢰자가 자기 문제로 여는 길이자, 남의 문제를 보고 여는 길. 이미 붙은 의뢰는 조용히 건너뛴다. */
          if (b.req) {
            const rq = db.prepare("SELECT id FROM requests WHERE id=? AND event='' AND status='open'").get(String(b.req));
            if (rq) { db.prepare('UPDATE requests SET event=? WHERE id=?').run(made.id, rq.id); made.req = rq.id; }
          }
          if (src) {
            editEvent(db, made.id, { mode: src.mode, chat: src.chat, safety: src.safety, wifi: src.wifi });
            for (const n of db.prepare('SELECT kind, label, qty, note, price FROM needs WHERE event=? ORDER BY id').all(src.id))
              db.prepare('INSERT INTO needs(event,kind,label,qty,note,price) VALUES(?,?,?,?,?,?)').run(made.id, n.kind, n.label, n.qty, n.note, n.price);
            made.copied = src.id;
          }
          return json(res, 201, made);
        }
        /* 캘린더 파일 — 신청 뒤 «다음에 할 일»에서 내려받는다. 종일 일정이라 날짜만 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/ics$/)) && req.method === 'GET') {
          const e = getEvent(db, m[1]);
          res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8',
                               'content-disposition': 'attachment; filename="hackon-' + e.id + '.ics"' });
          return res.end(icsOf(e, siteOf(req)));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/export\.csv$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);   // 연락처가 실린다 — 운영자만
          res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8',
                               'content-disposition': 'attachment; filename="hackon-' + m[1] + '.csv"' });
          return res.end(csvOf(db, m[1], q.contact !== '0'));
        }
        /* 후원 링크 다시 — 운영자가 연락처를 아니 새 열쇠를 만들어 그 사람에게만 보낸다. 옛 링크는 그 자리에서 죽는다 */
        if ((m = p.match(/^\/api\/give\/([po])(\d+)\/rekey$/)) && req.method === 'POST') {
          const table = m[1] === 'p' ? 'pledges' : 'offers';
          const row = db.prepare(`SELECT id, event, pkey FROM ${table} WHERE id=?`).get(+m[2]);
          if (!row) throw new HttpError(404, '없는 후원입니다');
          needAdmin(db, row.event, key, owner);
          const pkey = crypto.randomBytes(5).toString('hex');
          db.prepare(`UPDATE ${table} SET pkey=? WHERE id=?`).run(pkey, row.id);
          /* 제안이 확인돼 생긴 확정 기여도 같은 열쇠를 들고 있다 — 같이 바꾼다 */
          if (table === 'offers' && row.pkey) db.prepare('UPDATE pledges SET pkey=? WHERE event=? AND pkey=?').run(pkey, row.event, row.pkey);
          return json(res, 200, { link: `/s/${m[1]}${row.id}?k=${pkey}` });
        }
        /* 준 사람의 화면 — 열쇠는 쿼리(k)로 온다. 받는 사람(/r) 과 같은 모양 */
        if ((m = p.match(/^\/api\/give\/([po]\d+)\/view$/)) && req.method === 'GET')
          return json(res, 200, giveView(db, m[1], String(q.k || req.headers['x-pkey'] || '')));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/survey$/)) && req.method === 'GET')
          return json(res, 200, surveySummary(db, m[1], isAdmin(db, m[1], key, owner)));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/survey$/)) && req.method === 'POST')
          return json(res, 200, addSurvey(db, m[1], await body(req), req));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/questions$/)) && req.method === 'GET')
          return json(res, 200, questionsOf(db, m[1]));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/questions$/)) && req.method === 'POST')
          return json(res, 201, askQuestion(db, m[1], await body(req), req));
        if ((m = p.match(/^\/api\/questions\/(\d+)\/answer$/)) && req.method === 'POST') {
          const qq = db.prepare('SELECT event FROM questions WHERE id=?').get(+m[1]);
          if (!qq) throw new HttpError(404, '없는 질문입니다');
          needAdmin(db, qq.event, key, owner);
          return json(res, 200, answerQuestion(db, m[1], await body(req)));
        }
        if ((m = p.match(/^\/api\/questions\/(\d+)$/)) && req.method === 'DELETE') {
          const qq = db.prepare('SELECT event FROM questions WHERE id=?').get(+m[1]);
          if (!qq) throw new HttpError(404, '없는 질문입니다');
          if (req.headers['x-tkey'] && !isAdmin(db, qq.event, key, owner)) return json(res, 200, closeOwnQuestion(db, m[1], req.headers['x-tkey']));
          needAdmin(db, qq.event, key, owner);
          return json(res, 200, hideQuestion(db, m[1]));
        }
        /* 심사 진행 알림 — «심사 n/m 팀 봤습니다»를 소식에. 참가자가 기다리는 동안 어디까지 왔는지 안다(MLH) */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/progress$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const bd = board(db, m[1], true);
          const seen = bd.rows.filter(r => r.judges > 0).length, total = bd.rows.filter(r => r.done).length || bd.rows.length;
          db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(m[1], `심사 진행 · ${seen}/${total}팀 봤습니다`);
          return json(res, 200, { seen, total });
        }
        /* 순위 보정 켜고 끄기 — 마감 뒤엔 vmode 와 같은 이유로 못 바꾼다 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/ranked$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          if (closed(getEvent(db, m[1]))) throw new HttpError(409, '제출 마감이 지나 순위가 공개됐습니다. 산정 방식은 더 못 바꿉니다');
          const on = (await body(req)).on ? 1 : 0;
          const was = db.prepare('SELECT ranked FROM events WHERE id=?').get(m[1]).ranked;
          db.prepare('UPDATE events SET ranked=? WHERE id=?').run(on, m[1]);
          if (was !== on) db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(m[1],
            on ? '순위 산정을 심사위원별 등수 보정으로 바꿨습니다' : '순위 산정을 점수 평균으로 되돌렸습니다');
          return json(res, 200, { ranked: !!on });
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
        if ((m = p.match(/^\/api\/sponsors\/(\d+)\/logo$/)) && req.method === 'GET') {
          const lg = db.prepare('SELECT mime, data FROM sponsor_logos WHERE sponsor=?').get(+m[1]);
          if (!lg) throw new HttpError(404, '로고가 없습니다');
          res.writeHead(200, { 'content-type': lg.mime, 'cache-control': 'public, max-age=86400' });
          return res.end(lg.data);
        }
        /* 깃허브 공개 이력 — 링크가 github.com/아이디 면 공개 저장소·별 수·대표 저장소만. 인증 없이(시간당 60회) + 하루 캐시 */
        if ((m = p.match(/^\/api\/gh\/([A-Za-z0-9-]{1,39})$/)) && req.method === 'GET')
          return json(res, 200, await ghProfile(db, m[1]));
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
        if (p === '/api/visits' && req.method === 'GET') {
          /* ADMIN_KEY 를 아는 사람만. 그게 없으면(내 노트북) 이 컴퓨터에서만 보인다. */
          const local = /^(::1$|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
          if (!(process.env.ADMIN_KEY ? headOwner === process.env.ADMIN_KEY : local))
            throw new HttpError(403, '볼 수 있는 열쇠가 아닙니다');
          return json(res, 200, visitsOf(db, q.days));
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
            const eb = await body(req);
            editEvent(db, m[1], eb);
            if (eb.cap !== undefined) promoteWaiting(db, m[1]);   /* 정원을 늘리면 대기자가 올라온다 */
            return json(res, 200, getEvent(db, m[1]));
          }
          if (req.method === 'GET') {
            const e = getEvent(db, m[1]);
            e.admin = isAdmin(db, m[1], key, owner);
            /* 심사 열쇠는 운영자에게만. 심사위원에게 보낼 링크를 이걸로 만든다. */
            if (e.admin) { const kk = db.prepare('SELECT jkey, vkey, judged FROM events WHERE id=?').get(m[1]);
                           e.jkey = kk.jkey; e.vkey = kk.vkey; e.judged = kk.judged; }
            return json(res, 200, e);
          }
          if (req.method === 'DELETE') {
            needAdmin(db, m[1], key, owner);
            return json(res, 200, deleteEvent(db, m[1], await body(req)));
          }
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/teams$/)) && req.method === 'POST') {
          /* 팀 열쇠는 여기서 딱 한 번 나간다. 신청한 브라우저가 받아서 들고 있는다. */
          const jb = await body(req);
          delete jb._promote;   /* 내부 표식 — 밖에서 보내면 정원 검사를 건너뛴다. 경계에서 지운다 */
          const tid = joinTeam(db, m[1], jb);
          if (typeof tid === 'object') return json(res, 202, tid);   /* 정원이 차서 대기자로 — { waiting: 몇 번째 } */
          const nt = db.prepare('SELECT tkey FROM teams WHERE id=?').get(tid);
          const jm = joinMail(db, tid); if (jm) void sendMail(db, jm);   /* 기다리지 않는다 — 신청 응답이 메일에 묶이면 안 된다 */
          return json(res, 201, { id: tid, tkey: nt.tkey });
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/board$/))) {
          const adm = isAdmin(db, m[1], key, owner);
          const bd = board(db, m[1], adm);
          /* 심사 링크를 만들려면 운영자에게 심사 열쇠가 필요하다. 손님에겐 절대 안 준다. */
          if (adm) { const kk = db.prepare('SELECT jkey, vkey, judged FROM events WHERE id=?').get(m[1]);
                     bd.event.jkey = kk.jkey; bd.event.vkey = kk.vkey; bd.event.judged = kk.judged;
                     bd.trash = db.prepare('SELECT id, team, name, at, by FROM team_trash WHERE event=? ORDER BY id DESC').all(m[1]);
                     bd.mails = db.prepare('SELECT status, COUNT(*) c FROM mail_log WHERE event=? GROUP BY status').all(m[1]); }
          return json(res, 200, bd);
        }

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/sponsors$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const b = await body(req);
          /* 링크만 넣어도 된다 — 로고 주소가 없으면 도메인에서 찾는다(운영자가 «찾기»를 안 눌렀어도) */
          let logo = webUrl(b.logo), link = webUrl(b.link);
          if (!link && b.domain) { const lf = logoFor(b.domain); if (lf.ok) link = 'https://' + lf.domain; }
          if (!logo && link) { const lf = logoFor(link.replace(/^https?:\/\//, '').split('/')[0]); if (lf.ok) logo = lf.url; }
          const r = db.prepare('INSERT INTO sponsors(event,name,kind,amount,note,logo,link) VALUES(?,?,?,?,?,?,?)')
            .run(m[1], b.name, b.kind || '현금', +b.amount || 0, b.note || '', logo, link);
          const sid = Number(r.lastInsertRowid);
          /* 직접 올린 파일 — data: 주소로 온다. 종류·크기를 보고 그대로 저장, 로고 주소는 우리 경로로 */
          const dm = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.logoData || ''));
          if (dm && dm[2].length < 560000) {
            db.prepare('INSERT OR REPLACE INTO sponsor_logos(sponsor,mime,data) VALUES(?,?,?)').run(sid, dm[1], Buffer.from(dm[2], 'base64'));
            db.prepare('UPDATE sponsors SET logo=? WHERE id=?').run(`/api/sponsors/${sid}/logo`, sid);
          }
          return json(res, 201, { ok: true, id: sid, logo: db.prepare('SELECT logo FROM sponsors WHERE id=?').get(sid).logo });
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
          if (b.notice) db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(m[1], plain(b.notice, 200));
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

        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/judge$/)) && req.method === 'GET') {
          if (!canJudge(db, m[1], key, owner, jkey))
            throw new HttpError(403, '심사 열쇠가 필요합니다');
          return json(res, 200, judgeView(db, m[1], q.judge || '', isAdmin(db, m[1], key, owner)));
        }

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
        if ((m = p.match(/^\/api\/teams\/(\d+)\/confirm$/)) && req.method === 'POST') {
          /* 참석 재확인. 그 팀(팀 열쇠)만 누른다. going:false 면 «못 가요» — 주최자가 당일이 아니라 미리 안다. */
          const b = await body(req);
          const t = db.prepare('SELECT tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          const tk = String(req.headers['x-tkey'] || b.tkey || '');
          if (!tk || tk !== t.tkey) throw new HttpError(403, '그 팀의 열쇠가 필요합니다');
          const confirmed = b.going === false ? 'no' : new Date().toISOString();
          db.prepare('UPDATE teams SET confirmed=? WHERE id=?').run(confirmed, +m[1]);
          const t2 = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (confirmed === 'no') promoteWaiting(db, t2.event);   /* 돌려준 자리는 바로 다음 대기자에게 */
          return json(res, 200, { confirmed });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/submit$/)) && req.method === 'POST') {
          /* 제출물은 그 팀이나 운영자만 바꾼다. 팀 번호가 1,2,3… 순서라 이걸 안 막으면
             지나가던 사람이 남의 제출 링크를 마감 직전에 바꿔치기할 수 있다(GLM 레드팀).
             /more 가 팀 열쇠로 막는 것과 같은 방식 — 대회의 경쟁 결과가 걸린 곳이라 더 그렇다. */
          const t = db.prepare('SELECT event, tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          const tk = req.headers['x-tkey'] || '';
          if (!isAdmin(db, t.event, key, owner) && !(t.tkey && tk && tk === t.tkey))
            throw new HttpError(403, '이 팀의 참가 열쇠나 운영자 열쇠가 필요합니다');
          submit(db, +m[1], await body(req));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/showcase$/)) && req.method === 'POST') {
          /* 쇼케이스 동의 켜고 끄기. 제출과 같은 열쇠를 요구하되 마감은 보지 않는다.
             동의를 남이 대신 켜 주는 것은 동의가 아니므로 운영자도 «켜는» 것은 못 한다.
             내리는 것은 운영자도 할 수 있어야 한다 - 문제가 생겼을 때 즉시 내려야 한다. */
          const t2 = db.prepare('SELECT event, tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t2) throw new HttpError(404, '없는 팀입니다');
          const tk2 = req.headers['x-tkey'] || '';
          const owns = !!(t2.tkey && tk2 && tk2 === t2.tkey);
          const adm = isAdmin(db, t2.event, key, owner);
          if (!owns && !adm) throw new HttpError(403, '이 팀의 참가 열쇠가 필요합니다');
          const want = !!(await body(req)).on;
          if (want && !owns) throw new HttpError(403, '쇼케이스 동의는 본인만 켤 수 있습니다');
          return json(res, 200, showConsent(db, +m[1], want));
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/vmode$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);   // 관객 평가 켜고 끄기 — 운영자만
          /* 마감 뒤에는 순위가 이미 공개됐다. 기준을 바꾸면 발표된 순위가 바뀐다 — 막는다 */
          if (closed(getEvent(db, m[1]))) throw new HttpError(409, '제출 마감이 지나 순위가 공개됐습니다. 평가 방식은 더 못 바꿉니다');
          const bd = await body(req);
          const on = bd.on ? 1 : 0, peer = on && bd.peer ? 1 : 0;
          const was = db.prepare('SELECT vmode, vpeer FROM events WHERE id=?').get(m[1]);
          db.prepare('UPDATE events SET vmode=?, vpeer=? WHERE id=?').run(on, peer, m[1]);
          /* 평가 방식을 바꾼 것은 참가자가 알아야 한다 — 소식에 자동으로 남긴다(레드팀: 마감 직전 전환) */
          if (was && (was.vmode !== on || was.vpeer !== peer))
            db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(m[1],
              !on ? '평가 방식을 심사위원 점수로 되돌렸습니다' : peer ? '평가 방식을 참가팀 상호평가로 바꿨습니다' : '평가 방식을 관객 평가로 바꿨습니다');
          return json(res, 200, { vmode: !!on, vpeer: !!peer, judges: board(db, m[1], true).judges.length });
        }
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/vote$/)) && req.method === 'GET') {
          /* 투표 화면 데이터. 투표 열쇠나 운영자만. 팀 이름만 준다(마감 전 링크 보호는 board 몫). */
          if (!canVote(db, m[1], key, owner, req.headers['x-vkey'] || '', req.headers['x-tkey'] || ''))
            throw new HttpError(403, '관객 평가가 아직 안 켜졌거나 투표 열쇠가 필요합니다');
          const e = getEvent(db, m[1]);
          const me = e.vpeer ? peerTeam(db, m[1], req.headers['x-tkey'] || '') : null;
          const teams = db.prepare('SELECT id, name FROM teams WHERE event=? ORDER BY id').all(m[1]);
          return json(res, 200, { event: { id: e.id, title: e.title, due: e.due, ends: e.ends, vpeer: !!e.vpeer },
                                  teams, me: me ? me.id : null });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/vote$/)) && req.method === 'POST') {
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          if (!canVote(db, t.event, key, owner, req.headers['x-vkey'] || '', req.headers['x-tkey'] || ''))
            throw new HttpError(403, '관객 평가가 아직 안 켜졌거나 투표 열쇠가 필요합니다');
          const b = await body(req);
          let voter = plain(b.voter, 40);
          const ev = db.prepare('SELECT vpeer FROM events WHERE id=?').get(t.event);
          if (ev && ev.vpeer) {
            /* 상호평가 — 표의 주인은 팀이다. 팀 열쇠로만 정하고(화면이 보낸 팀 이름은 안 믿는다),
               자기 팀은 못 찍는다. 팀당 한 표라 팀원 둘이 찍으면 나중 것이 남는다 */
            const me = peerTeam(db, t.event, req.headers['x-tkey'] || '');
            if (!me) throw new HttpError(400, '상호평가는 참가 신청한 브라우저(팀 열쇠)에서만 됩니다');
            if (me.id === +m[1]) throw new HttpError(403, '자기 팀에는 표를 못 줍니다');
            voter = 'team:' + me.id;
          }
          const sc = +b.score;
          if (!voter) throw new HttpError(400, '누가 주는 표인지가 없습니다');
          if (!(sc >= 1 && sc <= 5)) throw new HttpError(400, '표는 1~5 입니다');
          db.prepare(`INSERT INTO votes(event,team,voter,score,note) VALUES(?,?,?,?,?)
                      ON CONFLICT(event,team,voter) DO UPDATE SET score=excluded.score, note=excluded.note, at=datetime('now')`)
            .run(t.event, +m[1], voter, sc, plain(b.note, 80));
          return json(res, 200, { ok: true });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/feature$/)) && req.method === 'POST') {
          /* 추천작 표시. 운영자만. 공개 페이지·첫 화면 쇼케이스에 별표로 뜬다. */
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          needAdmin(db, t.event, key, owner);
          const on = (await body(req)).on ? 1 : 0;
          db.prepare('UPDATE teams SET featured=? WHERE id=?').run(on, +m[1]);
          return json(res, 200, { featured: !!on });
        }
        if ((m = p.match(/^\/api\/teams\/(\d+)\/score$/)) && req.method === 'POST') {
          /* 점수는 운영자나 심사 열쇠를 든 사람만 넣는다. 팀 번호가 순서라, 안 막으면
             공개 event id 만 알면 아무나 남의 점수를 0점으로 덮을 수 있었다(GLM 레드팀). */
          const t = db.prepare('SELECT event FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          if (!canJudge(db, t.event, key, owner, jkey))
            throw new HttpError(403, '심사 열쇠가 필요합니다');
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
        /* 예산 배분. 미리보기(dry=1)는 안 쓰고 보여만 준다. 진짜 굽는 건 운영자만. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/allocate$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          /* 0원 나누기는 vmode 를 켠다 — /vmode 의 마감 뒤 409 를 이 길로 돌아가면 안 된다 */
          if (closed(getEvent(db, m[1]))) throw new HttpError(409, '제출 마감이 지난 대회는 자리를 다시 나누지 않습니다');
          const bd = await body(req);
          if (bd.budget !== undefined) editEvent(db, m[1], { budget: bd.budget });
          if (q.dry) {
            const e2 = db.prepare('SELECT budget, cap FROM events WHERE id=?').get(m[1]);
            return json(res, 200, allocate(e2.budget, e2.cap));
          }
          return json(res, 200, reallocate(db, m[1]));
        }
        /* 자리 한 줄 손고침. 금액을 고치면 held 가 켜져 «다시 나누기»가 못 덮는다. */
        if ((m = p.match(/^\/api\/needs\/(\d+)$/)) && req.method === 'PATCH') {
          const n = db.prepare('SELECT event FROM needs WHERE id=?').get(+m[1]);
          if (!n) throw new HttpError(404, '없는 자리입니다');
          needAdmin(db, n.event, key, owner);
          const bd = await body(req);
          const set = [], val = [];
          if (bd.amount !== undefined) { set.push('amount=?', 'held=1'); val.push(money(bd.amount)); }
          /* 희망가도 손고침으로 친다 — 안 그러면 «다시 나누기» 한 번에 값매김이 통째로 날아간다 */
          if (bd.price !== undefined) { set.push('price=?', 'held=1'); val.push(money(bd.price)); }
          if (bd.qty !== undefined) { set.push('qty=?', 'held=1'); val.push(Math.min(Math.max(+bd.qty || 1, 1), 99)); }
          if (bd.held !== undefined) { set.push('held=?'); val.push(bd.held ? 1 : 0); }
          if (!set.length) throw new HttpError(400, '고칠 것이 없습니다');
          db.prepare(`UPDATE needs SET ${set.join(',')} WHERE id=?`).run(...val, +m[1]);
          return json(res, 200, needsOf(db, n.event).find(x => x.id === +m[1]));
        }
        if ((m = p.match(/^\/api\/needs\/(\d+)$/)) && req.method === 'DELETE') {
          const n = db.prepare('SELECT event FROM needs WHERE id=?').get(+m[1]);
          if (!n) throw new HttpError(404, '없는 자리입니다');
          needAdmin(db, n.event, key, owner);
          if (db.prepare('SELECT 1 FROM pledges WHERE need=? LIMIT 1').get(+m[1]))
            throw new HttpError(409, '맡겠다는 사람이 있는 자리는 지울 수 없습니다. 먼저 거절하세요');
          db.prepare('DELETE FROM needs WHERE id=?').run(+m[1]);
          return json(res, 200, { ok: true });
        }
        /* 앱 밖에서 구한 사람을 그 자리에 바로 올린다 — 운영자만. 이름·소속뿐, 연락처는 받지 않는다(운영자가 이미 안다).
           확인된 기여로 들어가 점판·공개 장부에 즉시 반영된다. */
        if ((m = p.match(/^\/api\/needs\/(\d+)\/outside$/)) && req.method === 'POST') {
          const n = db.prepare('SELECT event FROM needs WHERE id=?').get(+m[1]);
          if (!n) throw new HttpError(404, '없는 자리입니다');
          needAdmin(db, n.event, key, owner);
          const b = await body(req);
          /* 이미 찬 자리에 또 올리면 점판이 «3/2» 가 되고 «확인된 심사 자리 수»가 부풀어 넛지 계산이 오염된다 */
          const cur = needsOf(db, n.event).find(x => x.id === +m[1]);
          if (cur && cur.filled >= cur.qty) throw new HttpError(409, '이 자리는 이미 다 찼습니다. 자리 수를 늘리거나 다른 자리에 올리세요');
          const pl = addPledge(db, +m[1], n.event, { name: b.name, org: b.org, note: '앱 밖에서 구함' });
          return json(res, 201, setPledge(db, pl.id, { status: 'ok' }));
        }
        /* 심사위원 상태 셋 — 운영자가 답한다. '' 모름 · 'no' 아직 · 'yes:n' 구함 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/judged$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const v = String((await body(req)).judged || '');
          if (!(v === '' || v === 'no' || /^yes:\d{1,2}$/.test(v))) throw new HttpError(400, "judged 는 ''·'no'·'yes:n' 중 하나입니다");
          db.prepare('UPDATE events SET judged=? WHERE id=?').run(v, m[1]);
          return json(res, 200, { judged: v });
        }
        /* 지운 대회 되살리기 — 사본 JSON + 주최자 열쇠 */
        if (p === '/api/events/restore' && req.method === 'POST')
          return json(res, 201, restoreEvent(db, await body(req), owner));
        /* 팀 링크 다시 보내기 — 운영자만. 참가자가 기기를 바꿨을 때 운영자가 연락처로 확인하고 준다 */
        if ((m = p.match(/^\/api\/teams\/(\d+)\/relink$/)) && req.method === 'POST') {
          const t = db.prepare('SELECT id, event, tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          needAdmin(db, t.event, key, owner);
          return json(res, 200, { link: `/e/${t.event}?t=${t.tkey}` });
        }
        /* 팀 지우기 — 운영자(열쇠) 또는 그 팀(팀 열쇠). 휴지통으로 가고, 되살리면 같은 id 로 돌아온다. */
        if ((m = p.match(/^\/api\/teams\/(\d+)$/)) && req.method === 'DELETE') {
          const t = db.prepare('SELECT id, event, tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          const tk = String(req.headers['x-tkey'] || '');
          let by = 'team';
          if (!tk || tk !== t.tkey) { needAdmin(db, t.event, key, owner); by = 'admin'; }
          const trashed = trashTeam(db, t.id, by);
          promoteWaiting(db, t.event);
          return json(res, 200, { trash: trashed });
        }
        /* 팀 이름 고치기 — 운영자 또는 그 팀 */
        if ((m = p.match(/^\/api\/teams\/(\d+)$/)) && req.method === 'PATCH') {
          const b = await body(req);
          const t = db.prepare('SELECT id, event, tkey FROM teams WHERE id=?').get(+m[1]);
          if (!t) throw new HttpError(404, '없는 팀입니다');
          const tk = String(req.headers['x-tkey'] || b.tkey || '');
          if (!tk || tk !== t.tkey) needAdmin(db, t.event, key, owner);
          const name = String(b.name || '').trim().slice(0, 40);
          if (!name) throw new HttpError(400, '팀 이름을 넣어 주세요');
          try { db.prepare('UPDATE teams SET name=? WHERE id=?').run(name, t.id); }
          catch { throw new HttpError(409, '같은 이름의 팀이 있습니다'); }
          return json(res, 200, { name });
        }
        /* 휴지통 — 운영자가 본다 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/trash$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);
          return json(res, 200, db.prepare('SELECT id, team, name, at, by FROM team_trash WHERE event=? ORDER BY id DESC').all(m[1]));
        }
        /* 되살리기 — 운영자, 또는 그 팀 열쇠를 든 참가자 */
        if ((m = p.match(/^\/api\/trash\/(\d+)\/restore$/)) && req.method === 'POST') {
          const row = db.prepare('SELECT id, event, tkey FROM team_trash WHERE id=?').get(+m[1]);
          if (!row) throw new HttpError(404, '휴지통에 없습니다');
          const tk = String(req.headers['x-tkey'] || '');
          if (!tk || tk !== row.tkey) needAdmin(db, row.event, key, owner);
          return json(res, 200, untrashTeam(db, row.id));
        }
        /* 참가자가 «신청 취소»를 되돌린다. 팀 열쇠만 있으면 된다 — 휴지통 번호는 몰라도 된다. */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/trash\/mine$/)) && req.method === 'POST') {
          const tk = String(req.headers['x-tkey'] || (await body(req)).tkey || '');
          const row = tk ? db.prepare('SELECT id FROM team_trash WHERE event=? AND tkey=? ORDER BY id DESC').get(m[1], tk) : null;
          if (!row) throw new HttpError(404, '취소된 신청이 없습니다');
          return json(res, 200, untrashTeam(db, row.id));
        }
        /* 팀 링크로 들어온 브라우저가 «내 팀»을 되찾는다. 열쇠가 맞을 때만 팀 id 를 준다 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/claim$/)) && req.method === 'POST') {
          const tk = String((await body(req)).tkey || '');
          const t = tk ? db.prepare('SELECT id FROM teams WHERE event=? AND tkey=?').get(m[1], tk) : null;
          if (!t) throw new HttpError(403, '팀 열쇠가 맞지 않습니다');
          return json(res, 200, { id: t.id });
        }
        /* 받는 사람 열쇠 새로 — 링크가 흘렀을 때. 옛 열쇠로 새 열쇠를 받는다 */
        if ((m = p.match(/^\/api\/requests\/([a-z0-9]+)\/rekey$/)) && req.method === 'POST') {
          if (!canReceive(db, m[1], req.headers['x-rkey'] || '')) throw new HttpError(403, '받는 사람 열쇠가 필요합니다');
          const nk = crypto.randomBytes(5).toString('hex');
          db.prepare('UPDATE requests SET rkey=? WHERE id=?').run(nk, m[1]);
          return json(res, 200, { rkey: nk });
        }
        /* ── 받는 사람(후원자·의뢰자) ── */
        if ((m = p.match(/^\/api\/requests\/([a-z0-9]+)\/solutions$/)) && req.method === 'POST')
          return json(res, 201, addSolution(db, m[1], await body(req)));   // 문제 은행 — 대회 없이 «풀었습니다»
        if (p === '/api/news' && req.method === 'GET') return json(res, 200, { src: NEWS_SRC, jobs: JOBS, rows: newsList(db, 9, JOBS.includes(q.job) ? q.job : ''), loggedIn: !!cookieOwner });
        if (p === '/api/news/tip' && req.method === 'POST') {
          if (!cookieOwner) throw new HttpError(401, '제보는 카카오 로그인이 필요합니다');
          const o = db.prepare('SELECT name FROM owners WHERE id=?').get(cookieOwner);
          return json(res, 201, addTip(db, cookieOwner, (o && o.name) || '', await body(req)));
        }
        if (p === '/api/rank' && req.method === 'GET') return json(res, 200, { rows: rank(db) });
        if (p === '/api/requests' && req.method === 'POST')
          return json(res, 201, addRequest(db, await body(req)));          // 누구나 — 열쇠는 여기서 딱 한 번
        if (p === '/api/requests' && req.method === 'GET')
          return json(res, 200, openRequests(db));                         // 후보 목록. 연락처·열쇠 없음
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/requests$/)) && req.method === 'GET')
          return json(res, 200, requestsOf(db, m[1], isAdmin(db, m[1], key, owner)));
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/pick$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);                                 // 운영자가 후보를 이 대회 주제로 붙인다/뗀다
          const b = await body(req);
          const r = db.prepare('SELECT id, event FROM requests WHERE id=?').get(String(b.request || ''));
          if (!r) throw new HttpError(404, '없는 요청입니다');
          if (b.on === false) {
            if (r.event !== m[1]) throw new HttpError(403, '이 대회의 주제가 아닙니다');
            db.prepare("UPDATE requests SET event='' WHERE id=?").run(r.id);
            db.prepare("UPDATE teams SET request='' WHERE event=? AND request=?").run(m[1], r.id);
            return json(res, 200, { picked: false });
          }
          if (r.event && r.event !== m[1]) throw new HttpError(409, '이미 다른 대회에 붙은 요청입니다');
          if (db.prepare('SELECT COUNT(*) c FROM requests WHERE event=?').get(m[1]).c >= 5)
            throw new HttpError(409, '한 대회에 주제는 다섯 개까지입니다');   // 설계 §7 상한
          db.prepare('UPDATE requests SET event=? WHERE id=?').run(m[1], r.id);
          return json(res, 200, { picked: true });
        }
        if ((m = p.match(/^\/api\/requests\/([a-z0-9]+)\/view$/)) && req.method === 'GET') {
          if (!canReceive(db, m[1], req.headers['x-rkey'] || '')) throw new HttpError(403, '받는 사람 열쇠가 필요합니다');
          return json(res, 200, requestView(db, m[1]));
        }
        if ((m = p.match(/^\/api\/requests\/([a-z0-9]+)\/verdict$/)) && req.method === 'POST') {
          if (!canReceive(db, m[1], req.headers['x-rkey'] || '')) throw new HttpError(403, '받는 사람 열쇠가 필요합니다');
          return json(res, 200, setVerdict(db, m[1], await body(req)));
        }
        if ((m = p.match(/^\/api\/requests\/([a-z0-9]+)\/followup$/)) && req.method === 'POST') {
          if (!canReceive(db, m[1], req.headers['x-rkey'] || '')) throw new HttpError(403, '받는 사람 열쇠가 필요합니다');
          return json(res, 200, setFollowup(db, m[1], await body(req)));
        }
        /* 아이폰 앱 — 이 대회의 새 소식을 푸시로 받겠다. 토큰은 기기 것이고 사람 정보가 아니다 */
        if (p === '/api/push/register' && req.method === 'POST') {
          const b = await body(req);
          const token = String(b.token || '').replace(/[^0-9a-f]/gi, '').slice(0, 200), event = String(b.event || '');
          if (token.length < 32) throw new HttpError(400, '토큰 모양이 아닙니다');
          if (!db.prepare('SELECT 1 FROM events WHERE id=?').get(event)) throw new HttpError(404, '없는 대회입니다');
          db.prepare('INSERT OR IGNORE INTO push_tokens(token, event) VALUES(?,?)').run(token, event);
          return json(res, 200, { ok: true, sending: !!process.env.APNS_KEY });
        }
        if (p === '/api/push/register' && req.method === 'DELETE') {
          const b = await body(req);
          db.prepare('DELETE FROM push_tokens WHERE token=? AND event=?').run(String(b.token || ''), String(b.event || ''));
          return json(res, 200, { ok: true });
        }
        /* ── 앱 피드백 — 누구나 한 줄. 우리(운영)만 열쇠로 읽는다 ── */
        if (p === '/api/feedback' && req.method === 'POST') {
          const b = await body(req);
          const text = plain(b.text, 300);
          if (!text) throw new HttpError(400, '한 줄 적어 주세요');
          db.prepare('INSERT INTO feedback(page,text,contact) VALUES(?,?,?)').run(plain(b.page, 80), text, plain(b.contact, 100));
          return json(res, 201, { ok: true });
        }
        if (p === '/api/feedback' && req.method === 'GET') {
          const fk = process.env.FEEDBACK_KEY || '';
          if (!fk || q.k !== fk) throw new HttpError(403, '피드백 열쇠가 필요합니다');
          return json(res, 200, db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 200').all());
        }
        /* 심사·투표 열쇠 새로 만들기 — 링크가 흘렀을 때(레드팀: 대화방·공용 화면). 운영자만. 옛 링크는 그 자리에서 죽는다 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/rekey$/)) && req.method === 'POST') {
          needAdmin(db, m[1], key, owner);
          const which = (await body(req)).which;
          if (!['jkey', 'vkey'].includes(which)) throw new HttpError(400, 'which 는 jkey·vkey 중 하나입니다');
          const nk = crypto.randomBytes(5).toString('hex');
          db.prepare(`UPDATE events SET ${which}=? WHERE id=?`).run(nk, m[1]);
          return json(res, 200, { [which]: nk });
        }
        /* 지난 소식 — 공개. 최신이 위. 참가자 폰이 60초마다 이것만 다시 받는다 */
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/notices$/)) && req.method === 'GET')
          return json(res, 200, db.prepare('SELECT id, text, at FROM notices WHERE event=? ORDER BY id DESC LIMIT 30').all(m[1]));
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
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/offer$/)) && req.method === 'POST')
          return json(res, 201, addOffer(db, m[1], await body(req)));   // 공개 — 아무나 제안
        if ((m = p.match(/^\/api\/events\/([a-z0-9]+)\/offers$/)) && req.method === 'GET') {
          needAdmin(db, m[1], key, owner);                              // 운영자만 — 연락처 포함
          return json(res, 200, offersOf(db, m[1]));
        }
        if ((m = p.match(/^\/api\/offers\/(\d+)\/status$/)) && req.method === 'POST') {
          const o = db.prepare('SELECT event FROM offers WHERE id=?').get(+m[1]);
          if (!o) throw new HttpError(404, '없는 제안입니다');
          needAdmin(db, o.event, key, owner);
          return json(res, 200, setOffer(db, +m[1], await body(req)));
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

        if (p === '/api/showcase' && req.method === 'GET')
          return json(res, 200, showcase(db));
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
        const back = siteOf(req);
        const u = 'https://kauth.kakao.com/oauth/authorize'
          + `?client_id=${encodeURIComponent(KAKAO)}`
          + `&redirect_uri=${encodeURIComponent(back + '/auth/kakao/done')}`
          + '&response_type=code&scope=profile_nickname';
        res.writeHead(302, { location: u });
        return res.end();
      }
      if (p === '/auth/kakao/done' && KAKAO) {
        const back = siteOf(req);
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
        if (!tk.access_token) {
          /* 카카오가 준 코드(KOE010=비밀키 불일치, KOE303=redirect_uri 불일치, KOE320=코드 만료)를 같이 보여준다. 없으면 장님이다 */
          console.error('kakao token', back, tk.error_code || tk.error, tk.error_description || '');
          throw new HttpError(400, '카카오 로그인에 실패했습니다 (' + (tk.error_code || tk.error || '?') + ')');
        }
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
            + (back.startsWith('https') ? '; Secure' : ''),
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
      /* 개인정보 처리방침 — 앱스토어가 요구한다. 앱과 웹이 같은 것을 받는다 */
      if (p === '/privacy') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        return res.end(privacyPage());
      }
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
         /e /j /tv    공개·심사·현장 화면. 전부 같은 hack-on.html 이 주소를 보고 갈라진다
         /give        «줄 수 있는 것» 세 화면. 첫 화면 입구가 여기로 온다 (hack-on.html)
         /give/<id>   그 대회의 협찬 안내 한 장. 인스타 프로필에 거는 주소 (hack-on.html) */
      const pub = p.match(/^\/e\/[a-z0-9]+(\/report)?$/) || p.match(/^\/j\/[a-z0-9]+$/)
               || p.match(/^\/v\/[a-z0-9]+$/)
               || p.match(/^\/tv\/[a-z0-9]+$/) || p.match(/^\/p\/[0-9a-f]{12}$/)
               || p === '/app' || p === '/give' || p.match(/^\/give\/[a-z0-9]+$/)
               || p === '/ask' || p === '/problems' || p === '/rank' || p.match(/^\/r\/[a-z0-9]+$/)
               || p.match(/^\/s\/[po]\d+$/);   // 준 사람의 화면

      /* 화면 파일은 /e/<id> 같은 깊은 주소에서도 그대로 나간다. 그 안의 <script src="qr.js">
         는 /e/qr.js 를 찾게 되고 404 가 난다. 파일로 열었을 때(file://)도 살아야 하니
         화면 쪽은 상대 경로로 두고, 어느 깊이로 오든 여기서 뿌리로 되돌린다. */
      const rel = p.endsWith('/qr.js') ? '/qr.js' : p;

      /* #region reuse:static — 경로 탈출 방지 + MIME + 스트림. 그대로 복사해 쓴다 */
      const f = path.join(ROOT,
        p === '/' ? 'home.html' : p === '/news' ? 'news.html' : pub ? 'hack-on.html' : decodeURIComponent(rel));
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
  {
    /* 팀 휴지통 — 지우면 빠지고, 되살리면 같은 id·같은 열쇠로 돌아온다 */
    const tv = createEvent(db, { title: '휴지통 검사', host: 'ㅎ' });
    const ta = joinTeam(db, tv.id, { name: '지울팀', agree: true, email: 'trash@x.test' });
    joinTeam(db, tv.id, { name: '남을팀', agree: true, email: 'stay@x.test' });
    const tkeyA = db.prepare('SELECT tkey FROM teams WHERE id=?').get(ta).tkey;
    const before = board(db, tv.id, true).rows.length;
    const trId = trashTeam(db, ta, 'admin');
    ok(board(db, tv.id, true).rows.length === before - 1, '지우면 표에서 빠진다');
    ok(db.prepare('SELECT COUNT(*) c FROM team_trash WHERE event=?').get(tv.id).c === 1, '휴지통에 한 줄 남는다');
    const back = untrashTeam(db, trId);
    ok(back.same && back.id === ta, '되살리면 같은 id 로 돌아온다 — 팀 링크가 산다');
    /* 메일 — 열쇠가 없으면 보내지 않고 장부에만 남는다. 리마인더는 D-3·D-1 한 번씩, 답한 팀·못 온다는 팀은 건너뛴다 */
    const jm = joinMail(db, ta);
    ok(jm && jm.to === 'trash@x.test' && jm.text.includes(`/e/${tv.id}?t=${tkeyA}`), '신청 메일에 팀 링크가 들어간다');
    sendMail(db, jm);
    ok(db.prepare("SELECT status FROM mail_log WHERE kind='join' AND ref=?").get(String(ta)).status === 'skipped', 'RESEND_KEY 없으면 «건너뜀»으로만 남는다');
    const d3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.prepare('UPDATE events SET starts=?, ends=? WHERE id=?').run(d3, d3, tv.id);
    let due = remindDue(db);
    ok(due.filter(x => x.event === tv.id).length === 2 && due.every(x => x.kind === 'd3'), 'D-3 에 이메일 있는 두 팀 모두 리마인더 대상');
    db.prepare("UPDATE teams SET confirmed='no' WHERE name='남을팀' AND event=?").run(tv.id);
    logMail(db, due.find(x => x.ref === ta), 'sent');
    ok(remindDue(db).filter(x => x.event === tv.id).length === 0, '보낸 팀·못 온다는 팀은 다시 안 보낸다');
    logMail(db, { ...due[0], kind: 'd3' }, 'failed');
    const d1 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    db.prepare('UPDATE events SET starts=?, ends=? WHERE id=?').run(d1, d1, tv.id);
    ok(remindDue(db).filter(x => x.event === tv.id).map(x => x.kind).join() === 'd1', 'D-1 은 D-3 을 보냈어도 따로 한 번 더 간다');
    /* 대기자 — 정원이 차면 대기, «못 가요»·지움·정원 늘림에 앞에서부터 올라오고 메일이 간다 */
    const ew = createEvent(db, { title: '대기 검사', cap: 1 });
    const wa = joinTeam(db, ew.id, { name: '첫팀', agree: true, email: 'a@x.test' });
    const wb = joinTeam(db, ew.id, { name: '둘째', agree: true, email: 'b@x.test' });
    const wc = joinTeam(db, ew.id, { name: '셋째', agree: true, email: 'c@x.test' });
    ok(typeof wa === 'number' && wb.waiting === 1 && wc.waiting === 2, '정원이 차면 팀이 아니라 대기 n번째');
    ok(getEvent(db, ew.id).teams === 1 && getEvent(db, ew.id).waiting === 2, '대기자는 팀 수에 안 잡힌다');
    let dupW = 0; try { joinTeam(db, ew.id, { name: '둘째', agree: true, email: 'b@x.test' }); } catch (e) { dupW = e.code; }
    ok(dupW === 409, '같은 이름으로 대기 도배는 막는다');
    db.prepare("UPDATE teams SET confirmed='no' WHERE id=?").run(wa);
    let up = promoteWaiting(db, ew.id);
    ok(up.length === 1 && up[0].name === '둘째' && getEvent(db, ew.id).waiting === 1, '«못 가요»로 난 자리에 첫 대기자가 올라온다');
    ok(db.prepare("SELECT status FROM mail_log WHERE kind='promote' AND ref=?").get(String(up[0].id)).status === 'skipped', '승급 메일이 장부에 남는다(열쇠 없으면 건너뜀)');
    ok(promoteWaiting(db, ew.id).length === 0, '자리가 없으면 안 올린다');
    trashTeam(db, up[0].id, 'admin');
    up = promoteWaiting(db, ew.id);
    ok(up.length === 1 && up[0].name === '셋째' && getEvent(db, ew.id).waiting === 0, '팀을 지우면 다음 대기자가 올라온다');
    /* «끝났다» 메일 — 마감 전엔 안 가고, 마감 뒤 제출물이 있으면 한 번 간다 */
    const ed = createEvent(db, { title: '끝났다 검사', starts: '2026-01-10', ends: '2026-01-10' });
    const rqd = addRequest(db, { kind: 'requester', name: '총무 정', pain: '출석 세기', contact: 'jung@x.test', event: ed.id });
    db.prepare('UPDATE requests SET event=? WHERE id=?').run(ed.id, rqd.id);
    ok(!doneDue(db).some(x => x.ref === rqd.id), '제출물이 없으면 «끝났다»가 안 간다');
    const tdn = joinTeam(db, ed.id, { name: '만든팀', agree: true, email: 'm@x.test' });
    db.prepare("INSERT INTO submissions(team,url) VALUES(?,?)").run(tdn, 'https://example.com/x');
    const dd = doneDue(db).find(x => x.ref === rqd.id);
    ok(dd && dd.text.includes(`/r/${rqd.id}?k=${rqd.rkey}`), '마감 뒤 제출물이 있으면 받는 화면 링크가 간다');
    logMail(db, dd, 'sent');
    ok(!doneDue(db).some(x => x.ref === rqd.id), '한 번 보낸 의뢰엔 다시 안 간다');
    /* 크레딧 종류 */
    ok(NEED_KINDS.includes('credit') && OFFER_KIND_LABEL.credit === '크레딧', '자리 종류에 크레딧이 있다');
    /* 결과물 «넘길 수 있어요» — 마감 뒤 받는 화면에만 보인다. 만든 것 링크 — 주소 꼴만 남는다 */
    {
      const es = createEvent(db, { title: '판매 검사', starts: '2026-01-10', ends: '2026-01-10', topic: '동아리 회비' });
      const rqs = addRequest(db, { kind: 'requester', name: '총무 한', pain: '회비', contact: 'h@x.test', event: es.id });
      db.prepare('UPDATE requests SET event=? WHERE id=?').run(es.id, rqs.id);
      const ts = joinTeam(db, es.id, { name: '파는팀', agree: true, email: 's@x.test' });
      db.prepare('UPDATE teams SET request=? WHERE id=?').run(rqs.id, ts);
      db.prepare('UPDATE events SET due=? WHERE id=?').run('2099-01-01T00:00', es.id);
      submit(db, ts, { url: 'https://example.com/s', sale: '무료로 드려요 <b>' });
      ok(requestView(db, rqs.id).teams[0].sale === '', '마감 전엔 «넘길 수 있어요»가 안 보인다');
      db.prepare('UPDATE events SET due=? WHERE id=?').run('2026-01-10T00:00', es.id);
      ok(requestView(db, rqs.id).teams[0].sale === '무료로 드려요 b', '마감 뒤 받는 화면에 제안이 보이고 꺾쇠는 빠진다');
      db.prepare('UPDATE events SET due=? WHERE id=?').run('2099-01-01T00:00', es.id);   /* 마감을 다시 열고 고쳐 낸다 */
      submit(db, ts, { url: 'https://example.com/s2' });
      ok(db.prepare('SELECT sale FROM submissions WHERE team=?').get(ts).sale === '무료로 드려요 b', 'sale 을 안 보내면 그대로 둔다');
      moreTeam(db, ts, { link: 'javascript:alert(1)' }, { admin: true });
      ok(db.prepare('SELECT link FROM teams WHERE id=?').get(ts).link === '', '주소 꼴이 아닌 링크는 버린다');
      moreTeam(db, ts, { link: 'https://github.com/x/y', solo: true }, { admin: true });
      ok(crew(db, es.id).solo[0].link === 'https://github.com/x/y', '팀 짜기 목록에 만든 것 링크가 실린다');
      ok(getEvent(db, es.id).topic === '동아리 회비', '열 때 준 주제가 저장된다');
      ok(ghLogin('https://github.com/karpathy/nanoGPT') === 'karpathy' && ghLogin('https://github.com/torvalds') === 'torvalds' && ghLogin('https://gitlab.com/x') === '' && ghLogin('javascript:1') === '', '깃허브 링크에서 아이디만 뽑는다');
      const nd = addNeed(db, es.id, { kind: 'judge', label: '심사', qty: 1 });
      const pc = addPledge(db, nd.id, es.id, { name: '심사 김', contact: 'j@x.test', coi: true });
      ok(needsOf(db, es.id).find(n => n.id === nd.id).pledges[0].coi === true, '심사 맡는 분의 이해관계 확인이 남는다');
      db.prepare("INSERT INTO sponsors(event,name,kind,amount,note,logo,link) VALUES(?,?,?,?,?,?,?)").run(es.id, '파일로고', '현물', 0, '', '', 'https://example.com');
      const sid = db.prepare('SELECT id FROM sponsors WHERE name=?').get('파일로고').id;
      db.prepare('INSERT INTO sponsor_logos(sponsor,mime,data) VALUES(?,?,?)').run(sid, 'image/png', Buffer.from([137, 80, 78, 71]));
      ok(db.prepare('SELECT length(data) n FROM sponsor_logos WHERE sponsor=?').get(sid).n === 4, '올린 로고 파일이 그대로 남는다');
    }
    ok(board(db, tv.id, true).rows.length === before, '되살리면 표 수가 돌아온다');
    ok(db.prepare('SELECT tkey FROM teams WHERE id=?').get(ta).tkey === tkeyA, '팀 열쇠도 그대로다');
    let dup = false; try { db.prepare('UPDATE teams SET name=? WHERE id=?').run('남을팀', ta); } catch { dup = true; }
    ok(dup, '이름 고치기가 같은 이름과 부딪히면 막힌다');
  }
  {
    /* 줄 세우기 — 깊은 신호가 가벼운 신호를 이긴다. 숫자를 박지 말고 점수끼리 비교한다. */
    const mk = (o) => Object.assign({ host: 'ㄱ', teams: 0, filled: 0, sponsors: [],
                                      openNeeds: 0, ageDays: 1, dueDays: 30 }, o);
    const 구경만 = mk({ teams: 12 });
    const 맡은사람 = mk({ teams: 1, filled: 2 });
    ok(rankScore(맡은사람) > rankScore(구경만), '확인된 기여가 참가팀 수를 이긴다');
    ok(rankScore(mk({ teams: 1, openNeeds: 3 })) > rankScore(mk({ teams: 1 })),
       '아직 도울 자리가 남은 대회를 위로 올린다');
    ok(rankScore(mk({ teams: 3, dueDays: 2 })) > rankScore(mk({ teams: 3, dueDays: 20 })),
       '마감이 가까우면 위로 온다');
    ok(rankScore(mk({ teams: 3, ageDays: 40 })) < rankScore(mk({ teams: 3, ageDays: 1 })),
       '오래된 대회는 내려간다');
    ok(rankScore(mk({ teams: 30, dueDays: -1 })) < rankScore(mk({ teams: 0, dueDays: 5 })),
       '끝난 대회는 사람이 많아도 맨 아래다');
    const spread = spreadHosts([mk({ host: 'ㄱ' }), mk({ host: 'ㄱ' }), mk({ host: 'ㄴ' })]);
    ok(spread[0].host === 'ㄱ' && spread[1].host === 'ㄴ' && spread[2].host === 'ㄱ',
       '같은 주최자 대회가 연달아 오지 않는다');
    ok(spreadHosts([mk({ host: 'ㄱ' }), mk({ host: 'ㄱ' })]).length === 2,
       '전부 같은 주최자여도 빠뜨리지 않는다');
  }
  {
    const saved = SITES.slice();
    SITES.length = 0; SITES.push('https://hackon.kr', 'https://hackon.mandeun.com');
    const at = (h) => siteOf({ headers: { host: h } });
    ok(at('hackon.kr') === 'https://hackon.kr', '들어온 주소로 되돌린다');
    ok(at('hackon.mandeun.com') === 'https://hackon.mandeun.com', '다른 주소도 제 주소로 되돌린다');
    ok(at('HACKON.KR') === 'https://hackon.kr', '대소문자가 달라도 같은 주소다');
    ok(at('evil.example') !== 'https://evil.example', '목록에 없는 host 는 따라가지 않는다');
    ok(wwwTo('www.hackon.kr') === 'https://hackon.kr', 'www 는 대표 주소로 301');
    ok(wwwTo('WWW.HACKON.KR') === 'https://hackon.kr', 'www 대문자도 뗀다');
    ok(wwwTo('hackon.kr') === '' && wwwTo('') === '', 'www 아니면 안 건드린다');
    ok(wwwTo('www.evil.example') === '', '목록에 없는 www 는 안 보낸다 — 열린 리다이렉트 방지');
    ok(robots().includes('Sitemap: https://hackon.kr/sitemap.xml'), 'robots 가 대표 주소의 sitemap 을 가리킨다');
    ok(robots().includes('Disallow: /api/') && robots().includes('Disallow: /j/'), 'API 와 심사 링크는 색인 제외');
    {
      const sm = sitemap(db);
      ok(sm.includes('<loc>https://hackon.kr/</loc>') && sm.includes('<loc>https://hackon.kr/manual</loc>'), 'sitemap 에 첫 화면과 매뉴얼');
      ok(!sm.includes(evR.id), '목록에 안 올린 대회는 sitemap 에 없다');
      db.prepare('UPDATE events SET listed=1 WHERE id=?').run(evR.id);
      ok(sitemap(db).includes('/e/' + evR.id), '목록에 올린 대회는 sitemap 에 실린다');
      db.prepare("UPDATE events SET ends='2020-01-01' WHERE id=?").run(evR.id);
      ok(!sitemap(db).includes(evR.id), '끝난 대회는 sitemap 에서 빠진다');
      db.prepare('UPDATE events SET listed=0, ends=? WHERE id=?').run(db.prepare('SELECT starts FROM events WHERE id=?').get(evR.id).starts, evR.id);
    }
    SITES.length = 0; SITES.push(...saved);
  }
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

  // 쇼케이스 - 만든 사람이 동의해야만 첫 화면에 실린다
  const scEv = createEvent(db, { title: '쇼케이스시험', starts: today(), ends: today() });
  editEvent(db, scEv.id, { due: '2099-01-01T00:00' });
  db.prepare('UPDATE events SET listed=1 WHERE id=?').run(scEv.id);
  const scT = joinTeam(db, scEv.id, { name: '동의안한팀', agree: true });
  submit(db, scT, { url: 'https://shown.test/a', note: '만든 것' });
  db.prepare('UPDATE teams SET featured=1 WHERE id=?').run(scT);
  ok(showcase(db).every(w => w.url !== 'https://shown.test/a'),
     '마감 전에는 동의와 상관없이 쇼케이스에 안 실린다');
  /* 여기서 마감을 먼저 지나게 한다. 그래야 다음 줄이 «마감 전이라» 가 아니라
     «동의가 없어서» 안 실린다는 것을 증명한다. 문 하나씩만 잠가 놓고 본다. */
  submit(db, scT, { url: 'https://shown.test/a', note: '만든 것' });
  editEvent(db, scEv.id, { due: '2000-01-01T00:00' });
  ok(showcase(db).every(w => w.url !== 'https://shown.test/a'),
     '마감이 지나고 운영자가 별표해도, 본인 동의가 없으면 쇼케이스에 안 실린다');
  showConsent(db, scT, true);
  const shown = showcase(db).find(w => w.url === 'https://shown.test/a');
  ok(!!shown, '본인이 동의하면 그때 실린다');
  ok(shown.name === '동의안한팀' && shown.note === '만든 것', '이름과 설명이 같이 간다');
  const at1 = db.prepare('SELECT show_at FROM submissions WHERE team=?').get(scT).show_at;
  ok(at1 !== '', '동의한 시각이 남는다 - 증거는 그것뿐이다');
  let late = false;
  try { submit(db, scT, { url: 'https://shown.test/a', show: false }); } catch { late = true; }
  ok(late, '마감이 지나면 제출 길로는 아무것도 못 바꾼다');
  showConsent(db, scT, true);
  ok(db.prepare('SELECT show_at FROM submissions WHERE team=?').get(scT).show_at === at1,
     '이미 켜져 있으면 처음 동의한 시각은 안 바뀐다');
  showConsent(db, scT, false);
  ok(showcase(db).every(w => w.url !== 'https://shown.test/a'),
     '마감이 지난 뒤에도 동의를 끄면 바로 내려간다');
  ok(db.prepare('SELECT show_at FROM submissions WHERE team=?').get(scT).show_at === '',
     '동의를 끄면 시각도 지운다');
  showConsent(db, scT, true);
  db.prepare("UPDATE submissions SET url='' WHERE team=?").run(scT);
  ok(showcase(db).every(w => w.event !== scEv.id), '링크가 비면 동의해도 안 싣는다');
  /* 첫 화면은 이 주소를 <iframe src> 와 <a href> 에 그대로 넣는다.
     javascript: 하나가 들어오면 우리 첫 화면에서 그게 돈다. 저장할 때와 내보낼 때 둘 다 막는다.
     (GLM 적대 검토 2026-09-21 이 짚었고, 직접 재현해 확인한 뒤 막았다) */
  db.prepare("UPDATE submissions SET url=? WHERE team=?").run('javascript:alert(1)', scT);
  ok(showcase(db).every(w => w.event !== scEv.id),
     'DB 에 javascript: 주소가 들어가 있어도 쇼케이스로는 안 나간다');
  db.prepare("UPDATE submissions SET url=? WHERE team=?").run('data:text/html,<script>x</script>', scT);
  ok(showcase(db).every(w => w.event !== scEv.id), 'data: 주소도 안 나간다');
  const scEv2 = createEvent(db, { title: '주소정화시험', starts: today(), ends: today() });
  editEvent(db, scEv2.id, { due: '2099-01-01T00:00' });
  const scT2 = joinTeam(db, scEv2.id, { name: '정화시험팀', agree: true });
  submit(db, scT2, { url: 'javascript:alert(1)' });
  ok(db.prepare('SELECT url FROM submissions WHERE team=?').get(scT2).url === '',
     '제출할 때부터 javascript: 주소는 안 저장된다');
  submit(db, scT2, { url: '  https://ok.test/a  ' });
  ok(db.prepare('SELECT url FROM submissions WHERE team=?').get(scT2).url === 'https://ok.test/a',
     '멀쩡한 주소는 앞뒤 공백만 떼고 그대로 들어간다');
  db.prepare('DELETE FROM events WHERE id=?').run(scEv2.id);
  db.prepare('DELETE FROM events WHERE id=?').run(scEv.id);

  // 예산 배분 - 금액 하나로 자리 카드를 깐다
  ok(tierOf(0) === 'zero' && tierOf(1) === 'small' && tierOf(300000) === 'small'
     && tierOf(300001) === 'mid' && tierOf(1000000) === 'mid' && tierOf(1000001) === 'big',
     '구간 경계가 0 / 30만 / 100만 이다');
  for (const B of [0, 1, 999, 50000, 300000, 300001, 500000, 1000000, 1000001, 5000000, 123456789]) {
    const a = allocate(B, 20);
    const used = a.rows.reduce((s, r) => s + r.amount * r.qty, 0);
    ok(used <= B && a.left === B - used, `배분 합이 예산을 안 넘는다 (${B})`);
    ok(a.rows.every(r => r.amount % BUDGET_RULE.unit === 0), `금액이 원 단위 ${BUDGET_RULE.unit} 로 내림된다 (${B})`);
    ok(a.rows.every(r => r.amount >= 0 && r.qty >= 1), `음수·0수량 줄이 없다 (${B})`);
  }
  ok(allocate(0, 20).rows.length === 0 && allocate(0, 20).mode === 'online', '0원이면 카드가 없고 온라인판이다');
  ok(allocate(50000, 20).rows.some(r => r.kind === 'venue' && r.amount === 0), '소액이면 장소는 0원 «무료로 내줄 곳» 카드다');
  ok(allocate(500000, 20).rows.find(r => r.kind === 'judge').qty === 3, '보통 구간 심사위원은 3명(PLAN §12-1)');
  ok(allocate(50000, 20).rows.find(r => r.kind === 'snack').amount <= 20 * BUDGET_RULE.snackPer, '간식은 1인 단가 상한을 안 넘는다');

  // 이름만 주면 전과 똑같다 - 자리 없음·현장·관객평가 꺼짐
  const bEv0 = createEvent(db, { title: '이름만', starts: today(), ends: today() });
  const r0 = db.prepare('SELECT budget, mode, vmode FROM events WHERE id=?').get(bEv0.id);
  ok(r0.budget === 0 && r0.mode === 'onsite' && r0.vmode === 0 && needsOf(db, bEv0.id).length === 0 && bEv0.alloc === null,
     '예산을 안 주면 자리도 안 깔리고 현장 대회 그대로다 (옛 대회 이관과 같은 상태)');
  // 0원을 «주면» 온라인판
  const bEvZ = createEvent(db, { title: '영원', starts: today(), ends: today(), budget: 0 });
  const rZ = db.prepare('SELECT mode, vmode FROM events WHERE id=?').get(bEvZ.id);
  ok(rZ.mode === 'online' && rZ.vmode === 1 && needsOf(db, bEvZ.id).length === 0, '0원을 주면 온라인판 + 관객 평가 켜짐');

  /* ── 2026-09-23 대회 지우기·밖에서 구함·상호평가·소식 ── */
  const dEv = createEvent(db, { title: '지우기검사' });
  ok(emptyEvent(eventLoad(db, dEv.id)), '이름만 넣은 대회는 빈 대회다');
  const dNeed = addNeed(db, dEv.id, { kind: 'judge', label: '심사위원' });
  ok(!emptyEvent(eventLoad(db, dEv.id)), '자리만 올려도 빈 대회가 아니다 (팀·제출만 보면 놓친다)');
  let dThrew = 0; try { deleteEvent(db, dEv.id, {}); } catch (e) { dThrew = e.code; }
  ok(dThrew === 409 && db.prepare('SELECT 1 FROM events WHERE id=?').get(dEv.id), 'confirm 없이는 안 지워진다 (409)');
  const dOut = setPledge(db, addPledge(db, dNeed.id, dEv.id, { name: '밖에서온심사', org: '동네', note: '앱 밖에서 구함' }).id, { status: 'ok' });
  ok(dOut.status === 'ok' && needsOf(db, dEv.id)[0].filled === 1 && ledgerOf(db, dEv.id)[0].name === '밖에서온심사',
     '밖에서 구한 사람은 확인된 기여로 점판·장부에 바로 오른다');
  const dRes = deleteEvent(db, dEv.id, { confirm: '지우기검사' });
  ok(dRes.ok && dRes.dump && dRes.dump.event.id === dEv.id && !db.prepare('SELECT 1 FROM events WHERE id=?').get(dEv.id),
     '제목을 맞게 보내면 지워지고 응답에 사본이 실린다');
  ok(!('okey' in dRes.dump.event), '응답 사본에도 운영자 열쇠는 없다');
  /* 상호평가 — 팀 열쇠로만, 자기 팀 제외 */
  const prEv = createEvent(db, { title: '상호평가검사' });
  const prA = joinTeam(db, prEv.id, { name: '피가', email: 'pa@x.test', agree: true });
  const prB = joinTeam(db, prEv.id, { name: '피나', email: 'pb@x.test', agree: true });
  const prTkA = db.prepare('SELECT tkey FROM teams WHERE id=?').get(prA).tkey;
  db.prepare('UPDATE events SET vmode=1, vpeer=1 WHERE id=?').run(prEv.id);
  ok(!canVote(db, prEv.id, '', '', db.prepare('SELECT vkey FROM events WHERE id=?').get(prEv.id).vkey, ''), '상호평가에선 투표 열쇠로 못 찍는다');
  ok(canVote(db, prEv.id, '', '', '', prTkA) && peerTeam(db, prEv.id, prTkA).id === prA, '이 대회 팀 열쇠면 찍을 수 있다');
  ok(!canVote(db, prEv.id, '', '', '', 'no-such-key'), '엉뚱한 팀 열쇠는 못 찍는다');
  ok(peerTeam(db, prEv.id, db.prepare('SELECT tkey FROM teams WHERE id=?').get(prB).tkey).id === prB, '팀 열쇠 → 팀');
  /* 오픈톡 주소는 http(s) 만 */
  editEvent(db, prEv.id, { chat: 'javascript:alert(1)' });
  ok(getEvent(db, prEv.id).chat === '', 'javascript: 대화방 주소는 저장되지 않는다');
  editEvent(db, prEv.id, { chat: 'https://open.kakao.com/o/abc' });
  ok(getEvent(db, prEv.id).chat === 'https://open.kakao.com/o/abc', 'https 대화방 주소는 공개 응답에 실린다');
  ok(!('judged' in getEvent(db, prEv.id)), '심사위원 상태는 손님 응답에 없다');
  db.prepare("UPDATE events SET notice='옛 공지', notice_at='2026-09-20T01:02:03.000Z' WHERE id=?").run(prEv.id);
  db.prepare('DELETE FROM notices WHERE event=?').run(prEv.id);
  for (const r of db.prepare("SELECT id, notice, notice_at FROM events WHERE notice<>'' AND id NOT IN (SELECT event FROM notices)").all())
    db.prepare('INSERT INTO notices(event, text, at) VALUES(?,?,?)').run(r.id, r.notice, r.notice_at.replace('T', ' ').slice(0, 19));
  const bf = db.prepare('SELECT text, at FROM notices WHERE event=?').all(prEv.id);
  ok(bf.length === 1 && bf[0].text === '옛 공지' && bf[0].at === '2026-09-20 01:02:03', '옛 한 줄 공지는 소식 목록으로 옮겨진다(시각 보존)');

  let dEv0;
  /* ── 받는 사람(후원자·의뢰자) ── */
  const rqEv = createEvent(db, { title: '받는사람검사' });
  const rq = addRequest(db, { kind: 'requester', name: '총무 김', pain: '회비 낸 사람 세기가 번거로워요', now: '수첩에 적어요', done: '이름 누르면 냈다로 바뀌면', contact: 'kim@x.test' });
  ok(rq.id.length === 8 && rq.rkey.length === 10, '요청을 올리면 공개 id 와 열쇠가 나온다');
  ok(openRequests(db).some(r => r.id === rq.id) && !JSON.stringify(openRequests(db)).includes('kim@x.test') && !JSON.stringify(openRequests(db)).includes(rq.rkey),
     '후보 목록엔 연락처·열쇠가 없다');
  {
    /* «이 문제로 내 대회 열기» — 열린 의뢰만 붙고, 붙은 뒤엔 후보 목록에서 빠진다 */
    const rq2 = addRequest(db, { kind: 'requester', name: '회장 박', pain: '동아리 출석 세기', contact: 'park@x.test' });
    ok(openRequests(db).some(r => r.id === rq2.id), '올린 의뢰는 후보 목록에 있다');
    const evQ = createEvent(db, { title: '의뢰로 연 대회' });
    db.prepare('UPDATE requests SET event=? WHERE id=? AND event=\'\'').run(evQ.id, rq2.id);
    ok(!openRequests(db).some(r => r.id === rq2.id) && requestsOf(db, evQ.id).some(r => r.id === rq2.id), '대회에 붙으면 후보에서 빠지고 그 대회 주제가 된다');
  }
  let rqThrew = 0; try { addRequest(db, { kind: 'sponsor', name: '', topic: 'x' }); } catch (e) { rqThrew = e.code; }
  ok(rqThrew === 400, '이름 없는 요청은 400');
  db.prepare('UPDATE requests SET event=? WHERE id=?').run(rqEv.id, rq.id);
  ok(requestsOf(db, rqEv.id)[0].id === rq.id && requestsOf(db, rqEv.id)[0].contact === undefined && requestsOf(db, rqEv.id, true)[0].contact === 'kim@x.test',
     '대회 요청 목록 — 손님엔 연락처 없음, 운영자엔 있음');
  const rqT = joinTeam(db, rqEv.id, { name: '만든팀', email: 'maker@x.test', agree: true, share: true });
  db.prepare("UPDATE events SET due='2099-01-01T00:00' WHERE id=?").run(rqEv.id);
  submit(db, rqT, { url: 'https://made.example/app', note: '회비 체크', request: rq.id });
  ok(db.prepare('SELECT request FROM teams WHERE id=?').get(rqT).request === rq.id, '제출 때 고른 주제가 팀에 남는다');
  let rqBad = 0; try { submit(db, rqT, { url: 'https://made.example/app', request: 'zzzzzzzz' }); } catch (e) { rqBad = e.code; }
  ok(rqBad === 400, '이 대회 주제가 아니면 400');
  ok(!canReceive(db, rq.id, '') && !canReceive(db, rq.id, 'nope') && canReceive(db, rq.id, rq.rkey), '받는 화면은 열쇠로만');
  const rqV1 = requestView(db, rq.id);
  ok(rqV1.teams.length === 1 && rqV1.teams[0].url === '' && rqV1.teams[0].contact === '', '마감 전엔 주소·연락처가 안 나간다');
  let vdThrew = 0; try { setVerdict(db, rq.id, { team: rqT, ok: 1 }); } catch (e) { vdThrew = e.code; }
  ok(vdThrew === 409, '마감 전 판정은 409');
  db.prepare("UPDATE events SET due='2000-01-01T00:00' WHERE id=?").run(rqEv.id);
  const rqV2 = requestView(db, rq.id);
  ok(rqV2.teams[0].url === 'https://made.example/app' && rqV2.teams[0].contact === 'maker@x.test', '마감 뒤엔 주소와 동의한 제작자 연락이 나간다');
  db.prepare('UPDATE teams SET sponsor_ok=0 WHERE id=?').run(rqT);
  ok(requestView(db, rq.id).teams[0].contact === '', '동의 안 한 제작자 연락은 마감 뒤에도 안 나간다');
  setVerdict(db, rq.id, { team: rqT, ok: 1, note: '이거면 됩니다' });
  setVerdict(db, rq.id, { team: rqT, ok: 0, note: '아직' });
  const vds = db.prepare('SELECT * FROM verdicts WHERE request=?').all(rq.id);
  ok(vds.length === 1 && vds[0].ok === 0 && vds[0].note === '아직', '한 요청에 한 팀 한 판정, 덮어쓴다');
  ok(setFollowup(db, rq.id, { status: 'broken' }).followup === 'broken', 'D+14 네 단추 — 열리지가 않아요 도 있다');
  let fuBad = 0; try { setFollowup(db, rq.id, { status: 'maybe' }); } catch (e) { fuBad = e.code; }
  ok(fuBad === 400, '없는 D+14 답은 400');
  ok(!('rkey' in publicRequest(db.prepare('SELECT * FROM requests WHERE id=?').get(rq.id))), '공개 요청에 열쇠 없음');
  ok(TIERS['현물'] && TIERS['현물'].length >= 2, '현물 후원 등급이 있다');
  /* 되살리기 — 사본으로 왕복. 팀·자리 id 는 새로 받되 수는 같다 */
  const rsEv = createEvent(db, { title: '되살리기검사' });
  const rsOwner = db.prepare('SELECT owner FROM events WHERE id=?').get(rsEv.id).owner;
  const rsT = joinTeam(db, rsEv.id, { name: '살팀', email: 'rs@x.test', agree: true });
  db.prepare("UPDATE events SET due='2099-01-01T00:00' WHERE id=?").run(rsEv.id);
  submit(db, rsT, { url: 'https://rs.example/app', note: '살아남기' });
  const rsN = addNeed(db, rsEv.id, { kind: 'venue', label: '장소' });
  setPledge(db, addPledge(db, rsN.id, rsEv.id, { name: '장소주인', contact: 'v@x.test' }).id, { status: 'ok' });
  db.prepare('INSERT INTO notices(event, text) VALUES(?,?)').run(rsEv.id, '살아라');
  const rsDump = dump(db, rsEv.id);
  ok(rsDump.needs.length === 1 && rsDump.pledges.length === 1 && rsDump.notices.length === 1, '사본에 자리·신청·소식이 들어간다');
  deleteEvent(db, rsEv.id, { confirm: '되살리기검사' });
  let rsBad = 0; try { restoreEvent(db, rsDump, 'wrong-owner'); } catch (e) { rsBad = e.code; }
  ok(rsBad === 403 && !db.prepare('SELECT 1 FROM events WHERE id=?').get(rsEv.id), '남의 주최자 열쇠로는 못 살린다');
  const rsRes = restoreEvent(db, rsDump, rsOwner);
  ok(rsRes.id === rsEv.id && rsRes.okey.length === 10 && rsRes.teams === 1, '주최자 열쇠로 살리면 새 운영자 열쇠가 나온다');
  const rsB = board(db, rsEv.id, true);
  ok(rsB.rows.length === 1 && rsB.rows[0].url === 'https://rs.example/app' && needsOf(db, rsEv.id)[0].filled === 1
     && db.prepare('SELECT COUNT(*) c FROM notices WHERE event=?').get(rsEv.id).c === 1, '팀·제출·자리·신청·소식이 돌아온다');
  let rsDup = 0; try { restoreEvent(db, rsDump, rsOwner); } catch (e) { rsDup = e.code; }
  ok(rsDup === 409, '살아 있는 대회 위에 또 못 살린다');
  ok(privacyPage().includes('개인정보 처리방침') && privacyPage().includes('6개월') && !privacyPage().includes('undefined'), '개인정보 처리방침 페이지가 있다');
  const dl = ledgerOf(db, dEv0 = createEvent(db, { title: '장부표시' }).id);
  ok(dl.length === 0, '빈 장부');
  const dN = addNeed(db, dEv0, { kind: 'snack', label: '간식' });
  setPledge(db, addPledge(db, dN.id, dEv0, { name: '직접', note: '앱 밖에서 구함' }).id, { status: 'ok' });
  setPledge(db, addPledge(db, dN.id, dEv0, { name: '신청', contact: 'a@x.test' }).id, { status: 'ok' });
  const dl2 = ledgerOf(db, dEv0);
  ok(dl2.find(x => x.name === '직접').direct === 1 && dl2.find(x => x.name === '신청').direct === 0, '운영자가 직접 올린 줄은 장부에 표시된다');
  // 예산을 주면 카드가 깔린다
  const bEv = createEvent(db, { title: '오십만', starts: today(), ends: today(), budget: 500000, cap: 20 });
  const bn1 = needsOf(db, bEv.id);
  ok(bn1.length === 4 && bn1.every(n => n.auto) && bn1.reduce((s, n) => s + n.amount * n.qty, 0) <= 500000,
     '50만원이면 자리 4장이 산식으로 깔리고 합이 예산 이하다');
  ok(bEv.alloc && bEv.alloc.tier === 'mid' && bEv.alloc.made === 4, '만든 결과에 배분 요약이 실린다');
  // 손으로 올린 자리는 다시 나누기가 안 건드린다
  const manual = addNeed(db, bEv.id, { kind: 'mentor', label: '손으로 올린 멘토', qty: 2 });
  // 손고침(held)·맡은 사람 있는 줄도 안 건드린다
  const venue = bn1.find(n => n.kind === 'venue'), snack = bn1.find(n => n.kind === 'snack');
  db.prepare('UPDATE needs SET amount=77000, held=1 WHERE id=?').run(venue.id);
  addPledge(db, snack.id, bEv.id, { name: '간식 내주는 카페', contact: 'x@x.test' });
  editEvent(db, bEv.id, { budget: 900000 });
  const re = reallocate(db, bEv.id);
  const bn2 = needsOf(db, bEv.id);
  /* id 로 찾지 않는다 - SQLite 는 AUTOINCREMENT 가 없으면 지워진 마지막 rowid 를 다음 INSERT 가 다시 쓴다.
     손 자리가 지워지고 새 산식 줄이 그 번호를 받으면 «id 가 있다»가 참이 되어 검사가 속는다. 라벨과 auto=0 으로 본다. */
  ok(bn2.some(n => n.label === '손으로 올린 멘토' && !n.auto && n.qty === 2), '손으로 올린 자리는 다시 나누기에도 남는다');
  const v2 = bn2.find(n => n.id === venue.id && n.kind === 'venue' && n.held);
  ok(!!v2 && v2.amount === 77000, '손고침(held) 줄은 다시 나누기가 덮지 않는다');
  ok(bn2.some(n => n.id === snack.id), '누가 맡은 줄은 다시 나누기가 지우지 않는다');
  ok(re.kept === 2 && bn2.filter(n => n.auto).length === 4 + 2, '지운 건 손 안 댄 산식 줄뿐이고 새 카드가 다시 깔린다');
  ok(typeof re.total === 'number' && re.over === (re.total > 900000), '판 전체 합과 예산 초과 여부를 같이 돌려준다');
  const bEvM = createEvent(db, { title: '손장소', starts: today(), ends: today() });
  addNeed(db, bEvM.id, { kind: 'venue', label: '손으로 올린 장소', qty: 1 });
  editEvent(db, bEvM.id, { budget: 500000 });
  const reM = reallocate(db, bEvM.id);
  const bnM = needsOf(db, bEvM.id);
  ok(reM.skipped.includes('venue') && bnM.filter(n => n.kind === 'venue').length === 1,
     '손으로 올린 자리와 같은 종류는 산식이 안 깐다 - 장소 카드가 둘이 되지 않는다');
  ok(reM.made === 3 && bnM.length === 4, '나머지 종류만 깔린다');
  db.prepare('DELETE FROM events WHERE id=?').run(bEvM.id);
  ok(allocate(500000, 20).rows.find(r => r.kind === 'judge').amount === 0, '보통 구간 심사는 0원(무보수 표준)이 기본값이다');
  ok(!JSON.stringify(bn2).includes('x@x.test'), '자리 목록에 연락처가 안 실린다');
  db.prepare('DELETE FROM events WHERE id IN (?,?,?)').run(bEv0.id, bEvZ.id, bEv.id);

  // 큰 화면 - 벽에 걸리는 것
  const tvEv = createEvent(db, { title: '큰화면시험', starts: today(), ends: today() });
  editEvent(db, tvEv.id, { due: '2099-01-01T00:00', wifi: 'hackon / 1234' });
  const tvT = joinTeam(db, tvEv.id, { name: '아직안낸팀', agree: true });
  const tv1 = tv(db, tvEv.id);
  {
    /* 발표 순서 — 마감 전엔 비고, 마감 뒤엔 낸 팀만 자리 순서로 */
    const eo = createEvent(db, { title: '발표 순서', starts: '2026-01-10', ends: '2026-01-10' });
    const o1 = joinTeam(db, eo.id, { name: '낸팀', agree: true, email: 'o1@x.test' });
    joinTeam(db, eo.id, { name: '안낸팀', agree: true, email: 'o2@x.test' });
    db.prepare('INSERT INTO submissions(team,url) VALUES(?,?)').run(o1, 'https://example.com/o');
    const od = tv(db, eo.id).order;
    ok(od.length === 1 && od[0].name === '낸팀', '큰 화면 발표 순서는 낸 팀만, 자리 순서로');
    const eo2 = createEvent(db, { title: '발표 전' });
    ok(tv(db, eo2.id).order.length === 0, '마감 전엔 발표 순서가 비어 있다');
  }
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
  ok(Array.isArray(pk.all) && pk.all.length >= pk.top.length
     && pk.all.every(r => !('contact' in r) && !('email' in r)),
     '후원자 열람은 상위 셋 밖 전체 제출물까지 — 연락처는 여기에도 없다');
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

  db.prepare("UPDATE teams SET confirmed=? WHERE id=?").run('no', t1);
  ok(board(db, ev, true).rows.find(r => r.id === t1).confirmed === 'no', '«못 가요» 가 주최자 표에 실린다');
  db.prepare("UPDATE teams SET confirmed=? WHERE id=?").run(new Date().toISOString(), t1);
  ok(board(db, ev, true).rows.find(r => r.id === t1).confirmed.length > 4, '«올 거예요» 가 주최자 표에 실린다');
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
  /* «줄 수 있는 것» 칩의 «돈» 은 cash 종류다. 제안으로 들어와 확인되면 장부에 «돈 · …» 으로 남는다 */
  ok(addNeed(db, nbEv.id, { kind: 'cash', label: '상금에 보탤 돈' }).kind === 'cash', '돈(cash) 종류가 있다');
  ok(OFFER_KIND_LABEL.cash === '돈' && NEED_KINDS.includes('cash'), '제안 종류에도 돈이 있다');
  addNeed(db, nbEv.id, { kind: 'snack', label: '<script>alert(1)</script>간식',
                         note: '<img src=x onerror=alert(1)>' });
  ok(!JSON.stringify(needsOf(db, nbEv.id)).includes('<'), '라벨·메모의 꺾쇠는 저장 전에 뺀다');

  /* ── 협찬 희망가(price) — 자리에 값을 매겨 파는 판 ──
     amount(쓰려는 돈)와 헷갈리면 안 된다. amount 는 «우리가 얼마 쓴다», price 는 «맡으려면 얼마».
     사람이 손으로 넣는 숫자라, 화면을 거치지 않고 API 를 직접 때려도 안 깨져야 한다. */
  {
    const 값 = 자리 => needsOf(db, nbEv.id).find(x => x.id === 자리.id).price;
    ok(값(n1) === 0, '새 자리의 협찬 희망가는 0 — 금액 미정으로 시작한다');
    const 값매김 = addNeed(db, nbEv.id, { kind: 'venue', label: '값 붙은 장소', price: 100000 });
    ok(값매김.price === 100000 && 값(값매김) === 100000, '희망가를 매기면 공개 응답에 그대로 실린다');
    ok(값(addNeed(db, nbEv.id, { label: '음수', price: -5000 })) === 0, '음수 희망가는 0 으로 잡는다');
    ok(값(addNeed(db, nbEv.id, { label: '글자', price: '십만원' })) === 0
       && 값(addNeed(db, nbEv.id, { label: '빈값', price: '' })) === 0
       && 값(addNeed(db, nbEv.id, { label: '없음' })) === 0, '글자·빈값·없음은 0 으로 잡는다');
    ok(값(addNeed(db, nbEv.id, { label: '엄청큰수', price: 1e30 })) === MAX_WON
       && money(Infinity) === MAX_WON && money('1e999') === MAX_WON,
       '엄청 큰 수와 무한대는 상한에서 멈춘다');
    ok(값(addNeed(db, nbEv.id, { label: '소수점', price: 1234.9 })) === 1234,
       '소수점은 내림해서 정수로 저장한다');
    /* 두 칸이 서로를 안 건드린다는 것을 실제로 확인한다 — 하나를 고치면 다른 하나가 따라 움직이면
       예산 합(amount*qty ≤ budget)이 희망가 때문에 깨진다. */
    ok(needsOf(db, nbEv.id).find(x => x.id === 값매김.id).amount === 0, '희망가를 매겨도 계획 지출은 0 그대로다');
    db.prepare('UPDATE needs SET amount=50000 WHERE id=?').run(값매김.id);
    ok(값(값매김) === 100000, '계획 지출을 고쳐도 희망가는 안 변한다');
    const 합 = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM needs WHERE event=?').get(nbEv.id).s;
    ok(합 > 0 && !JSON.stringify(needsOf(db, nbEv.id)).includes('contact'),
       '희망가가 붙어도 공개 응답에는 연락처가 없다');
  }

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
  ok(Object.keys(led[0]).sort().join() === 'at,direct,kind,label,name,org,status', '장부 칸이 약속과 같다');
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

  /* ── 2026-09-24 퍼실리테이션 자료 반영 — 서술자·자리 번호·순위 보정·설문·질문·후원 열쇠·달력·CSV ── */
  {
    const fx = createEvent(db, { title: '자료반영', starts: today(), ends: today() });
    ok(getEvent(db, fx.id).rubric.every(r => r.hint && r.hint.low && r.hint.high), '기본 기준표에 낮음·높음 서술자가 붙는다');
    const tA = joinTeam(db, fx.id, { name: 'A', agree: true }), tB = joinTeam(db, fx.id, { name: 'B', agree: true }), tC = joinTeam(db, fx.id, { name: 'C', agree: true });
    const nos = board(db, fx.id, true).rows.map(r => r.no);
    ok(nos.join() === '1,2,3', '자리 번호는 신청 순 1·2·3');
    db.prepare('DELETE FROM teams WHERE id=?').run(tB);
    ok(board(db, fx.id, true).rows.map(r => r.no).join() === '1,3', '팀이 빠져도 뒤 자리 번호가 안 당겨진다');
    const tD = joinTeam(db, fx.id, { name: 'D', agree: true });
    ok(board(db, fx.id, true).rows.find(r => r.id === tD).no === 4, '새 팀은 비운 번호가 아니라 다음 번호를 받는다');
    /* 순위 보정 — 짠 둘은 A>C>D, 후한 하나는 D 에만 100. 점수 평균은 D 가 이기고, 등수 보정은 A 가 이긴다 */
    const sc = (t, j, v) => score(db, t, { judge: j, values: { idea: v, make: v, use: v, tell: v } });
    sc(tA, '짠1', 62); sc(tC, '짠1', 61); sc(tD, '짠1', 60);
    sc(tA, '짠2', 62); sc(tC, '짠2', 61); sc(tD, '짠2', 60);
    sc(tA, '후한', 60); sc(tC, '후한', 61); sc(tD, '후한', 100);
    let bd = board(db, fx.id, true);
    ok(bd.rows[0].id === tD, '점수 평균으로는 후한 심사위원이 민 D 가 1위');
    db.prepare('UPDATE events SET ranked=1 WHERE id=?').run(fx.id);
    bd = board(db, fx.id, true);
    ok(bd.rows[0].id === tA && bd.rows[0].rscore > bd.rows.find(r => r.id === tD).rscore, '등수 보정을 켜면 셋 중 둘이 1위로 본 A 가 1위');
    ok(getEvent(db, fx.id).ranked === 1, 'ranked 칸이 있다');
    /* 두 팀만 본 심사위원은 보정에서 빠진다 */
    const fy = createEvent(db, { title: '보정표본', starts: today(), ends: today() });
    const y1 = joinTeam(db, fy.id, { name: 'y1', agree: true }), y2 = joinTeam(db, fy.id, { name: 'y2', agree: true }), y3 = joinTeam(db, fy.id, { name: 'y3', agree: true });
    score(db, y1, { judge: '둘만', values: { idea: 90, make: 90, use: 90, tell: 90 } });
    score(db, y2, { judge: '둘만', values: { idea: 10, make: 10, use: 10, tell: 10 } });
    ok(board(db, fy.id, true).rows.every(r => r.rscore === 0), '두 팀만 본 심사위원의 등수는 보정에 안 들어간다');
    score(db, y3, { judge: '둘만', values: { idea: 50, make: 50, use: 50, tell: 50 } });
    ok(board(db, fy.id, true).rows.find(r => r.id === y1).rscore === 100, '세 팀을 보면 들어간다');
    /* 동점은 평균 등수 */
    score(db, y2, { judge: '둘만', values: { idea: 90, make: 90, use: 90, tell: 90 } });
    ok(board(db, fy.id, true).rows.find(r => r.id === y1).rscore === board(db, fy.id, true).rows.find(r => r.id === y2).rscore, '같은 점수는 같은 등수 점수');
    /* 설문 — 마감 전 409, 팀당 하나, 셋 미만이면 숫자 없음, 서술은 운영자만 */
    const tk = t => db.prepare('SELECT tkey FROM teams WHERE id=?').get(t).tkey;
    let code = 0; try { addSurvey(db, fx.id, { recommend: 9 }, { headers: { 'x-tkey': tk(tA) } }); } catch (e) { code = e.code; }
    ok(code === 409, '마감 전엔 설문을 못 받는다');
    editEvent(db, fx.id, { due: '2020-01-01T00:00' });
    addSurvey(db, fx.id, { recommend: 9, good: '좋', fix: '총무 갑질' }, { headers: { 'x-tkey': tk(tA) } });
    addSurvey(db, fx.id, { recommend: 7 }, { headers: { 'x-tkey': tk(tA) } });
    ok(surveySummary(db, fx.id).n === 1, '같은 팀이 두 번 답해도 하나로 센다');
    addSurvey(db, fx.id, { recommend: 8 }, { headers: { 'x-tkey': tk(tC) } });
    ok(surveySummary(db, fx.id).recommend === null, '두 팀이면 숫자를 안 낸다(모름≠0)');
    addSurvey(db, fx.id, { recommend: 6, fix: '고칠 것' }, { headers: { 'x-tkey': tk(tD) } });
    ok(surveySummary(db, fx.id).recommend === 7 && surveySummary(db, fx.id).fix.length === 0, '세 팀이면 평균이 나오고 서술은 공개에 안 실린다');
    ok(surveySummary(db, fx.id, true).fix.includes('고칠 것'), '서술 원문은 운영자만');
    code = 0; try { addSurvey(db, fx.id, { recommend: 11 }, { headers: { 'x-tkey': tk(tA) } }); } catch (e) { code = e.code; }
    ok(code === 400, '11점은 안 받는다');
    /* 질문 — 팀 열쇠, 열린 것 셋 상한, 답은 소식에 30자 미리보기, 본인 닫기 */
    const qe = createEvent(db, { title: '질문', starts: '2099-01-01', ends: '2099-01-01' });
    const qt = joinTeam(db, qe.id, { name: '묻는팀', agree: true });
    code = 0; try { askQuestion(db, qe.id, { text: '?' }, { headers: {} }); } catch (e) { code = e.code; }
    ok(code === 403, '팀 열쇠 없이 못 묻는다');
    const q1 = askQuestion(db, qe.id, { text: '지금 몇 시에 시작하나요 길게 씁니다 연락처는 010-0000-0000 입니다' }, { headers: { 'x-tkey': tk(qt) } });   // 번호는 30자 뒤에
    askQuestion(db, qe.id, { text: '둘' }, { headers: { 'x-tkey': tk(qt) } });
    const q3 = askQuestion(db, qe.id, { text: '셋' }, { headers: { 'x-tkey': tk(qt) } });
    code = 0; try { askQuestion(db, qe.id, { text: '넷' }, { headers: { 'x-tkey': tk(qt) } }); } catch (e) { code = e.code; }
    ok(code === 409, '답 없는 질문이 셋이면 더 못 묻는다');
    closeOwnQuestion(db, q3.id, tk(qt));
    ok(askQuestion(db, qe.id, { text: '넷' }, { headers: { 'x-tkey': tk(qt) } }).id > 0, '자기 질문을 닫으면 다시 물을 수 있다');
    code = 0; try { closeOwnQuestion(db, q1.id, 'nope'); } catch (e) { code = e.code; }
    ok(code === 403, '남의 열쇠로는 못 닫는다');
    answerQuestion(db, q1.id, { answer: '열 시' });
    const nt = db.prepare('SELECT text FROM notices WHERE event=? ORDER BY id DESC').get(qe.id).text;
    ok(nt.startsWith('답변 · ') && !nt.includes('0000-0000') && nt.endsWith('열 시'), '소식에는 질문 앞 30자만 실린다');
    code = 0; try { closeOwnQuestion(db, q1.id, tk(qt)); } catch (e) { code = e.code; }
    ok(code === 409, '답이 달린 질문은 못 닫는다');
    /* 후원 열쇠 — 응답에 한 번, 틀린 열쇠 403, 화면에 연락처 없음, 마감 전엔 결과물 없음 */
    const nd = addNeed(db, qe.id, { kind: 'cash', label: '상금', qty: 1 });
    const pl = addPledge(db, nd.id, qe.id, { name: '포도가게', contact: '010-9' });
    ok(/^p\d+$/.test(pl.ref) && /^[0-9a-f]{10}$/.test(pl.pkey), '후원하면 ref 와 열쇠를 받는다');
    code = 0; try { giveView(db, pl.ref, 'x'); } catch (e) { code = e.code; }
    ok(code === 403, '틀린 열쇠로는 후원 화면이 안 열린다');
    const gv = giveView(db, pl.ref, pl.pkey);
    ok(gv.gift.status === 'pending' && !JSON.stringify(gv).includes('010-9') && gv.top.length === 0, '후원 화면에 연락처가 없고 마감 전엔 결과물이 없다');
    ok(Array.isArray(gv.all) && gv.all.length === 0, '마감 전엔 전체 제출물도 비어 있다');
    const of = addOffer(db, qe.id, { kind: 'snack', name: '커피집', contact: 'c@x.y' });
    setOffer(db, of.id, { status: 'ok' });
    ok(giveView(db, of.ref, of.pkey).gift.status === 'ok', '제안이 확인되면 같은 열쇠로 확정 상태가 보인다');
    /* 달력·CSV */
    const ics = icsOf(getEvent(db, qe.id), 'https://x.test');
    ok(ics.includes('DTSTART;VALUE=DATE:20990101') && ics.includes('DTEND;VALUE=DATE:20990102') && !ics.includes('+09:00'), '종일 일정은 날짜만 — 시간대 없음');
    ok(csvOf(db, fx.id).split('\n')[0].includes('연락처') && !csvOf(db, fx.id, false).includes('연락처'), '«연락 빼고» CSV 에는 연락처 열이 없다');
  }
  {
    /* 유입 — 화면만 센다. 그림·스크립트까지 세면 숫자가 의미를 잃는다 */
    ok(visitPath('/e/ab12') === '/e/' && visitPath('/') === '/' && visitPath('/logo.svg') === '',
       '유입은 화면만 세고 /e/ 는 한 줄로 뭉친다');
    ok(visitRef('https://www.naver.com/search?q=해커톤', 'hackon.kr') === 'naver.com'
       && visitRef('https://hackon.kr/app', 'hackon.kr') === '내부'
       && visitRef('', 'hackon.kr') === '직접',
       '보낸 곳은 도메인만 남고, 우리 사이트 안에서 온 것은 내부');
    countVisit(db, '/', 'https://naver.com/', 'hackon.kr');
    countVisit(db, '/', 'https://naver.com/', 'hackon.kr');
    countVisit(db, '/logo.svg', '', 'hackon.kr');     // 안 세야 한다
    const vs = visitsOf(db, 7);
    ok(vs.length === 1 && vs[0].n === 2 && vs[0].path === '/' && vs[0].ref === 'naver.com',
       '같은 날 같은 곳에서 온 것은 한 줄에 쌓인다');
    ok(!JSON.stringify(vs).includes('q='), '유입 기록에 주소 뒤에 붙은 것이 안 남는다');
    ok(visitsOf(db, 999).length === 1 && visitsOf(db, -5).length === 1, '며칠치인지는 1~90 로 막는다');

  }
  /* 티어 — 완주가 바탕. 앉아만 있으면 새싹, 완주 하나면 브론즈, 수상이 있어야 실버가 빨라진다 */
  ok(rankOf(0, 0, 0, 0).name === '새싹' && rankOf(1, 0, 0, 0).name === '브론즈', '티어 새싹·브론즈');
  ok(rankOf(1, 1, 0, 0).name === '실버' && rankOf(3, 0, 0, 0).name === '실버', '티어 실버 두 길');
  ok(rankOf(5, 1, 3, 5).name === '실버' && rankOf(5, 1, 3.6, 5).name === '골드' && rankOf(5, 1, 0, 0).name === '골드', '티어 골드는 동료 실력 3.5 (평가 3건 미만이면 안 봄)');
  ok(rankOf(10, 3, 4.2, 3).name === '플래티넘' && rankOf(10, 3, 4.2, 2).name === '골드', '티어 플래티넘은 평가 3건 이상');
  /* 문제 은행 — 대회 없이 풀이를 남기고, 낸 사람만 연락처를 본다 */
  {
    const rq = addRequest(db, { kind: 'requester', name: '문구점 박', pain: '재고 세기', contact: 'p@x.test' });
    const sol = addSolution(db, rq.id, { name: '풀이 김', url: 'https://k.example/inv', note: '엑셀 대신', contact: 'k@x.test' });
    ok(sol.id > 0 && openRequests(db).find(r => r.id === rq.id).solutions === 1, '풀이가 열린 문제에 세어진다');
    ok(requestView(db, rq.id).solutions[0].contact === 'k@x.test', '받는 화면엔 풀이 연락처가 있다');
    let bad = false; try { addSolution(db, rq.id, { name: '', url: 'https://x' }); } catch { bad = true; } ok(bad, '이름 없는 풀이는 거절');
    bad = false; try { addSolution(db, rq.id, { name: 'x', url: 'javascript:alert(1)' }); } catch { bad = true; } ok(bad, 'https 아닌 풀이 주소는 거절');
    ok(!JSON.stringify(openRequests(db)).includes('k@x.test'), '공개 목록엔 풀이 연락처가 없다');
  }
  ok(newsMd(db).startsWith('# 해커온뉴스'), '뉴스 마크다운 머리');
  ok(parseFeed('<feed><entry><title>A</title><link rel="alternate" href="https://a.example/1"/></entry></feed>', 5)[0].url === 'https://a.example/1'
     && parseFeed('<rss><item><title><![CDATA[B]]></title><link>https://b.example/2</link></item></rss>', 5)[0].title === 'B', 'RSS 와 Atom 둘 다 읽는다');
  ok(jobOf('인스타 릴스 광고 카피를 AI 로') === '마케팅' && jobOf('Figma 에 이미지 생성 붙이기') === '디자인' && jobOf('가게 예약 문자 자동화') === '소상공인' && jobOf('오늘 날씨') === '', '직무 자동 분류');
  {
    const tip = addTip(db, 'own1', '제보 김', { job: '마케팅', title: '카피 초안 도구', url: 'https://t.example/1' });
    ok(tip.job === '마케팅' && newsList(db, 9, '마케팅').some(r => r.src === 'tip' && r.by === '제보 김'), '제보가 직무 태그로 실린다');
    let dup = false; try { addTip(db, 'own1', '제보 김', { title: 'x', url: 'https://t.example/1' }); } catch { dup = true; } ok(dup, '같은 주소 제보는 거절');
    const m1 = mcpCall(db, { jsonrpc: '2.0', id: 1, method: 'tools/list' }); ok(m1.result.tools.length === 4, 'MCP 도구 넷');
    const m2 = mcpCall(db, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_problems' } }); ok(/문구점 박/.test(m2.result.content[0].text), 'MCP 문제 은행');
    const m3 = mcpCall(db, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'post_problem', arguments: { name: 'MCP 가게', pain: '장부', contact: 'm@x.test' } } }); ok(/\/r\/[a-z0-9]+\?k=/.test(m3.result.content[0].text), 'MCP 로 문제 올리기 → 받는 링크');
    ok(mcpCall(db, { jsonrpc: '2.0', id: 4, method: 'nope' }).error.code === -32601 && mcpCall(db, { method: 'notifications/initialized' }) === null, 'MCP 오류·알림');
    const xp = xpOf(db, pidOf(db, 'm@x.test')); ok(xp.items.some(x => x.key === 'asked') && xp.total >= 3, '문제 올린 사람에게 기여가 쌓인다');
  }
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
  /* 해커온뉴스 — 켜지고 15초 뒤 한 번, 그 뒤 6시간마다. 밖이 죽어도 앱은 산다. */
  setTimeout(() => newsTick(db).catch(() => {}), 15000).unref();
  setInterval(() => newsTick(db).catch(() => {}), 3 * 60 * 60 * 1000).unref();
  /* 한 시간마다 D-3·D-1 리마인더. 발송 열쇠가 없으면 아예 안 돈다 — 장부에 «건너뜀»이 매시간 쌓이지 않게. */
  if (RESEND_KEY) {
    const mailTick = () => { try { for (const mm of [...remindDue(db), ...doneDue(db)]) void sendMail(db, mm); } catch (e) { console.error('리마인더 실패', e.message); } };
    mailTick();
    setInterval(mailTick, 60 * 60 * 1000).unref();
  }

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
module.exports = { open, createEvent, editEvent, moreTeam, joinTeam, submit, showConsent, score, board, outcomes, allocate, tierOf, reallocate, BUDGET_RULE,
                   card, support, assign, spread, judgeView, lanIPs, findHelp, webUrl, pack, safeCount, TIERS, draftPlan, planWarn, follow, closed, KINDS, RUBRICS, logoFor, pidOf, profile, hostRep, seats, setSeats, shrink, LEVELS, pickVenues, parseCap, noticeOf, tv, crew, mine, record,
                   dump, backup, isAdmin,
                   visitPath, visitRef, countVisit, visitsOf,
                   addNeed, addPledge, setPledge, needsOf, ledgerOf, addFollowup, followSummary,
                   pledgesOf, needsSummary };
