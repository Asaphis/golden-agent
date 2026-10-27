FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production
ENV CONNECTOR_SERVER_URL=ws://backend:4100/connect
ENV CONNECTOR_DATA_PATH=/data/connector
ENV CONNECTOR_IDENTITY_PATH=/data/connector/identity.json
ENV CONNECTOR_TOKEN_PATH=/data/connector/access-token
ENV CONNECTOR_IPC_SECRET_PATH=/data/connector/ipc-secret
VOLUME ["/data"]
ENTRYPOINT ["node", "dist/apps/connector/src/main.js", "service"]
