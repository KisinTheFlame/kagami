import express, { Express, Router } from "express";
import { createCorsMiddleware } from "./middleware/cors.js";
import { HttpConfig } from "../config_manager.js";

export const createHttpServer = async (llmLogsRouter: Router, httpConfig: HttpConfig): Promise<Express> => {
    const app = express();

    app.use(createCorsMiddleware(httpConfig.cors));
    app.use(express.json());

    app.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    app.use("/api/v1/llm-logs", llmLogsRouter);


    return new Promise<Express>(resolve => {
        app.listen(httpConfig.port, () => {
            resolve(app);
        });
    });
};
