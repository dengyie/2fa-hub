# 2fa-hub —— 单容器部署：前端构建产物 + 零依赖 Node 服务端
FROM node:24-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# vite 别名 @shared 指向 ../shared，需在 web 构建阶段一并带入
COPY shared/ /app/shared/
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=web /app/web/dist ./web/dist
# VOLUME 挂载点由 Docker 以 root 创建，必须预建并交给 node 用户，否则首启 EACCES 崩溃循环
RUN mkdir -p /data && chown -R node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8000
EXPOSE 8000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8000/api/health || exit 1
USER node
CMD ["node", "server/src/index.js"]
