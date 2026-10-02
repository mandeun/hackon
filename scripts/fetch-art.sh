#!/bin/sh
# 힉스필드 그림을 저장소 art/ 로 받아 온다 — 한 번만 돌리고 커밋하면 /art/<이름>.webp 가 우리 서버 것을 낸다.
# (클라우드 작업 환경은 이 CDN 을 막아 둬서 사람 컴퓨터에서 돌린다)  사용: sh scripts/fetch-art.sh && git add art && git commit -m "그림 받아 옴"
set -e
cd "$(dirname "$0")/.."
B=https://d8j0ntlcm91z4.cloudfront.net/user_3ERvwmumZiLA4IhDFgAw5PMHUW7
get() { curl -fsSL -o "art/$1.webp" "$B/$2_min.webp" && echo "art/$1.webp $(wc -c < "art/$1.webp") bytes"; }
get hero  hf_20261002_173019_d7a89225-acbf-4872-b42a-24b4a12e1a8a
get me    hf_20261002_173020_fb9dc8fe-af45-4ae0-be52-4d2f75d8fdec
get board hf_20261002_173020_aa109475-961d-4f1c-a45f-cd515afe20d0
get write hf_20261002_173020_600d8dbc-0ad5-4604-bd82-80214173d0dd
get news  hf_20261002_173022_77056f80-6a43-4da1-80a7-2c2137ae5240
get club  hf_20261002_173022_3fcdf796-6462-4d9a-9e96-bc5323e494f3
get tools hf_20261002_160648_a852d09d-d35a-4262-9016-f2b2067af247
