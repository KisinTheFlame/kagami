import React from "react";
import { Card, Tag, Typography, Alert } from "antd";

const { Text } = Typography;

interface MessageItem {
    role: string;
    content: unknown;
}


interface MessageCardProps {
    message: MessageItem | null;
    index: number;
}

const MessageCard: React.FC<MessageCardProps> = ({ message, index }) => {
    // 验证消息对象结构
    if (!message?.role) {
        return (
            <Card
                size="small"
                style={{ 
                    marginBottom: 16,
                    backgroundColor: "#141414",
                    borderColor: "#434343",
                }}
                title={`消息 ${String(index + 1)}`}
            >
                <Alert
                    message="数据错误"
                    description="消息对象格式无效"
                    type="error"
                    showIcon
                />
            </Card>
        );
    }

    const getRoleColor = (role: string): string => {
        switch (role) {
            case "user":
                return "blue";
            case "assistant":
                return "green";
            case "system":
                return "orange";
            default:
                return "default";
        }
    };

    const getRoleText = (role: string): string => {
        switch (role) {
            case "user":
                return "用户";
            case "assistant":
                return "助手";
            case "system":
                return "系统";
            default:
                return role || "未知";
        }
    };

    const renderContent = (content: unknown) => {
        // 处理 null 或 undefined 内容
        if (content == null) {
            return (
                <Alert
                    message="内容为空"
                    description="此消息没有内容"
                    type="info"
                    showIcon
                />
            );
        }

        if (typeof content === "object") {
            try {
                return (
                    <pre style={{
                        background: "#1f1f1f",
                        color: "#e1e4e8",
                        padding: "16px",
                        borderRadius: "8px",
                        margin: 0,
                        fontSize: "13px",
                        lineHeight: "1.5",
                        overflow: "auto",
                        fontFamily: "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Monaco, monospace",
                        border: "1px solid #30363d",
                        maxHeight: "400px",
                    }}>
                        {JSON.stringify(content, null, 2)}
                    </pre>
                );
            } catch {
                return (
                    <Alert
                        message="JSON序列化失败"
                        description="无法序列化对象内容"
                        type="error"
                        showIcon
                    />
                );
            }
        } else {
            return (
                <pre style={{
                    background: "#0d1117",
                    color: "#c9d1d9",
                    padding: "16px",
                    borderRadius: "8px",
                    margin: 0,
                    fontSize: "13px",
                    lineHeight: "1.5",
                    overflow: "auto",
                    fontFamily: "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Monaco, monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: "1px solid #21262d",
                    maxHeight: "400px",
                }}>
                    {typeof content === "string" ? content : JSON.stringify(content)}
                </pre>
            );
        }
    };

    return (
        <Card
            size="small"
            style={{ 
                marginBottom: 16,
                backgroundColor: "#141414",
                borderColor: "#434343",
            }}
            title={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text strong style={{ color: "#ffffff" }}>消息 {String(index + 1)}</Text>
                    <Tag color={getRoleColor(message.role)} style={{ fontWeight: 500 }}>
                        {getRoleText(message.role)}
                    </Tag>
                </div>
            }
            styles={{
                header: {
                    backgroundColor: "#262626",
                    borderBottomColor: "#434343",
                },
            }}
        >
            {renderContent(message.content)}
        </Card>
    );
};

export default MessageCard;
