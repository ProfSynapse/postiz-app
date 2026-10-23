// Mastra uses the SDK's low-level Server and performs its own Zod validation;
// the high-level McpServer maxToolInputElements option does not cover it.
// Bound the parsed request before either implementation validates arguments.
export const MCP_MAX_BODY_BYTES = 100 * 1024;
export const MCP_MAX_INPUT_ELEMENTS = 10_000;
export const MCP_MAX_INPUT_DEPTH = 64;

export function isMcpInputWithinLimits(body: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: body, depth: 0 }];
  let elements = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > MCP_MAX_INPUT_DEPTH) return false;
    if (value === null || typeof value !== 'object') continue;
    const values = Object.values(value);
    elements += values.length;
    if (elements > MCP_MAX_INPUT_ELEMENTS) return false;
    for (const child of values) pending.push({ value: child, depth: depth + 1 });
  }
  return true;
}
