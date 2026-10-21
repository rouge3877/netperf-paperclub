export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function check(
  condition: unknown,
  status: number,
  message: string,
  code?: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message, code);
}
export function text(
  value: unknown,
  label: string,
  max = 200,
  min = 1,
): string {
  check(typeof value === "string", 400, `${label} must be text.`);
  const result = value.trim();
  check(
    result.length >= min &&
      result.length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),
    400,
    `${label} must contain ${min}–${max} characters.`,
  );
  return result;
}
export function ids(value: unknown): string[] {
  check(
    Array.isArray(value) &&
      value.length <= 5000 &&
      value.every((x) => typeof x === "string" && x.length <= 100),
    400,
    "Choose valid paper IDs.",
  );
  return [...new Set(value as string[])];
}
export function flag(value: unknown, label: string): boolean {
  check(typeof value === "boolean", 400, `${label} must be true or false.`);
  return value;
}
