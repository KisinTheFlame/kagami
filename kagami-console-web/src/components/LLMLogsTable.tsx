import React, { useState, useEffect } from "react";
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
} from "antd";
import { ReloadOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import type { LLMCallLog, LogQueryParams } from "../types/api";
import { llmLogsApi } from "../services/api";

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

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params: LogQueryParams = {
                page: current,
                limit: pageSize,
                order_by: "timestamp",
                order_direction: orderDirection,
            };

            if (statusFilter) {
                params.status = statusFilter;
            }

            if (dateRange) {
                params.start_time = dateRange[0].toISOString();
                params.end_time = dateRange[1].toISOString();
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
    };

    useEffect(() => {
        fetchLogs();
    }, [current, pageSize, statusFilter, dateRange, orderDirection]);

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

    const columns = [
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
            width: 180,
            render: (timestamp: string) => dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss"),
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 100,
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
            width: 120,
            render: (_: any, record: LLMCallLog) => (
                <Space size="middle">
                    <Button 
                        type="link" 
                        icon={<EyeOutlined />} 
                        onClick={() => { handleViewDetail(record); }}
                    >
                        详情
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <Card title="LLM 调用历史">
            {/* 筛选条件 */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}>
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
                <Col span={8}>
                    <RangePicker
                        showTime
                        format="YYYY-MM-DD HH:mm:ss"
                        placeholder={["开始时间", "结束时间"]}
                        value={dateRange}
                        onChange={dates => { setDateRange(dates as [Dayjs, Dayjs] | null); }}
                        style={{ width: "100%" }}
                    />
                </Col>
                <Col span={4}>
                    <Select
                        value={orderDirection}
                        onChange={setOrderDirection}
                        style={{ width: "100%" }}
                    >
                        <Option value="desc">时间降序</Option>
                        <Option value="asc">时间升序</Option>
                    </Select>
                </Col>
                <Col span={6}>
                    <Space>
                        <Button onClick={fetchLogs} icon={<ReloadOutlined />}>
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
            />

            {/* 分页 */}
            <div style={{ marginTop: 16, textAlign: "right" }}>
                <Pagination
                    current={current}
                    pageSize={pageSize}
                    total={total}
                    showSizeChanger
                    showQuickJumper
                    showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`}
                    onChange={setCurrent}
                    onShowSizeChange={(current, size) => {
                        setCurrent(current);
                        setPageSize(size);
                    }}
                />
            </div>

            {/* 详情模态框 */}
            <Modal
                title={`调用详情 - ID: ${selectedLog?.id}`}
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
                            <Card style={{
                                padding: 12, 
                                borderRadius: 6, 
                                marginTop: 8,
                                whiteSpace: "pre-wrap",
                            }}>
                                {selectedLog.input}
                            </Card>
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
