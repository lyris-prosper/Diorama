import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import getRawBody from 'raw-body';
import { availableMB } from './local-vision-plugin.mjs';
// Generated models are slimmed on this machine before the room loads them: a high-detail Tripo export
// holds 2 M triangles and 8K textures (about 90 MB) that the browser neither needs nor raycasts quickly. The work runs
// in a child process (scripts/optimize-glb.mjs), so its memory leaves with it. Loopback only; the
// Worker posts the GLB and stores what comes back next to the original.
const NEEDED_MB = 1100; // measured peaks: 42 MB bed with 2K textures about 430 MB; 90 MB cushion with 8K textures 1.07 GB (5 s)
export function localModel() {
  let busy = false;
  return {
    name: 'room-local-model',
    configureServer(server) {
      const script = path.join(server.config.root, 'scripts/optimize-glb.mjs');
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== '/api/local/optimize-glb') return next();
        const fail = (status, error) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error }));
        };
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') || req.headers.origin) return fail(403, '仅限本机的服务端调用。');
        if (req.method !== 'POST') return fail(405, '不支持此操作。');
        if (busy) return fail(409, '正在压缩另一个模型。');
        if (availableMB() < NEEDED_MB) return fail(503, '可用内存不足，先保留原模型。');
        busy = true;
        const dir = mkdtempSync(path.join(tmpdir(), 'room-glb-'));
        try {
          const body = await getRawBody(req, { limit: '260mb' });
          if (body.length < 12 || body.readUInt32LE(0) !== 0x46546c67) return fail(400, '不是 GLB 模型。');
          const input = path.join(dir, 'in.glb'), output = path.join(dir, 'out.glb');
          writeFileSync(input, body);
          const stats = await new Promise((resolve, reject) =>
            execFile(process.execPath, [script, input, output, url.searchParams.get('size') || ''], { timeout: 180000, maxBuffer: 1 << 20 }, (e, stdout) =>
              e ? reject(e) : resolve(JSON.parse(stdout)),
            ),
          );
          res.statusCode = 200;
          res.setHeader('Content-Type', 'model/gltf-binary');
          res.setHeader('X-Triangles', `${stats.before}->${stats.after}`);
          res.end(readFileSync(output));
        } catch (e) {
          fail(500, `模型压缩失败：${e.message}`);
        } finally {
          busy = false;
          rmSync(dir, { recursive: true, force: true });
        }
      });
    },
  };
}
