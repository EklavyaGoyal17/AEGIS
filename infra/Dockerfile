FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
# Contracts → policy engine → SDK, then the backend services that load the engine at runtime.
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# Workspace manifests are required for a lockfile-consistent install; only the root (backend)
# dependencies and the two runtime packages are installed — the console and SDK are not.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/gateway/package.json ./services/gateway/package.json
COPY --from=build /app/services/demo-tool/package.json ./services/demo-tool/package.json
COPY --from=build /app/apps/console/package.json ./apps/console/package.json
COPY --from=build /app/apps/demo-agent/package.json ./apps/demo-agent/package.json
COPY --from=build /app/packages/agent-sdk/package.json ./packages/agent-sdk/package.json
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/policy-engine/package.json ./packages/policy-engine/package.json
COPY --from=build /app/packages/policy-engine/dist ./packages/policy-engine/dist
RUN npm ci --omit=dev --ignore-scripts --include-workspace-root \
      --workspace=@aegis/contracts --workspace=@aegis/policy-engine \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/db/*.sql ./db/
USER node
CMD ["node", "dist/services/api/src/main.js"]
