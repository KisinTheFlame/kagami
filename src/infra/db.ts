import sqlite3 from "sqlite3";
import { promises as fs } from "fs";
import path from "path";

class Database {
    private db: sqlite3.Database | null = null;
    private readonly dbPath: string;
    private readonly initScriptPath: string;

    constructor() {
        this.dbPath = path.join(process.cwd(), "data", "kagami.db");
        this.initScriptPath = path.join(process.cwd(), "scripts", "init.sql");
    }

    async initialize(): Promise<void> {
        if (this.db) {
            return;
        }

        const dataDir = path.dirname(this.dbPath);
        await fs.mkdir(dataDir, { recursive: true });

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, err => {
                if (err) {
                    reject(err);
                    return;
                }

                this.runInitScript()
                    .then(() => { resolve(); })
                    .catch((initErr: unknown) => { reject(new Error(String(initErr))); });
            });
        });
    }

    private async runInitScript(): Promise<void> {
        if (!this.db) {
            throw new Error("Database not initialized");
        }

        const initSQL = await fs.readFile(this.initScriptPath, "utf-8");
        
        return new Promise((resolve, reject) => {
            if (!this.db) {
                throw new Error("Database not initialized");
            }
            
            this.db.exec(initSQL, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async run(sql: string, params: unknown[] = []): Promise<void> {
        if (!this.db) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            if (!this.db) {
                throw new Error("Database not initialized");
            }
            
            this.db.run(sql, params, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

export const db = new Database();
