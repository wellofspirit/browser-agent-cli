export interface CommandRequest {
  command: string;
  args: Record<string, unknown>;
}

export interface CommandResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export const DEFAULT_PORT = 9421;
export const DEFAULT_CDP_URL = "http://localhost:9222";
