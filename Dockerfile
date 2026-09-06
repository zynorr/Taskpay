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
ENV NEXT_PUBLIC_CHAIN_ID=968
ENV NEXT_PUBLIC_TASKPAY_CONTRACT=0xCd57fC7d37E9D124493AC78A94E96FC96D1D8E46
ENV NEXT_PUBLIC_ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032
ENV NEXT_PUBLIC_AA_FACTORY=0xFbfBBD060b1d4E7Edae6D9e58C73F731927b2f2b
ENV NEXT_PUBLIC_PAYMASTER=0x8Ed5e3054A98a6528B666Ca99411648B94A0fDF0
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

# The oracle listens internally on 8787; 3000 is the single public port.
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]