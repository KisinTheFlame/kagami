// import React from 'react';
import { ConfigProvider, Layout, Typography, theme } from "antd";
import LLMLogsTable from "./components/LLMLogsTable";
import "./App.css";

const { Header, Content } = Layout;
const { Title } = Typography;

function App() {
    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
            }}
        >
            <Layout style={{ minHeight: "100vh" }}>
                <Header style={{ 
                    background: "#001529",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 24,
                }}>
                    <Title level={3} style={{ color: "white", margin: 0 }}>
                        Kagami Console
                    </Title>
                </Header>
                <Content style={{ padding: "16px" }}>
                    <LLMLogsTable />
                </Content>
            </Layout>
        </ConfigProvider>
    );
}

export default App;
