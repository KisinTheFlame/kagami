import { PrismaClient } from "../generated/prisma/client.js";

export class Database {
    private prisma: PrismaClient;

    constructor() {
        // 从环境变量构建 DATABASE_URL
        const dbHost = process.env.DB_HOST ?? "localhost";
        const dbPort = process.env.DB_PORT ?? "5432";
        const dbName = process.env.DB_NAME ?? "kagami";
        const dbUser = process.env.DB_USER ?? "kagami";
        const dbPassword = process.env.DB_PASSWORD ?? "kagami123";

        const databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;

        this.prisma = new PrismaClient({
            datasources: {
                db: {
                    url: databaseUrl,
                },
            },
        });
    }

    async logLLMCall(
        status: "success" | "fail",
        input: string,
        output: string,
    ): Promise<void> {
        try {
            await this.prisma.llmCallLog.create({
                data: {
                    status,
                    input,
                    output,
                },
            });
        } catch (error) {
            throw new Error(`Failed to log LLM call: ${String(error)}`);
        }
    }
}

export const newDatabase = () => {
    const instance = new Database();
    return instance;
};
