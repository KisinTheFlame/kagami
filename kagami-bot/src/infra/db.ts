import { PrismaClient } from "../generated/prisma/client.js";

export class Database {
    private prismaClient: PrismaClient;

    constructor() {
        // 从环境变量构建 DATABASE_URL
        const dbHost = process.env.DB_HOST ?? "localhost";
        const dbPort = process.env.DB_PORT ?? "5432";
        const dbName = process.env.DB_NAME ?? "kagami";
        const dbUser = process.env.DB_USER ?? "kagami";
        const dbPassword = process.env.DB_PASSWORD ?? "kagami123";

        const databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;

        this.prismaClient = new PrismaClient({
            datasources: {
                db: {
                    url: databaseUrl,
                },
            },
        });
    }

    prisma(): PrismaClient {
        return this.prismaClient;
    }
}

export const newDatabase = () => {
    const instance = new Database();
    return instance;
};
