#!/bin/sh
# 컨테이너가 들어오는 곳 하나.
#
# 버킷이 없으면 지금까지와 똑같이 node 만 띄운다 — 그게 기본값이다.
# 버킷이 있으면 켜질 때 한 번 되살려 보고, node 를 litestream 안에서 띄운다.
set -e

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  exec node server.js
fi

# 버킷을 줬는데 DB 경로가 비면 조용히 엉뚱한 것을 복제하게 된다. 여기서 멈춘다.
: "${DB:?LITESTREAM_BUCKET 이 있는데 DB 가 비어 있습니다}"

# 빈 볼륨이면 버킷에서 되살린다.
#   -if-db-not-exists   파일이 이미 있으면 통과한다. 살아 있는 DB 를 덮지 않는다.
#   -if-replica-exists  버킷이 아직 비어 있으면 통과한다. 첫 배포가 여기서 죽지 않게.
litestream restore -if-db-not-exists -if-replica-exists "$DB"

# node 를 litestream 의 자식으로 띄운다. 한쪽이 죽으면 같이 내려간다.
exec litestream replicate -exec "node server.js"
