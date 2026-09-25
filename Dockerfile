# HACK:ON — 의존성이 0이라 받을 것이 없다. 소스만 넣으면 끝난다.
# node:sqlite 가 정식으로 들어간 것이 Node 23 부터라 24 를 쓴다.
FROM node:24-alpine

WORKDIR /app
# GUIDE.md 는 /manual 이 읽어서 화면으로 만든다. 빠지면 배포판에서만 매뉴얼이 404 가 난다.
COPY server.js home.html hack-on.html news.html qr.js sw.js manifest.webmanifest icon.svg logo.svg og.png hero.jpg package.json GUIDE.md ./

# DB 와 백업은 볼륨에 둔다. 기계가 꺼졌다 켜져도 대회가 남아야 한다.
ENV DB=/data/hackon.db
ENV PORT=8080
# 서버는 UTC 로 도는데 대회는 한국에서 열린다. 안 맞추면 한국 새벽 0~9시에
# 서버가 하루 전을 '오늘' 이라고 본다 — 대회 당일 아침이 하필 그 시간대다.
ENV TZ=Asia/Seoul
EXPOSE 8080

CMD ["node", "server.js"]
