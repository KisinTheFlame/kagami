export type LlmCallStatus = "success" | "fail";

export class LlmCallLog {
    readonly id: number;
    readonly timestamp: Date;
    readonly status: LlmCallStatus;
    readonly input: string;
    readonly output: string;

    constructor(
        id: number,
        timestamp: Date,
        status: LlmCallStatus,
        input: string,
        output: string,
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.status = status;
        this.input = input;
        this.output = output;
    }
}
