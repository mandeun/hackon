/* HACK:ON 공통 메뉴 — 모든 화면이 같은 메뉴·같은 머리줄·같은 «글자 크게» 를 쓴다(10/05).
   <head> 에서 동기로 부른다: <script src="/menu.js"></script>  (깊은 주소 /e/<id> 에서도 되게 절대 경로)
   1) 글자 크게 — html.big 을 그리기 전에 붙인다(깜빡임 없게). 값은 이 기기에만(hackon.big).
   2) 메뉴 판 — #menu-sheet 를 만들어 [data-menu-open] 단추에 건다. 묶음 셋 × 넷(타일) + 이름 붙은 줄 넷(찾아보기·함께하기·안내·언어).
      «그 밖에» 같은 이름 없는 덩어리는 두지 않는다 — 모든 고리가 어느 묶음인지 이름이 있다.
   3) [data-hk-top] 자리가 있으면 공통 머리줄(로고 · 나 · 메뉴)을 그린다. 소식·공구함·클럽·브랜드 화면이 쓴다.
   서버로 보내는 것: 메뉴를 처음 열 때 «있을 때만 여는 고리» 넷과 로그인 상태를 묻는 GET 뿐. */
(function () {
  var D = document.documentElement;
  try { if (localStorage.getItem('hackon.big') === '1') D.classList.add('big'); } catch (e) {}

  var CSS = [
    /* 글자 크게 — px 로 쓴 글꼴이 많아 rem 대신 zoom 하나로 글자와 누를 자리를 같이 키운다. 1.125 는 390px 폰에서 머리줄·아래 탭이 한 줄에 드는 값.
       행사장 큰 화면(body.tv)은 vh 로 그려서 뺀다. 보조 글자색은 7:1 로 진하게 */
    'html.big body:not(.tv){zoom:1.125}',
    'html.big{--mute:#4A5160;--ink3:#4A5160;--grey:#4A5160}',
    '#menu-sheet{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;font-family:inherit}',
    '#menu-sheet[hidden]{display:none}',
    '#menu-sheet .bd{position:absolute;inset:0;background:rgba(11,16,32,.45);backdrop-filter:blur(2px)}',
    '#menu-sheet .pn{position:relative;width:100%;max-height:88vh;overflow:auto;background:#fff;color:#0B1020;border-radius:24px 24px 0 0;padding:10px 16px calc(18px + env(safe-area-inset-bottom));animation:hkup .18s ease-out;text-align:left}',
    '@keyframes hkup{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}',
    '@media (prefers-reduced-motion:reduce){#menu-sheet .pn{animation:none}}',
    '#menu-sheet .grip{width:40px;height:4px;border-radius:4px;background:#DDE1E6;margin:2px auto 10px}',
    '#menu-sheet .mh{display:flex;align-items:center;gap:8px;margin:0 2px 6px}',
    '#menu-sheet .mh b{font-size:18px;letter-spacing:-.02em;margin-right:auto}',
    '#menu-sheet .mh button{min-width:44px;height:44px;border-radius:12px;border:0;background:#F2F4F6;font:inherit;font-size:15px;font-weight:800;color:#0B1020;cursor:pointer;padding:0 12px}',
    '#menu-sheet .mh button[aria-pressed=true]{background:#0B1020;color:#C8F53B}',
    '#menu-sheet .mg{display:block;font-size:13px;font-weight:800;color:#4A5160;letter-spacing:.02em;margin:16px 4px 8px}',
    '#menu-sheet .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '#menu-sheet .tiles a{display:flex;gap:10px;align-items:center;min-height:60px;padding:10px 12px;border-radius:16px;background:#F2F4F6;text-decoration:none;color:#0B1020}',
    '#menu-sheet .tiles a:hover,#menu-sheet .tiles a:focus-visible{background:#F1FBD5;outline:none}',
    '#menu-sheet .tiles .ic{flex:none;width:36px;height:36px;border-radius:12px;background:#0B1020;display:grid;place-items:center;font-size:18px}',
    '#menu-sheet .tiles b{display:block;font-size:15px;line-height:1.25}',
    '#menu-sheet .tiles small{display:block;font-size:13px;color:#4A5160;font-weight:500;line-height:1.3}',
    '#menu-sheet .mrow{display:flex;gap:6px 8px;flex-wrap:wrap;align-items:center;padding:10px 2px 0;margin-top:10px;border-top:1px solid #EAECEF}',
    '#menu-sheet .mrow .mr2{flex:0 0 100%;font-size:13px;font-weight:800;color:#4A5160}',
    '#menu-sheet .mrow a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;background:#F7F8FA;border:1px solid #EAECEF;font-size:14px;font-weight:700;color:#0B1020;text-decoration:none}',
    '#menu-sheet .mrow a:hover,#menu-sheet .mrow a:focus-visible{background:#F1FBD5;outline:none}',
    '#menu-sheet .mrow a[aria-current=true]{background:#0B1020;color:#fff;border-color:#0B1020}',
    '#menu-sheet .meCard{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;background:#0B1020;color:#fff;text-decoration:none;margin:4px 0 2px}',
    '#menu-sheet .meCard b{display:block;font-size:15px}',
    '#menu-sheet .meCard small{display:block;font-size:13px;color:#C9CFDA;line-height:1.35}',
    '#menu-sheet .meCard em{margin-left:auto;font-style:normal;font-size:20px;color:#C8F53B}',
    '#menu-sheet .meCard .lv{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:99px;background:#C8F53B;color:#0B1020;font-size:12px}',
    '#menu-sheet .meCard .mbar{display:block;height:5px;border-radius:99px;background:rgba(255,255,255,.15);overflow:hidden;margin-top:5px;width:160px;max-width:100%}',
    '#menu-sheet .meCard .mbar i{display:block;height:100%;background:#C8F53B}',
    '#menu-sheet #menu-admin{display:flex;align-items:center;justify-content:space-between;min-height:48px;margin-top:8px;padding:0 14px;border-radius:14px;background:#FFF6DD;color:#8A5A00;font-weight:800;text-decoration:none}',
    '#menu-recent{display:flex;align-items:center;gap:8px;margin:10px 2px 0;overflow-x:auto}',
    '#menu-recent .mr{flex:none;font-size:13px;font-weight:800;color:#4A5160}',
    '#menu-recent .recent{display:flex;gap:6px}',
    '#menu-recent .recent a{flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700;min-height:40px;display:inline-flex;align-items:center;padding:0 12px;border-radius:99px;background:#F2F4F6;color:#0B1020;text-decoration:none}',
    '@media (min-width:720px){#menu-sheet{align-items:flex-start;justify-content:flex-end;padding:64px 24px 0}#menu-sheet .bd{background:rgba(11,16,32,.18)}',
    '  #menu-sheet .pn{width:640px;max-width:calc(100vw - 48px);border-radius:22px;max-height:84vh;box-shadow:0 24px 60px rgba(11,16,32,.25)}#menu-sheet .grip{display:none}',
    '  #menu-sheet .tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    /* 공통 머리줄 — 로고(워드마크 하나) · 나 · 메뉴. 페이지 바탕이 어두우면 .dark */
    '.hk-top{position:sticky;top:0;z-index:20;background:rgba(238,241,244,.9);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px)}',
    '.hk-top.dark{background:rgba(11,16,32,.88);color:#fff}',
    '.hk-top .hk-in{max-width:960px;margin:0 auto;padding:6px 16px;display:flex;align-items:center;gap:8px;min-height:60px}',
    '.hk-top .hk-logo{display:inline-flex;align-items:center;min-height:44px;color:inherit;margin-right:auto}',
    '.hk-top .hk-logo svg{height:22px;width:auto;display:block}',
    '.hk-top .hk-me,.hk-btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:999px;border:1px solid rgba(11,16,32,.12);background:#fff;color:#0B1020;font:inherit;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer;white-space:nowrap}',
    '.hk-top.dark .hk-me,.hk-top.dark .hk-btn{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.2)}',
    /* 힉스필드 노랑이 스티커 — 제목 옆에 띄운다. 그림이 안 와도 자리만 비고 글은 그대로 */
    '.hk-art{float:right;width:96px;height:96px;object-fit:contain;margin:-4px -2px 4px 10px}',
    '@media (max-width:360px){.hk-art{width:72px;height:72px}}',
    '.hk-btn i{display:grid;gap:3px}.hk-btn i b{display:block;width:14px;height:2px;border-radius:2px;background:currentColor}',
  ].join('\n');
  var st = document.createElement('style'); st.id = 'hk-menu-css'; st.textContent = CSS;
  (document.head || D).appendChild(st);

  var LOGO = '<svg viewBox="0 0 300 64" role="img" aria-label="HACK:ON"><g fill="currentColor" font-family="Pretendard,\'Apple SD Gothic Neo\',\'Segoe UI\',sans-serif" font-size="44" font-weight="800" letter-spacing="-1.2"><text x="0" y="47">HACK</text><text x="158" y="47">ON</text></g><circle cx="143" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3" opacity=".45"/><circle cx="143" cy="41" r="7" fill="#C8F53B"/></svg>';
  /* 타일 — [주소, 아이콘, 이름, 한 줄]. 묶음 셋 × 넷. 이름과 한 줄은 명사로 짧게(4050 이 읽는 말) */
  var GROUPS = [
    ['매일', [['/cal', '📅', '오늘', '일정·아침 브리핑'], ['/news', '📰', '소식', 'AI 소식 3분'], ['/wallet', '👛', 'AI 지갑', '구독료 정리'], ['/tools', '🔑', '삽 공구함', '바이브코딩 공구']]],
    ['대회', [['/app?make=1', '⚡', '대회 열기', '이름 하나면'], ['/problems', '🙋', '풀어 줘요', '동네 문제 은행'], ['/made', '🛠️', '만든 것', '구경·별 주기'], ['/cert', '📜', '실무 기록', '내 이력']]],
    ['같이', [['/board', '💬', '게시판', '주제별 수다'], ['/write', '✍️', '공동 집필', '같이 쓰는 책'], ['/club', '🔌', 'ON 클럽', '모임·굿즈'], ['/recruit', '📣', '모집·외주', '팀·일감']]],
  ];
  /* 이름 붙은 줄 — [주소, 이름, id(있으면), 있을 때만 여는 API(있으면)] */
  var ROWS = [
    ['찾아보기', [['/setups', '세팅 모음'], ['/around', '모아 보기'], ['/gigs', '외주 일감'], ['/ref', '추천 코드'],
      ['/learn', '강의', 'nav-learn', 'lectures'], ['/market', '마켓', 'nav-market', 'market'], ['/rank', '순위', 'nav-rank', 'rank'], ['/conditions', '그날의 조건', 'nav-conds', 'conditions']]],
    ['함께하기', [['/card', '줄 수 있는 것'], ['/partner', '협찬'], ['/biz', '기업·기관'], ['/crew', '크루'], ['/launch', '시작 혜택'], ['/thanks', '기여자']]],
    ['안내', [['/manual', '운영 매뉴얼', 'nav-manual'], ['/terms', '이용 규칙'], ['/privacy', '개인정보'], ['/delete-account', '계정 삭제'], ['/brand', '브랜드']]],
    ['언어 · Language', [['/', '한국어'], ['/en', 'English'], ['/zh', '中文']]],
  ];
  var RECENT_OK = /^\/(cal|news|tools|wallet|board|write|club|card|recruit|made|cert|setups|problems|gigs|around|me|learn|market|rank|e\/[a-z0-9]+|board\/\d+|w\/[0-9a-f]{8})$/;
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function sheetHtml() {
    return '<div class="bd" data-menu-close></div><div class="pn">' +
      '<div class="grip" aria-hidden="true"></div>' +
      '<div class="mh"><b>메뉴</b><button type="button" data-big aria-pressed="false" title="글자 크게">가+ 글자 크게</button><button type="button" data-menu-close aria-label="닫기">✕</button></div>' +
      '<a href="/me" id="menu-me" class="meCard"><img src="/norangi-on.svg" alt="" width="40" height="40"><span><b id="menu-me-lv">나</b><small id="menu-me-next">배지·레벨·다음 목표 보기</small></span><em aria-hidden="true">›</em></a>' +
      '<a href="/admin" id="menu-admin" hidden>사이트 운영 <span aria-hidden="true">›</span></a>' +
      '<div id="menu-recent" hidden><span class="mr">최근</span><nav class="recent" aria-label="최근 간 곳"></nav></div>' +
      GROUPS.map(function (g) {
        return '<b class="mg">' + g[0] + '</b><nav class="tiles" aria-label="' + g[0] + '">' + g[1].map(function (t, i) {
          return '<a href="' + t[0] + '"' + (g[0] === '매일' && i === 0 ? ' class="hot"' : '') + '><span class="ic" aria-hidden="true">' + t[1] + '</span><span><b>' + t[2] + '</b><small>' + t[3] + '</small></span></a>';
        }).join('') + '</nav>';
      }).join('') +
      ROWS.map(function (r) {
        return '<nav class="mrow" aria-label="' + r[0] + '"><span class="mr2">' + r[0] + '</span>' + r[1].map(function (l) {
          return '<a href="' + l[0] + '"' + (l[2] ? ' id="' + l[2] + '"' : '') + (l[3] ? ' hidden' : '') + '>' + l[1] + '</a>';
        }).join('') + '</nav>';
      }).join('') + '</div>';
  }

  function fillMe() {
    var m = null; try { m = JSON.parse(localStorage.getItem('hackon.melv') || 'null'); } catch (e) {}
    var lv = document.getElementById('menu-me-lv'), nx = document.getElementById('menu-me-next'), top = document.getElementById('nav-me-lv');
    if (!m || !m.level || !lv) return;
    lv.innerHTML = '<span class="lv">Lv.' + (+m.level) + '</span>';
    lv.appendChild(document.createTextNode(String(m.title || '')));
    if (top) top.textContent = 'Lv.' + (+m.level);
    nx.textContent = m.next ? '다음 — ' + m.next.icon + ' ' + m.next.name + ' ' + m.next.have + '/' + m.next.goal : '배지를 다 모았습니다';
    if (m.next && m.next.goal) { var bar = document.createElement('span'); bar.className = 'mbar'; bar.innerHTML = '<i style="width:' + Math.round(100 * Math.min(1, m.next.have / m.next.goal)) + '%"></i>'; nx.appendChild(bar); }
  }
  function fillRecent(sh) {
    var l = []; try { l = JSON.parse(localStorage.getItem('hackon.recent') || '[]'); } catch (e) {}
    var box = document.getElementById('menu-recent'), nav = box.querySelector('.recent'); nav.textContent = '';
    l.filter(function (x) { return x && RECENT_OK.test(x.p); }).slice(0, 4).forEach(function (x) {
      var known = sh.querySelector('.tiles a[href="' + x.p + '"] b, .mrow a[href="' + x.p + '"]');
      var a = document.createElement('a'); a.href = x.p; a.textContent = x.p === '/me' ? '나' : (known && known.textContent) || x.t || x.p; nav.appendChild(a);
    });
    box.hidden = !nav.children.length;
  }
  /* 있을 때만 여는 고리(강의·마켓·순위·그날의 조건) — 빈 표로 가는 문은 미리 걸지 않는다. 사이트 운영자면 «사이트 운영» 줄 */
  var asked = false;
  function askLive() {
    if (asked) return; asked = true;
    var j = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }); };
    var show = function (id) { var e = document.getElementById(id); if (e) e.hidden = false; };
    j('/api/lectures').then(function (d) { if (d && d.rows && d.rows.length) show('nav-learn'); }).catch(function () {});
    j('/api/market').then(function (d) { if (d && d.rows && d.rows.length) show('nav-market'); }).catch(function () {});
    j('/api/rank').then(function (d) { if (((d && d.all) || []).length || ((d && d.rows) || []).length) show('nav-rank'); }).catch(function () {});
    j('/api/conditions').then(function (d) { if (d && d.enough) show('nav-conds'); }).catch(function () {});
    j('/api/auth').then(function (d) { if (d && d.siteAdmin) show('menu-admin'); }).catch(function () {});
  }
  function syncBig() { var on = D.classList.contains('big'); document.querySelectorAll('[data-big]').forEach(function (x) { x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }

  function setup() {
    /* 공통 머리줄 */
    document.querySelectorAll('[data-hk-top]').forEach(function (h) {
      if (h.dataset.done) return; h.dataset.done = '1'; h.classList.add('hk-top');
      h.innerHTML = '<div class="hk-in"><a class="hk-logo" href="/" aria-label="HACK:ON 처음으로" translate="no">' + LOGO + '</a>' +
        '<a class="hk-me" href="/me" aria-label="나 — 배지·레벨"><img src="/norangi-on.svg" alt="" width="20" height="20"><span id="nav-me-lv">나</span></a>' +
        '<button type="button" class="hk-btn" id="nav-menu" data-menu-open aria-haspopup="dialog" aria-controls="menu-sheet" aria-expanded="false"><i aria-hidden="true"><b></b><b></b><b></b></i>메뉴</button></div>';
    });
    var sh = document.getElementById('menu-sheet');
    if (!sh) {
      sh = document.createElement('div'); sh.id = 'menu-sheet'; sh.hidden = true;
      sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', '전체 메뉴');
      sh.innerHTML = sheetHtml(); document.body.appendChild(sh);
      var here = location.pathname;
      sh.querySelectorAll('.mrow a').forEach(function (a) { if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'true'); });
    }
    if (document.body.hasAttribute('data-hk-cond')) askLive();   // 첫 화면은 열기 전에 미리 물어 둔다
    fillMe(); syncBig();
    var opener = null;
    function open(btn) {
      opener = btn || document.querySelector('[data-menu-open]');
      askLive(); fillMe(); fillRecent(sh); syncBig();
      sh.hidden = false; if (opener) opener.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden';
      var f = sh.querySelector('.tiles a'); if (f) f.focus();
    }
    function close() { sh.hidden = true; if (opener) { opener.setAttribute('aria-expanded', 'false'); opener.focus(); } document.body.style.overflow = ''; }
    document.addEventListener('click', function (e) {
      var o = e.target.closest && e.target.closest('[data-menu-open]');
      if (o) { e.preventDefault(); open(o); return; }
      if (e.target.closest && e.target.closest('[data-menu-close]')) { close(); return; }
      var b = e.target.closest && e.target.closest('[data-big]');
      if (b) { var on = D.classList.toggle('big'); try { on ? localStorage.setItem('hackon.big', '1') : localStorage.removeItem('hackon.big'); } catch (_) {} syncBig(); }
    });
    /* Tab 이 판 밖으로 새지 않게, Esc 로 닫고 연 단추로 돌아간다 */
    document.addEventListener('keydown', function (e) {
      if (sh.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = [].filter.call(sh.querySelectorAll('a[href], button'), function (x) { return !x.hidden && x.offsetParent !== null; }); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!sh.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    });
    /* 열쇠 칸(4050) — 폰 키보드가 첫 글자를 대문자로 바꾸면 «열쇠가 맞지 않습니다» 가 났다.
       이름·안내에 key·열쇠가 든 칸은 자동 대문자·고침을 끄고, 16진수만 든 값이면 소문자로·띄어쓰기와 - 를 지운다 */
    var KEYISH = /key|열쇠/i;
    document.addEventListener('focusin', function (e) {
      var i = e.target; if (!i || i.tagName !== 'INPUT' || !KEYISH.test((i.id || '') + (i.name || '') + (i.placeholder || ''))) return;
      i.setAttribute('autocapitalize', 'off'); i.setAttribute('autocorrect', 'off'); i.setAttribute('spellcheck', 'false'); i.setAttribute('autocomplete', 'off');
    });
    document.addEventListener('change', function (e) {
      var i = e.target; if (!i || i.tagName !== 'INPUT' || !KEYISH.test((i.id || '') + (i.name || '') + (i.placeholder || ''))) return;
      if (/^[0-9a-fA-F\s-]+$/.test(i.value) && /[0-9a-fA-F]{8}/.test(i.value.replace(/[\s-]/g, ''))) i.value = i.value.toLowerCase().replace(/[\s-]/g, '');
    }, true);
    window.HK_MENU = { open: open, close: close, esc: esc };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
