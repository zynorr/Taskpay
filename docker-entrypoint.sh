#!/bin/sh
# Boot both processes in the single public container:
#   - the oracle (event poller + sponsor bundler) on the internal port 8787
#   - the Next.js frontend on the public port 3000
# Both read/write the archive under TASKPAY_DATA_DIR, which the deployment
# points at the mounted persistent disk so archives survive redeploys.
set -e

export TASKPAY_DATA_DIR="${TASKPAY_DATA_DIR:-/data}"

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