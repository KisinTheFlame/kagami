import React, { useState, useEffect, useCallback } from "react";
import { 
    Table, 
    Tag, 
    Space, 
    Button, 
    DatePicker, 
    Select, 
    Card, 
    message,
    Modal,
    Typography,
    Row,
    Col,
    Pagination,
    Alert,
} from "antd";
import { ReloadOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import type { LLMCallLog, LogQueryParams } from "../types/api";
import { llmLogsApi } from "../services/api";
import MessageCard from "./MessageCard";

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;

const LLMLogsTable: React.FC = () => {
    const [logs, setLogs] = useState<LLMCallLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    const [current, setCurrent] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    // 筛选参数
    const [statusFilter, setStatusFilter] = useState<"success" | "fail" | undefined>();
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
    const [orderDirection, setOrderDirection] = useState<"asc" | "desc">("desc");

    // 详情模态框
    const [detailVisible, setDetailVisible] = useState(false);
    const [selectedLog, setSelectedLog] = useState<LLMCallLog | null>(null);

    // 响应式屏幕宽度检测
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const isMobile = windowWidth < 768;

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params: LogQueryParams = {
                page: current,
                limit: pageSize,
                orderBy: "timestamp",
                orderDirection: orderDirection,
            };

            if (statusFilter) {
                params.status = statusFilter;
            }

            if (dateRange) {
                params.startTime = dateRange[0].toISOString();
                params.endTime = dateRange[1].toISOString();
            }

            const response = await llmLogsApi.getLogs(params);
            setLogs(response.data);
            setTotal(response.total);
        } catch (error) {
            message.error("获取数据失败");
            console.error("Failed to fetch logs:", error);
        } finally {
            setLoading(false);
        }
    }, [current, pageSize, statusFilter, dateRange, orderDirection]);

    useEffect(() => {
        void fetchLogs();
    }, [fetchLogs]);

    // 监听窗口大小变化
    useEffect(() => {
        const handleResize = () => {
            setWindowWidth(window.innerWidth);
        };

        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    const handleViewDetail = (record: LLMCallLog) => {
        setSelectedLog(record);
        setDetailVisible(true);
    };

    const handleReset = () => {
        setStatusFilter(undefined);
        setDateRange(null);
        setOrderDirection("desc");
        setCurrent(1);
    };

    const allColumns = [
        {
            title: "ID",
            dataIndex: "id",
            key: "id",
            width: 80,
        },
        {
            title: "时间",
            dataIndex: "timestamp",
            key: "timestamp",
            width: isMobile ? 120 : 180,
            sorter: true,
            sortOrder: orderDirection === "desc" ? ("descend" as const) : ("ascend" as const),
            render: (timestamp: string) => dayjs(timestamp).format(isMobile ? "MM-DD HH:mm" : "YYYY-MM-DD HH:mm:ss"),
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: isMobile ? 80 : 100,
            render: (status: string) => (
                <Tag color={status === "success" ? "green" : "red"}>
                    {status === "success" ? "成功" : "失败"}
                </Tag>
            ),
        },
        {
            title: "输入",
            dataIndex: "input",
            key: "input",
            ellipsis: true,
            render: (input: string) => (
                <Text ellipsis style={{ maxWidth: 300 }}>
                    {input}
                </Text>
            ),
        },
        {
            title: "输出",
            dataIndex: "output",
            key: "output",
            ellipsis: true,
            render: (output: string) => (
                <Text ellipsis style={{ maxWidth: 300 }}>
                    {output}
                </Text>
            ),
        },
        {
            title: "操作",
            key: "action",
            width: isMobile ? 80 : 120,
            render: (_: unknown, record: LLMCallLog) => (
                <Space size="middle">
                    <Button
                        type="link"
                        icon={<EyeOutlined />}
                        onClick={() => { handleViewDetail(record); }}
                        size={isMobile ? "small" : "middle"}
                    >
                        {isMobile ? "" : "详情"}
                    </Button>
                </Space>
            ),
        },
    ];

    // 移动端只显示时间、状态、操作三列
    const columns = isMobile
        ? allColumns.filter(col => ["timestamp", "status", "action"].includes(col.key))
        : allColumns;

    return (
        <Card title="LLM 调用历史">
            {/* 筛选条件 */}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                    <Select
                        placeholder="筛选状态"
                        allowClear
                        value={statusFilter}
                        onChange={setStatusFilter}
                        style={{ width: "100%" }}
                    >
                        <Option value="success">成功</Option>
                        <Option value="fail">失败</Option>
                    </Select>
                </Col>
                <Col xs={24} sm={12} md={8}>
                    <RangePicker
                        showTime
                        format="YYYY-MM-DD HH:mm:ss"
                        placeholder={["开始时间", "结束时间"]}
                        value={dateRange}
                        onChange={dates => { setDateRange(dates as [Dayjs, Dayjs] | null); }}
                        style={{ width: "100%" }}
                    />
                </Col>
                <Col xs={24} sm={24} md={12}>
                    <Space style={{ width: "100%" }}>
                        <Button onClick={() => { void fetchLogs(); }} icon={<ReloadOutlined />}>
                            刷新
                        </Button>
                        <Button onClick={handleReset}>
                            重置
                        </Button>
                    </Space>
                </Col>
            </Row>

            {/* 数据表格 */}
            <Table
                columns={columns}
                dataSource={logs}
                rowKey="id"
                loading={loading}
                pagination={false}
                size="small"
                scroll={{ x: "max-content" }}
                onChange={(_pagination, _filters, sorter) => {
                    if (!Array.isArray(sorter) && sorter.columnKey === "timestamp" && sorter.order) {
                        const newDirection = sorter.order === "descend" ? "desc" : "asc";
                        setOrderDirection(newDirection);
                    }
                }}
            />

            {/* 分页 */}
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                <Pagination
                    current={current}
                    pageSize={pageSize}
                    total={total}
                    simple={isMobile}
                    showSizeChanger={!isMobile}
                    showQuickJumper={!isMobile}
                    showTotal={isMobile ? undefined : (total, range) => `第 ${String(range[0])}-${String(range[1])} 条，共 ${String(total)} 条`}
                    onChange={setCurrent}
                    onShowSizeChange={isMobile ? undefined : (current, size) => {
                        setCurrent(current);
                        setPageSize(size);
                    }}
                />
            </div>

            {/* 详情模态框 */}
            <Modal
                title={`调用详情 - ID: ${String(selectedLog?.id ?? "")}`}
                open={detailVisible}
                onCancel={() => { setDetailVisible(false); }}
                footer={[
                    <Button key="close" onClick={() => { setDetailVisible(false); }}>
                        关闭
                    </Button>,
                ]}
                width={800}
            >
                {selectedLog && (
                    <div>
                        <Row gutter={16} style={{ marginBottom: 16 }}>
                            <Col span={12}>
                                <Text strong>时间：</Text>
                                <div>{dayjs(selectedLog.timestamp).format("YYYY-MM-DD HH:mm:ss")}</div>
                            </Col>
                            <Col span={12}>
                                <Text strong>状态：</Text>
                                <div>
                                    <Tag color={selectedLog.status === "success" ? "green" : "red"}>
                                        {selectedLog.status === "success" ? "成功" : "失败"}
                                    </Tag>
                                </div>
                            </Col>
                        </Row>
                        <div style={{ marginBottom: 16 }}>
                            <Text strong>输入：</Text>
                            <div style={{ marginTop: 8 }}>
                                {(() => {
                                    try {
                                        const messages = JSON.parse(selectedLog.input) as unknown[];
                                        if (Array.isArray(messages)) {
                                            return messages.map((message: unknown, index) => (
                                                <MessageCard 
                                                    key={index} 
                                                    message={message as { role: "user" | "assistant" | "system"; content: string | object }} 
                                                    index={index}
                                                />
                                            ));
                                        } else {
                                            return (
                                                <Alert
                                                    message="数据格式错误"
                                                    description="输入数据不是预期的数组格式"
                                                    type="warning"
                                                    showIcon
                                                    style={{ marginBottom: 12 }}
                                                />
                                            );
                                        }
                                    } catch {
                                        return (
                                            <>
                                                <Alert
                                                    message="JSON解析失败"
                                                    description="无法解析输入数据，显示原始内容"
                                                    type="warning"
                                                    showIcon
                                                    style={{ marginBottom: 12 }}
                                                />
                                                <Card style={{
                                                    padding: 12, 
                                                    borderRadius: 6,
                                                    whiteSpace: "pre-wrap",
                                                }}>
                                                    {selectedLog.input}
                                                </Card>
                                            </>
                                        );
                                    }
                                })()}
                            </div>
                        </div>
                        <div>
                            <Text strong>输出：</Text>
                            <Card style={{
                                padding: 12, 
                                borderRadius: 6, 
                                marginTop: 8,
                                whiteSpace: "pre-wrap",
                            }}>
                                {selectedLog.output}
                            </Card>
                        </div>
                    </div>
                )}
            </Modal>
        </Card>
    );
};

export default LLMLogsTable;
