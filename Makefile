# Kagami 项目主 Makefile

# 定义子项目
SUBPROJECTS = kagami-bot kagami-console-web kagami-console

.PHONY: all build clean $(SUBPROJECTS) $(addsuffix -build,$(SUBPROJECTS)) $(addsuffix -clean,$(SUBPROJECTS))

# 默认目标：构建所有项目
all: build

# 构建所有项目
build: $(addsuffix -build,$(SUBPROJECTS))

# 清理所有项目
clean: $(addsuffix -clean,$(SUBPROJECTS))

# 子项目构建规则
$(addsuffix -build,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-build,%,$@) build

# 子项目清理规则
$(addsuffix -clean,$(SUBPROJECTS)):
	$(MAKE) -C $(patsubst %-clean,%,$@) clean

# 单独构建子项目的快捷方式
$(SUBPROJECTS): %: %-build