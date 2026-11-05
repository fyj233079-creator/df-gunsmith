FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY data/manual.example.json ./data/manual.example.json
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
# 数据目录挂卷，重启不丢历史与变更记录
VOLUME ["/app/public/data", "/app/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/server.js"]
