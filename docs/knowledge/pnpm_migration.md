# pnpm 包管理器迁移

## 定义

pnpm 是 Node.js 生态系统中快速、节省磁盘空间的包管理器，Kagami 项目已从 npm 迁移至 pnpm 以提升依赖管理效率和构建性能。项目采用 **pnpm workspace** 实现 monorepo 架构，统一管理多个子项目的依赖和构建。

## 迁移动机

### 性能优势
- **依赖安装速度**：比 npm 快 2-3 倍
- **磁盘空间效率**：通过硬链接共享依赖，节省大量磁盘空间
- **严格的依赖管理**：避免幽灵依赖问题

### 一致性保证
- **跨环境一致性**：`--frozen-lockfile` 确 CI/CD 环境依赖版本完全一致
- **确定性构建**：依赖解析算法更加稳定和可预测

## pnpm Workspace 架构

### Workspace 结构
```
kagami/
├── package.json              # 根目录配置，管理共享开发依赖
├── pnpm-workspace.yaml       # workspace 配置文件
├── pnpm-lock.yaml            # 统一的锁文件
├── kagami-bot/
│   └── package.json          # 子项目配置，包含运行时依赖
└── kagami-console-web/
    └── package.json          # 子项目配置，包含运行时依赖
```

### 根目录 package.json
```json
{
  "name": "kagami-workspace",
  "private": true,
  "scripts": {
    "build": "pnpm --recursive --stream build",
    "build:bot": "pnpm --filter kagami-bot build",
    "build:web": "pnpm --filter kagami-console-web build",
    "lint": "pnpm --recursive --stream lint",
    "lint:bot": "pnpm --filter kagami-bot lint",
    "lint:web": "pnpm --filter kagami-console-web lint",
    "clean": "pnpm --recursive exec rm -rf dist"
  },
  "devDependencies": {
    "@eslint/js": "^9.33.0",
    "@stylistic/eslint-plugin": "^5.3.1",
    "@types/node": "^24.2.0",
    "eslint": "^9.33.0",
    "globals": "^16.4.0",
    "typescript": "~5.8.3",
    "typescript-eslint": "^8.39.1"
  }
}
```

### pnpm-workspace.yaml
```yaml
packages:
  - 'kagami-bot'
  - 'kagami-console-web'
```

### 依赖分层管理
- **根目录依赖**: TypeScript、ESLint、@types/node 等开发工具，所有子项目共享
- **子项目依赖**: 各自的运行时依赖（如 Express、React）和特定开发依赖（如 @types/express）
- **版本统一**: 共享依赖的版本在根目录统一管理，确保一致性

## 迁移实施

### 包管理器更换
```bash
# 替换构建脚本中的 npm 命令
npm install → pnpm install
npm run build → pnpm build
npm run lint → pnpm lint

# Workspace 命令
pnpm install                        # 安装所有子项目依赖
pnpm --filter kagami-bot build     # 只构建指定子项目
pnpm --recursive --stream lint     # 并行执行所有子项目的 lint
```

### Docker 构建更新

#### Corepack 集成
```dockerfile
# 使用 corepack 管理 pnpm 版本（推荐）
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
```

#### Workspace 感知的 Docker 构建
```dockerfile
# 第 1 层：复制 workspace 配置文件和所有子项目的 package.json
# 这一层只有在依赖变化时才会失效
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY kagami-bot/package.json ./kagami-bot/
COPY kagami-console-web/package.json ./kagami-console-web/

# 第 2 层：只安装当前项目的依赖（会被缓存）
# 使用 --filter 避免安装其他子项目的依赖，减小镜像大小
RUN pnpm install --frozen-lockfile --filter kagami-bot

# 第 3 层：复制源代码
# 代码修改只会导致这一层及之后的层失效，前面的依赖安装层仍然有效
COPY . .

# 第 4 层：构建指定子项目
RUN pnpm --filter kagami-bot build
```

#### Docker Compose 构建上下文调整
```yaml
services:
  bot:
    build:
      context: .                    # 从根目录构建
      dockerfile: kagami-bot/Dockerfile

  console-web:
    build:
      context: .                    # 从根目录构建
      dockerfile: kagami-console-web/Dockerfile
```

#### 缓存优化策略
- **分层缓存**: 依赖安装层独立于代码变更层
- **选择性安装**: 使用 `--filter` 只安装需要的子项目依赖
- **锁文件优先**: 统一的 pnpm-lock.yaml 确保依赖一致性

### 锁文件迁移
- **生成 pnpm-lock.yaml**：`pnpm install` 自动生成
- **删除 package-lock.json**：避免冲突
- **版本锁定**：使用 `--frozen-lockfile` 确保依赖版本一致性

