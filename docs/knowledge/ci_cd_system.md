# CI/CD 系统

## 定义说明

Kagami 项目的持续集成和持续部署系统，基于 GitHub Actions 实现自动化的代码质量检查和构建验证。

## 核心功能

### 自动化检查
- **构建验证**: 通过 `make build` 验证所有子项目能够成功构建
- **代码质量**: 通过 lint 检查确保代码符合规范标准
- **多语言支持**: 支持 TypeScript (Node.js) 和 Go 两种技术栈的检查

### 触发机制
- **Pull Request 检查**: 当有 PR 提交到 master 分支时自动触发
- **master 分支保护**: 当 master 分支有新推送时自动执行检查
- **失败阻断**: 任何检查失败都会阻止 PR 合并，确保代码质量

## 技术实现

### 工作流配置
- **文件位置**: `.github/workflows/ci.yml`
- **运行环境**: Ubuntu Latest
- **Node.js 版本**: 20 LTS（兼容 TypeScript 5.x）
- **Go 版本**: 1.25（匹配项目 go.mod）

### 依赖管理
- **Node.js**: 使用 `npm ci` 确保可重现构建
- **Go**: 使用 `go mod download` 预下载模块
- **缓存优化**: 启用 Node.js 和 Go 模块缓存，提升构建速度

### 检查步骤
1. **环境准备**: 设置 Node.js、Go 环境和系统依赖
2. **依赖安装**: 安装各子项目所需依赖
3. **构建检查**: 执行 `make build` 验证编译通过
4. **Node.js Lint**: 使用 ESLint 检查 TypeScript 代码规范
5. **Go Lint**: 使用 `go vet` 和 `golangci-lint` 检查 Go 代码质量

## 使用示例

### 工作流配置示例
```yaml
name: CI
on:
  pull_request:
    branches: [ master ]
  push:
    branches: [ master ]

jobs:
  build-and-lint:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - name: Setup Go
      uses: actions/setup-go@v5
      with:
        go-version: '1.25'
        cache: true
    - name: Run build
      run: make build
    - name: Run lint checks
      run: # 各种 lint 检查
```

### 本地测试
开发者可以在提交前本地执行相同的检查：
```bash
# 构建检查
make build

# 代码规范检查
make lint
```

## 关联关系

### 依赖节点
- **构建系统**: 依赖各子项目的 Makefile 配置
- **[[config_system]]**: 需要 `yq` 工具解析项目配置文件
- **项目结构**: 依赖多子项目架构（kagami-bot、kagami-console、kagami-console-web）

### 服务节点
- **开发流程**: 为开发团队提供代码质量保障
- **部署安全**: 确保只有通过检查的代码才能合并到主分支
- **[[console_system]]**: 间接保障控制台系统的代码质量

## 优势特性

### 质量保障
- **多层检查**: 构建 + 多种 lint 工具组合使用
- **快速反馈**: 并行执行检查，及时发现问题
- **标准统一**: 确保团队代码风格一致性

### 性能优化
- **依赖缓存**: 缓存 Node.js 和 Go 依赖，减少重复下载时间
- **专用 Actions**: 使用官方维护的 setup-node、setup-go 等专用 Actions
- **条件触发**: 仅在必要时触发，避免资源浪费

### 维护性
- **单一配置**: 通过根目录 Makefile 统一管理所有子项目检查
- **版本固定**: 明确指定各环境版本，确保构建一致性
- **扩展友好**: 易于添加新的检查步骤或支持新的子项目