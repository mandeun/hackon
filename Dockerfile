# HACK:ON — 의존성이 0이라 받을 것이 없다. 소스만 넣으면 끝난다.
# node:sqlite 가 정식으로 들어간 것이 Node 23 부터라 24 를 쓴다.
FROM node:24-alpine

WORKDIR /app
COPY server.js home.html hack-on.html sw.js manifest.webmanifest icon.svg logo.svg package.json ./

# DB 와 백업은 볼륨에 둔다. 기계가 꺼졌다 켜져도 대회가 남아야 한다.
ENV DB=/data/hackon.db
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