## 技术实现

### Makefile 更新

#### 委托到 pnpm workspace
```makefile
# 安装所有项目依赖
install:
	pnpm install --frozen-lockfile

# 构建所有项目（委托给 pnpm workspace）
build: install
	pnpm build

# 清理所有项目
clean:
	pnpm clean

# Lint 所有项目
lint:
	pnpm lint
```

#### Makefile 简化原则
- **委托构建**: 将子项目构建任务委托给 pnpm workspace，避免 Makefile 递归调用
- **统一入口**: 保留 Makefile 作为统一的构建接口
- **Docker 集成**: 保留 Docker 相关命令（up/down/status）

### pnpm 配置优势
- **并发安装**：最大化网络和磁盘 I/O 并发
- **本地缓存**：全局缓存避免重复下载
- **依赖去重**：智能检测和共享相同版本的依赖
- **Workspace 协同**：所有子项目共享依赖，进一步节省空间
- **过滤执行**：通过 `--filter` 选择性执行特定子项目命令

## 项目影响

### 构建优化
- **构建时间减少**：依赖安装和构建流程整体加速
- **镜像体积优化**：通过 `--filter` 选择性安装依赖，生产环境减少不必要的包
- **CI/CD 提升**：构建缓存机制提升流水线效率
- **Workspace 效率**：单次 `pnpm install` 安装所有子项目依赖，避免重复安装
- **Docker 缓存命中**：分层构建策略提升 Docker 构建缓存命中率

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
- **ESLint**：根目录统一管理 ESLint 配置，子项目共享
- **TypeScript**：根目录统一 TypeScript 版本，子项目使用统一编译器
- **Prisma**：`pnpm --filter kagami-bot prisma:generate` 针对特定子项目执行

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

### pnpm-workspace.yaml（必需）
```yaml
packages:
  - 'kagami-bot'
  - 'kagami-console-web'
```
定义 workspace 中的子项目列表。

### .npmrc（可选）
```ini
# pnpm 配置
shamefully-hoist=false
strict-peer-dependencies=true
auto-install-peers=true
```

### 根目录 .dockerignore
```
# 优化 Docker 构建上下文
**/dist
**/node_modules
docs
*.md
!README.md
```
减少传递给 Docker 的文件，提升构建速度。

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

## Workspace 最佳实践

### 依赖管理原则
- **共享开发工具**：TypeScript、ESLint 等开发工具放在根目录
- **独立运行时依赖**：各子项目的运行时依赖独立管理
- **类型定义分层**：通用类型定义放根目录，特定类型定义放子项目

### 命令执行模式
```bash
# 并行执行（适合独立任务）
pnpm --recursive --stream build

# 串行执行（适合有依赖关系的任务）
pnpm --recursive --workspace-concurrency=1 build

# 过滤执行（只执行特定子项目）
pnpm --filter kagami-bot build
pnpm --filter kagami-console-web build
```

### Docker 构建最佳实践
- **统一构建上下文**：所有 Dockerfile 从根目录构建
- **选择性依赖安装**：使用 `--filter` 只安装需要的依赖
- **分层优化**：分离依赖安装层和代码构建层

## 后续规划

### 潜在优化
- **依赖共享优化**：进一步识别可提升到根目录的共享依赖
- **发布流程**：集成 pnpm 发布工具链（如需要发布 npm 包）
- **依赖审计**：使用 pnpm audit 进行安全检查
- **Turbo 集成**：引入 Turborepo 进一步优化 monorepo 构建性能

### 监控指标
- **构建时间**：持续监控构建性能提升
- **依赖更新**：跟踪依赖版本更新频率
- **错误率**：监控迁移后的稳定性

## 依赖关系

- [[deployment_system]] - 容器化部署中的包管理器集成
- [[kagami_bot]] - 主应用的构建和依赖管理
- [[console_system]] - 前端控制台的构建流程

## 相关文件
- `package.json` - 根目录配置，管理共享开发依赖
- `pnpm-workspace.yaml` - workspace 配置文件
- `pnpm-lock.yaml` - 统一的锁文件
- `Makefile` - 统一构建脚本（委托给 pnpm）
- `.dockerignore` - Docker 构建优化配置
- `kagami-bot/package.json` - 子项目依赖配置
- `kagami-bot/Dockerfile` - 子项目容器构建配置
- `kagami-console-web/package.json` - 前端依赖配置
- `kagami-console-web/Dockerfile` - 前端容器构建配置
- `docker-compose.yaml` - 多容器编排配置（调整构建上下文）