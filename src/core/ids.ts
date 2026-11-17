// crypto.randomUUID is unavailable in insecure contexts (e.g. an iPad hitting
// the dev server over LAN http), but getRandomValues works everywhere.
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
