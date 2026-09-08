FROM node:26-alpine AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --workspace=@mansoorikart/backend --include-workspace-root=false

FROM dependencies AS build

COPY backend backend
RUN npm run build --workspace=@mansoorikart/backend

FROM node:26-alpine AS production-dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --workspace=@mansoorikart/backend --include-workspace-root=false

FROM node:26-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node --from=production-dependencies /workspace/node_modules /app/node_modules
COPY --chown=node:node --from=build /workspace/backend/dist /app/dist

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:5000/api/v1/health', response => process.exit(response.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
