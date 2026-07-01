export interface ClaudeCodeAuthSecretStore {
  encode(value: string): Promise<string>;
  decode(value: string): Promise<string>;
}

export class PlainTextClaudeCodeAuthSecretStore implements ClaudeCodeAuthSecretStore {
  public async encode(value: string): Promise<string> {
    return value;
  }

  public async decode(value: string): Promise<string> {
    return value;
  }
}
