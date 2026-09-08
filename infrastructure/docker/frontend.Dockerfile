FROM node:26-alpine AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --workspace=@mansoorikart/frontend --include-workspace-root=false

FROM dependencies AS build

COPY frontend frontend
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
# Public Google client id only. A build argument ends up in the shipped bundle and in image
# history, so no secret may be passed this way.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
RUN npm run build --workspace=@mansoorikart/frontend

FROM nginx:1.27-alpine AS runtime

COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
