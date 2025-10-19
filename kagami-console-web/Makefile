# kagami-console-web Makefile

.PHONY: all build clean lint install

# 默认目标
all: build

# 构建项目
build:
	@echo "构建 kagami-console-web..."
	pnpm build

# 安装依赖
install:
	@echo "安装 kagami-console-web 依赖..."
	pnpm install

# 清理项目
clean:
	@echo "清理 kagami-console-web..."
	rm -rf dist/

# Lint 项目
lint:
	@echo "Linting kagami-console-web..."
	pnpm lint
