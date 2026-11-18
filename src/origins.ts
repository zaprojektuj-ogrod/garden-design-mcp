// Who may connect to the editor socket (B77): the garden editor's own pages only.
// A browser always sends the page's Origin, so a website open beside the editor is told apart
// and refused. A local process (an eval harness, a test script) sends none and is let in:
// it already runs on the designer's computer.

const EDITOR_ORIGINS = new Set([
  "https://3dview.zaprojektuj-ogrod.pl",
  "https://zaprojektuj-ogrod-viewer-3d.onrender.com",
]);

// A dev server on this computer, at any port
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function mayConnect(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (EDITOR_ORIGINS.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return (protocol === "http:" || protocol === "https:") && LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false; // "null" (a file or sandboxed page) and anything unreadable
  }
}
