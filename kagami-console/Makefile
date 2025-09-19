# kagami-console Makefile

# 定义变量
BINARY_NAME = kagami-console
OUTPUT_DIR = bin
CMD_DIR = cmd/api

.PHONY: all build clean lint install

# 默认目标
all: build

# 构建项目
build:
	@echo "构建 kagami-console..."
	@mkdir -p $(OUTPUT_DIR)
	go build -o $(OUTPUT_DIR)/$(BINARY_NAME) ./$(CMD_DIR)

# 安装依赖（Go 模块）
install:
	@echo "安装 kagami-console 依赖..."
	go mod download

# 清理项目
clean:
	@echo "清理 kagami-console..."
	rm -rf $(OUTPUT_DIR)/

# Lint 项目
lint:
	@echo "Linting kagami-console..."
	go vet ./...
	golangci-lint run
