/**
 * 时区工具函数
 * 用于处理 Asia/Shanghai 时区的时间戳格式化
 */

/**
 * 获取当前 Asia/Shanghai 时区的时间戳字符串
 * @returns 格式为 "YYYY-MM-DD HH:mm:ss" 的时间戳字符串
 */
export function getShanghaiTimestamp(): string {
    const now = new Date();

    // 计算 UTC+8 时区的时间
    // getTimezoneOffset() 返回的是分钟数，且与实际时区相反
    // 例如对于 UTC+8，getTimezoneOffset() 通常返回 -480（-8 * 60）
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const shanghaiTime = new Date(utcTime + (8 * 3600000)); // UTC+8

    // 格式化为 YYYY-MM-DD HH:mm:ss
    const year = shanghaiTime.getFullYear();
    const month = String(shanghaiTime.getMonth() + 1).padStart(2, "0");
    const day = String(shanghaiTime.getDate()).padStart(2, "0");
    const hours = String(shanghaiTime.getHours()).padStart(2, "0");
    const minutes = String(shanghaiTime.getMinutes()).padStart(2, "0");
    const seconds = String(shanghaiTime.getSeconds()).padStart(2, "0");

    return `${String(year)}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取指定 Date 对象在 Asia/Shanghai 时区的时间戳字符串
 * @param date 要转换的 Date 对象
 * @returns 格式为 "YYYY-MM-DD HH:mm:ss" 的时间戳字符串
 */
export function formatShanghaiTimestamp(date: Date): string {
    // 计算 UTC+8 时区的时间
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const shanghaiTime = new Date(utcTime + (8 * 3600000)); // UTC+8

    // 格式化为 YYYY-MM-DD HH:mm:ss
    const year = shanghaiTime.getFullYear();
    const month = String(shanghaiTime.getMonth() + 1).padStart(2, "0");
    const day = String(shanghaiTime.getDate()).padStart(2, "0");
    const hours = String(shanghaiTime.getHours()).padStart(2, "0");
    const minutes = String(shanghaiTime.getMinutes()).padStart(2, "0");
    const seconds = String(shanghaiTime.getSeconds()).padStart(2, "0");

    return `${String(year)}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
