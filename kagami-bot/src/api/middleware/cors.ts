import cors from "cors";
import { CorsConfig } from "../../config_manager.js";

export const createCorsMiddleware = (config: CorsConfig) => {
    return cors({
        origin: config.allowed_origins,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    });
};
