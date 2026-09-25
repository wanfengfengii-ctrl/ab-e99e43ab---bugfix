# 卫星太阳翼支撑垫选点裁决服务（零运行时依赖）
FROM node:22-alpine

WORKDIR /app

# 零第三方依赖：仅拷贝源码与测试，无需 npm install
COPY package.json ./
COPY server ./server
COPY public ./public
COPY test ./test
COPY smoke ./smoke

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# alpine 不带 curl，使用 Node 内置 fetch 做健康检查
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
