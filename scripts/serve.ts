import { join } from "node:path";

const dist = join(import.meta.dir, "../dist");
const build = Bun.spawnSync(["bun", join(import.meta.dir, "build.ts")], { stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) process.exit(build.exitCode);

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(dist, path.endsWith("/") ? `${path}index.html` : path));
    if (!path.includes("..") && (await file.exists())) return new Response(file);
    return new Response(Bun.file(join(dist, "404.html")), { status: 404 });
  },
});
console.log(`dev server: http://localhost:${server.port}/`);
