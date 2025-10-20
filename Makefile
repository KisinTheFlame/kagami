# Kagami 项目主 Makefile

# 定义子项目
SUBPROJECTS = kagami-bot kagami-console-web

# 获取当前用户的 UID 和 GID
CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)

# 从 config.yaml 提取配置（端口硬编码为5432）
export DB_HOST := $(shell yq '.postgres.host' config.yaml)
export DB_PORT := 5432
export DB_NAME := $(shell yq '.postgres.name' config.yaml)
export DB_USER := $(shell yq '.postgres.user' config.yaml)
export DB_PASSWORD := $(shell yq '.postgres.password' config.yaml)
export NAPCAT_UID := $(CURRENT_UID)
export NAPCAT_GID := $(CURRENT_GID)

.PHONY: all install build clean lint up down status

# 默认目标：构建所有项目
all: build

# 安装所有项目依赖
install:
	pnpm install --frozen-lockfile

# 构建所有项目
build: install
	pnpm build

# 清理所有项目
clean:
	pnpm clean

# Lint 所有项目
lint:
	pnpm lint

# Docker 管理命令
# 支持指定单个服务：make up SERVICE=bot 或使用 make up-bot
up: build
	@echo "启动 Docker 服务"
	@if [ -n "$(SERVICE)" ]; then \
		echo "仅启动指定服务: $(SERVICE)"; \
		docker compose up -d --build $(SERVICE); \
	else \
		echo "启动所有服务"; \
		docker compose up -d --build; \
	fi

# 便捷：make up-<service>
up-%: build
	@echo "启动指定 Docker 服务: $*"
	docker compose up -d --build $*

down:
	@echo "停止 Docker 服务"
	docker compose down

status:
	@echo "查看 Docker 服务状态"
	docker compose ps
