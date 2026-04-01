# ============================================
# 微信本地工作台 - Docker 多阶段构建
# ============================================

# 阶段 1: 依赖安装
FROM node:20-alpine AS deps

WORKDIR /app

# 复制依赖配置文件
COPY package.json package-lock.json ./

# 安装依赖（仅生产依赖，用于最终镜像）
RUN npm ci --omit=dev

# 阶段 2: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖配置文件
COPY package.json package-lock.json ./

# 安装所有依赖（包括 devDependencies）
RUN npm ci

# 复制源码
COPY tsconfig.json ./
COPY vite.config.mts ./
COPY src/ ./src/
COPY public/ ./public/

# 构建项目
RUN npm run build

# 阶段 3: 运行阶段
FROM node:20-alpine AS runner

# 安装 dumb-init 用于信号处理
RUN apk add --no-cache dumb-init

# 创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# 从 deps 阶段复制生产依赖
COPY --from=deps /app/node_modules ./node_modules

# 从 builder 阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public/dist ./public/dist

# 复制 package.json（用于 npm start）
COPY package.json ./

# 创建数据目录
RUN mkdir -p /app/data && \
    chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3100

# 设置环境变量
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/system/health || exit 1

# 使用 dumb-init 启动应用
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
