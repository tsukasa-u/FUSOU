import { timingSafeEqual as compareBytes } from "node:crypto";

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && compareBytes(left, right);
}
