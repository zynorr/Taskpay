# ---- build stage -------------------------------------------------------------
# Compiles the oracle (tsc → dist) and the frontend (next build). NEXT_PUBLIC_*
# values are inlined by `next build`; the ENV defaults below target the
# combined container (bundler reachable through the same-origin /api/bundler
# proxy). Override any of them at build time for another deployment.
FROM node:22-alpine AS build
WORKDIR /app

# Oracle deps + compile
COPY oracle/package.json oracle/package-lock.json ./oracle/
RUN cd oracle && npm ci
COPY oracle/tsconfig.json ./oracle/
COPY oracle/src ./oracle/src
RUN cd oracle && npm run build

# Frontend deps + compile
ENV NEXT_PUBLIC_BUNDLER_URL=/api/bundler
ENV NEXT_PUBLIC_CHAIN_ID=677
ENV NEXT_PUBLIC_TASKPAY_CONTRACT=0x1955D52833863B8e74c095457b5bE47332BAd6dF
ENV NEXT_PUBLIC_ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032
ENV NEXT_PUBLIC_AA_FACTORY=0xd6fF7d0Db03213800f7Fe8ef961642e7CEcDDa5B
ENV NEXT_PUBLIC_PAYMASTER=0x29BE94cC6308BB497fDA8Be5A51E4bDd95662c9C
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# ---- runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/oracle ./oracle
COPY --from=build /app/frontend ./frontend
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Ship the curated spec archive as a seed: the free Render tier has no
# persistent /data disk, so without this every redeploy boots with an empty
# archive and task titles/specs disappear. The entrypoint seeds
# TASKPAY_DATA_DIR from this copy when the runtime archive is missing.
COPY data/specs /app/spec-seed/specs

# The oracle listens internally on 8787; 3000 is the single public port.
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]