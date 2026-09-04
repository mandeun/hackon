/**
 * HACK:ON 윈도우 프로그램 — 주소창 없는 앱 창으로 띄운다.
 *
 * 브라우저의 --app 모드를 쓴다. 크롬이나 엣지는 윈도우에 이미 깔려 있고,
 * --app 으로 열면 주소창도 탭도 없는 창이 나온다. 그게 이 프로그램의 창이다.
 * 일렉트론을 붙이면 200MB 를 같이 배포해야 하는데, 얻는 게 창 하나뿐이라 안 쓴다.
 *
 *   node desktop.js          창을 띄운다. 창을 닫으면 서버도 같이 꺼진다
 *   node desktop.js --check  띄우지 않고 준비 상태만 본다
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = __dirname;
const CHECK = process.argv.includes('--check');

/* 브라우저를 찾는다. 엣지가 먼저다 — 윈도우10 이상이면 반드시 있다. */
function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\Program Files';
  const px = process.env['ProgramFiles(x86)'] || 'C:\Program Files (x86)';
  const la = process.env['LOCALAPPDATA'] || '';
  const names = [
    [px, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'],
    [pf, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [px, 'Google', 'Chrome', 'Application', 'chrome.exe'],
    [la, 'Google', 'Chrome', 'Application', 'chrome.exe'],
  ];
  for (const parts of names) {
    if (!parts[0]) continue;
    const f = path.join(...parts);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/* 8788 이 비었으면 그걸 쓰고, 이미 쓰고 있으면 커널한테 빈 포트를 받는다.
   두 번 켜도 안 부딪히게 하려는 것이다. */
function freePort(want) {
  return new Promise(res => {
    const s = net.createServer();
    s.once('error', () => {
      const s2 = net.createServer();
      s2.listen(0, '127.0.0.1', () => { const p = s2.address().port; s2.close(() => res(p)); });
    });
    s.listen(want, '127.0.0.1', () => s.close(() => res(want)));
  });
}

function waitUp(port, deadline) {
  return new Promise((res, rej) => {
    const tick = () => {
      http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, r => {
        r.resume(); res();
      }).on('error', () => {
        if (Date.now() > deadline) return rej(new Error('서버가 안 떴습니다'));
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

(async () => {
  const browser = findBrowser();
  const port = await freePort(8788);
  const url = `http://localhost:${port}`;

  if (CHECK) {
    console.log('노드      ', process.version);
    console.log('브라우저  ', browser || '못 찾음 (기본 브라우저로 엽니다)');
    console.log('포트      ', port);
    console.log('화면 파일 ', fs.existsSync(path.join(ROOT, 'hack-on.html')) ? '있음' : '없음');
    process.exit(0);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')],
    { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });

  const bye = code => { try { server.kill(); } catch {} process.exit(code || 0); };
  process.on('SIGINT', () => bye(0));
  server.on('exit', () => process.exit(0));

  try {
    await waitUp(port, Date.now() + 20000);
  } catch (e) {
    console.error(e.message);
    return bye(1);
  }

  if (!browser) {
    // 크롬도 엣지도 없다. 기본 브라우저로라도 연다 — 창은 평범해지지만 쓸 수는 있다.
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    console.log(`HACK:ON  ${url}   (이 창을 닫으면 꺼집니다)`);
    return;
  }

  /* 프로필 폴더를 따로 준다. 그래야 쓰던 브라우저 창과 섞이지 않고,
     이 창을 닫는 것이 곧 프로그램을 끄는 것이 된다. */
  const profile = path.join(os.homedir(), '.hackon-app');
  const win = spawn(browser, [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    '--window-size=480,920',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });

  win.on('exit', () => bye(0));   // 창을 닫으면 서버도 내린다
})();
