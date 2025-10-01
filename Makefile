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

.PHONY: all build clean lint up down status install \
        $(SUBPROJECTS) $(addsuffix -build,$(SUBPROJECTS)) $(addsuffix -clean,$(SUBPROJECTS)) $(addsuffix -lint,$(SUBPROJECTS)) $(addsuffix -install,$(SUBPROJECTS))

# 默认目标：构建所有项目
all: build

# 构建所有项目
build: $(addsuffix -build,$(SUBPROJECTS))

# 清理所有项目
clean: $(addsuffix -clean,$(SUBPROJECTS))

# Lint 所有项目
lint: $(addsuffix -lint,$(SUBPROJECTS))

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

# 安装所有子项目依赖
install: $(addsuffix -install,$(SUBPROJECTS))

# 子项目构建规则
$(addsuffix -build,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-build,%,$@) build

# 子项目清理规则
$(addsuffix -clean,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-clean,%,$@) clean

# 子项目 lint 规则
$(addsuffix -lint,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-lint,%,$@) lint

# 子项目依赖安装规则
$(addsuffix -install,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-install,%,$@) install

# 单独构建子项目的快捷方式
$(SUBPROJECTS): %: %-build
