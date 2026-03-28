export interface CodexAuthSecretStore {
  encode(value: string): Promise<string>;
  decode(value: string): Promise<string>;
}

export class PlainTextCodexAuthSecretStore implements CodexAuthSecretStore {
  public async encode(value: string): Promise<string> {
    return value;
  }

  public async decode(value: string): Promise<string> {
    return value;
  }
}
