FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json ./services/api/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/demo-tool/package.json ./services/demo-tool/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/gateway/package.json ./services/gateway/package.json
COPY --from=build /app/services/demo-tool/package.json ./services/demo-tool/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/db/*.sql ./db/
USER node
CMD ["node", "dist/services/api/src/main.js"]
