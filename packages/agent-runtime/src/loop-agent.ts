export interface LoopAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
}
