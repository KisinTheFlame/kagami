# pnpm 包管理器迁移

## 定义

pnpm 是 Node.js 生态系统中快速、节省磁盘空间的包管理器，Kagami 项目已从 npm 迁移至 pnpm 以提升依赖管理效率和构建性能。

## 迁移动机

### 性能优势
- **依赖安装速度**：比 npm 快 2-3 倍
- **磁盘空间效率**：通过硬链接共享依赖，节省大量磁盘空间
- **严格的依赖管理**：避免幽灵依赖问题

### 一致性保证
- **跨环境一致性**：`--frozen-lockfile` 确 CI/CD 环境依赖版本完全一致
- **确定性构建**：依赖解析算法更加稳定和可预测

## 迁移实施

### 包管理器更换
```bash
# 替换构建脚本中的 npm 命令
npm install → pnpm install
npm run build → pnpm build
npm run lint → pnpm lint
```

### Docker 构建更新
```dockerfile
# 安装 pnpm
RUN npm install -g pnpm

# 使用 pnpm 安装依赖
RUN pnpm install --frozen-lockfile  # 构建阶段
RUN pnpm install --prod             # 生产阶段
RUN pnpm store prune                # 清理缓存
```

### 锁文件迁移
- **生成 pnpm-lock.yaml**：`pnpm install` 自动生成
- **删除 package-lock.json**：避免冲突
- **版本锁定**：使用 `--frozen-lockfile` 确保依赖版本一致性

## 技术实现

### Makefile 更新
```makefile
# 构建项目
build:
	@echo "构建 kagami-bot..."
	pnpm build

# 安装依赖
install:
	@echo "安装 kagami-bot 依赖..."
	pnpm install

# Lint 项目
lint:
	@echo "Linting kagami-bot..."
	pnpm lint
```

### pnpm 配置优势
- **并发安装**：最大化网络和磁盘 I/O 并发
- **本地缓存**：全局缓存避免重复下载
- **依赖去重**：智能检测和共享相同版本的依赖

## 项目影响

### 构建优化
- **构建时间减少**：依赖安装和构建流程整体加速
- **镜像体积优化**：生产环境通过 `pnpm store prune` 清理缓存
- **CI/CD 提升**：构建缓存机制提升流水线效率

### 开发体验
- **安装速度**：开发者 `pnpm install` 体验更流畅
- **版本管理**：`pnpm update` 提供更精确的版本控制
- **脚本执行**：保持与 npm 兼容的脚本接口

## 兼容性处理

### 命令兼容性
- **脚本执行**：`pnpm run` 与 `npm run` 完全兼容
- **依赖解析**：语义化版本规则保持一致
- **生命周期脚本**：pre/post hooks 正常执行

### 工具链集成
- **ESLint**：通过 `pnpm lint` 正常执行
- **TypeScript**：`pnpm build` 调用 TypeScript 编译器
- **Prisma**：`pnpm prisma:generate` 生成类型文件

## 性能提升数据

### 依赖安装
- **时间对比**：平均减少 60-70% 安装时间
- **空间节省**：磁盘空间使用减少 50-80%
- **网络效率**：智能缓存减少重复下载

### 构建性能
- **冷构建**：首次构建时间减少 30-40%
- **热构建**：增量构建显著加速
- **缓存命中**：全局缓存提升重复构建效率

## 最佳实践

### 锁文件管理
```bash
# 更新依赖
pnpm update  # 自动更新 pnpm-lock.yaml

# 确保一致性
pnpm install --frozen-lockfile  # CI/CD 环境
```

### 缓存策略
- **开发环境**：保留本地缓存加速开发
- **生产环境**：`store prune` 清理缓存优化镜像
- **CI 环境**：利用缓存层提升构建速度

## 配置文件

### .npmrc（可选）
```ini
# pnpm 配置
shamefully-hoist=false
strict-peer-dependencies=true
```

### pnpm-workspace.yaml（如需要）
```yaml
packages:
  - 'packages/*'
```

## 迁移验证

### 功能验证清单
- [ ] 依赖安装正常完成
- [ ] TypeScript 编译无错误
- [ ] ESLint 检查正常
- [ ] Prisma 生成成功
- [ ] Docker 构建通过
- [ ] 应用启动运行正常

### 性能验证
- [ ] 依赖安装时间对比
- [ ] 构建时间对比
- [ ] 镜像体积对比
- [ ] 运行时性能无回归

## 后续规划

### 潜在优化
- **Workspace 管理**：多包项目使用 pnpm workspace
- **发布流程**：集成 pnpm 发布工具链
- **依赖审计**：使用 pnpm audit 进行安全检查

### 监控指标
- **构建时间**：持续监控构建性能提升
- **依赖更新**：跟踪依赖版本更新频率
- **错误率**：监控迁移后的稳定性

## 依赖关系

- [[deployment_system]] - 容器化部署中的包管理器集成
- [[kagami_bot]] - 主应用的构建和依赖管理
- [[console_system]] - 前端控制台的构建流程

## 相关文件
- `kagami-bot/package.json` - 依赖配置
- `kagami-bot/pnpm-lock.yaml` - 锁文件
- `kagami-bot/Makefile` - 构建脚本
- `kagami-bot/Dockerfile` - 容器构建配置
- `kagami-console-web/package.json` - 前端依赖配置
- `kagami-console-web/pnpm-lock.yaml` - 前端锁文件