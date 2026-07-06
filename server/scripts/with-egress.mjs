/**
 * Launch wrapper that makes Node's built-in `fetch` work behind an HTTPS egress
 * proxy that re-terminates TLS — the Perplexity/Anthropic calls go out that way
 * in sandboxed/hosted environments (Claude Code, corporate proxies).
 *
 * It injects two Node flags into NODE_OPTIONS before spawning the real command:
 *   --use-env-proxy   honor HTTPS_PROXY/HTTP_PROXY for built-in fetch (Node's
 *                     fetch ignores them otherwise, and the env var must be set
 *                     at process start — too late to do from inside the app).
 *   --use-system-ca   trust the OS certificate store, where such proxies install
 *                     their CA, so TLS verifies without a hardcoded bundle path.
 *
 * Both are harmless with no proxy present (fetch goes direct, system CAs are the
 * normal roots). Flags this Node build doesn't recognize are dropped, so it is a
 * no-op on older Node instead of failing to boot. Any existing NODE_OPTIONS is
 * preserved. Usage: `node scripts/with-egress.mjs <cmd> [args...]`.
 */
import { spawn } from "node:child_process";

const wanted = ["--use-env-proxy", "--use-system-ca"];
const supported = wanted.filter((f) => process.allowedNodeEnvironmentFlags.has(f));

const existing = process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS.split(/\s+/).filter(Boolean) : [];
const nodeOptions = [...new Set([...existing, ...supported])].join(" ");

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("with-egress: no command given");
  process.exit(1);
}

const child = spawn(cmd, args, {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  shell: process.platform === "win32", // resolve tsx/.cmd shims on Windows
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error(`with-egress: failed to launch "${cmd}":`, err.message);
  process.exit(1);
});
