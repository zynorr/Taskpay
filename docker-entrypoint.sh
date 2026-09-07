#!/bin/sh
# Boot both processes in the single public container:
#   - the oracle (event poller + sponsor bundler) on the internal port 8787
#   - the Next.js frontend on the public port 3000
# Both read/write the archive under TASKPAY_DATA_DIR. Point it at a mounted
# disk (paid plans) to persist archives across redeploys; on the free plan it
# stays on the container filesystem and resets with each deploy.
set -e

export TASKPAY_DATA_DIR="${TASKPAY_DATA_DIR:-/data}"

# A fresh container (the free plan has no persistent /data) boots with an empty
# spec archive — task titles/specs render only from archived rows, and the
# on-chain task ids were seeded from the image copy below. Never overwrite an
# existing archive (a paid-plan disk mount keeps its own rows).
if [ -d /app/spec-seed/specs ] && [ ! -d "$TASKPAY_DATA_DIR/specs" ]; then
  mkdir -p "$TASKPAY_DATA_DIR"
  cp -r /app/spec-seed/specs "$TASKPAY_DATA_DIR/"
fi

PORT=8787 node /app/oracle/dist/index.js &
ORACLE_PID=$!

cleanup() {
  kill "$ORACLE_PID" 2>/dev/null || true
}
trap cleanup TERM INT

cd /app/frontend
node node_modules/next/dist/bin/next start -p 3000 &
NEXT_PID=$!

wait "$NEXT_PID"