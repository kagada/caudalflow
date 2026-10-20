export function decodeBase64(value: string): Uint8Array;
export function encodeBase64(value: Uint8Array | number[]): string;
export function utf8Length(value: string): number;
export function workspaceHistoryKey(id: string): Promise<string>;
