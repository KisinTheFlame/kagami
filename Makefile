# Kagami 项目主 Makefile

# 定义子项目
SUBPROJECTS = kagami-bot kagami-console-web kagami-console

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

.PHONY: all build clean lint up down status \
        $(SUBPROJECTS) $(addsuffix -build,$(SUBPROJECTS)) $(addsuffix -clean,$(SUBPROJECTS)) $(addsuffix -lint,$(SUBPROJECTS))

# 默认目标：构建所有项目
all: build

# 构建所有项目
build: $(addsuffix -build,$(SUBPROJECTS))

# 清理所有项目
clean: $(addsuffix -clean,$(SUBPROJECTS))

# Lint 所有项目
lint: $(addsuffix -lint,$(SUBPROJECTS))

# Docker 管理命令
up: build
	@echo "启动 Docker 服务"
	docker compose up -d --build

down:
	@echo "停止 Docker 服务"
	docker compose down

status:
	@echo "查看 Docker 服务状态"
	docker compose ps

# 子项目构建规则
$(addsuffix -build,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-build,%,$@) build

# 子项目清理规则
$(addsuffix -clean,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-clean,%,$@) clean

# 子项目 lint 规则
$(addsuffix -lint,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-lint,%,$@) lint

# 单独构建子项目的快捷方式
$(SUBPROJECTS): %: %-build