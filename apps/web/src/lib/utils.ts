import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 按 Unicode 码点截断，绝不从代理对（emoji）中间切开——裸 `.slice()` 会让预览里出现半个字符
 * （渲染成方块）。
 *
 * 这是全仓唯一不复用 `@kagami/kernel/utils/text` 正典的截断点：kernel 是后端包，前端不依赖它，
 * 为一个函数把它拖进浏览器包会破坏包边界（还会把 @types/node 带进来）。逻辑等价、刻意各留一份。
 */
export function truncateText(value: string, maxLength: number): string {
  const codePoints = Array.from(value); // 字符串迭代器按码点拆分，emoji 是单个元素
  if (codePoints.length <= maxLength) {
    return value;
  }

  return `${codePoints.slice(0, maxLength).join("")}...`;
}
