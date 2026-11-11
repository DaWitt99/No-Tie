export function fileFingerprint(bytes: Uint8Array): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193)
    second = Math.imul(second ^ byte, 0x85ebca6b)
  }
  return `${bytes.byteLength}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`
}
