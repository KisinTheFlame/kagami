import { Client, ClientConfig } from "pg";

class Database {
    private db: Client | null = null;
    private isConnected = false;
    private readonly connectionConfig: ClientConfig;

    constructor() {
        this.connectionConfig = {
            host: process.env.DB_HOST ?? "localhost",
            port: 5432,
            database: process.env.DB_NAME ?? "kagami",
            user: process.env.DB_USER ?? "kagami",
            password: process.env.DB_PASSWORD ?? "kagami123",
        };
    }

    async initialize(): Promise<void> {
        if (this.db && this.isConnected) {
            return;
        }

        this.db = new Client(this.connectionConfig);

        try {
            await this.db.connect();
            this.isConnected = true;
        } catch (error) {
            await this.db.end();
            this.db = null;
            this.isConnected = false;
            throw error;
        }
    }

    async run(sql: string, params: unknown[] = []): Promise<void> {
        if (!this.db || !this.isConnected) {
            await this.initialize();
        }

        if (!this.db) {
            throw new Error("Database connection not available");
        }

        try {
            await this.db.query(sql, params);
        } catch (error) {
            throw new Error(`Failed to execute query: ${String(error)}`);
        }
    }

    async close(): Promise<void> {
        if (this.db && this.isConnected) {
            await this.db.end();
            this.db = null;
            this.isConnected = false;
        }
    }
}

export const db = new Database();
