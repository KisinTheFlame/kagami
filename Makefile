# Kagami 项目 Makefile

# 定义项目路径
BOT_DIR = kagami-bot
CONSOLE_WEB_DIR = kagami-console-web
CONSOLE_DIR = kagami-console

# 定义输出目录
BOT_DIST = $(BOT_DIR)/dist
CONSOLE_WEB_DIST = $(CONSOLE_WEB_DIR)/dist
CONSOLE_BIN = $(CONSOLE_DIR)/bin

.PHONY: all build clean build-bot build-console-web build-console clean-bot clean-console-web clean-console

# 默认目标：构建所有项目
all: build

# 构建所有项目
build: build-bot build-console-web build-console

# 清理所有项目
clean: clean-bot clean-console-web clean-console

# 构建 kagami-bot
build-bot:
	@echo "构建 kagami-bot..."
	cd $(BOT_DIR) && npm install && npm run build

# 构建 kagami-console-web
build-console-web:
	@echo "构建 kagami-console-web..."
	cd $(CONSOLE_WEB_DIR) && npm install && npm run build

# 构建 kagami-console
build-console:
	@echo "构建 kagami-console..."
	cd $(CONSOLE_DIR) && mkdir -p bin && go build -o bin/api ./cmd/api

# 清理 kagami-bot
clean-bot:
	@echo "清理 kagami-bot..."
	rm -rf $(BOT_DIST)

# 清理 kagami-console-web
clean-console-web:
	@echo "清理 kagami-console-web..."
	rm -rf $(CONSOLE_WEB_DIST)

# 清理 kagami-console
clean-console:
	@echo "清理 kagami-console..."
	rm -rf $(CONSOLE_BIN)