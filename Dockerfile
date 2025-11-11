# 빌드 스테이지
FROM node:20 AS builder
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build && ls -R dist

# 실행 스테이지
FROM node:20 AS runner
WORKDIR /usr/src/app

# ✅ dist 폴더 존재 여부 출력 (디버깅용)
RUN mkdir -p /usr/src/app/dist
COPY --from=builder /usr/src/app/dist /usr/src/app/dist
COPY --from=builder /usr/src/app/package*.json /usr/src/app/
COPY --from=builder /usr/src/app/node_modules /usr/src/app/node_modules

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
