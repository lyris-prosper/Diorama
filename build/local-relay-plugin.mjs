import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { ProxyAgent, fetch } from 'undici';
import getRawBody from 'raw-body';
// The local Worker runtime cannot use an HTTP proxy, and some provider hosts are unreachable
// without one on this network. Provider calls made by the Worker go through this loopback-only
// relay, which uses the shell's HTTPS_PROXY or else the macOS system proxy.
const ALLOWED = ['worldlabs.ai', 'tripo3d.ai', 'tripo3d.com'];
const allowed = (host) => ALLOWED.some((d) => host === d || host.endsWith('.' + d));
function proxyUrl() {
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (env) return env;
  if (process.platform !== 'darwin') return undefined;
  try {
    const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf8' });
    const v = (k) => new RegExp(`${k}\\s*:\\s*(\\S+)`).exec(out)?.[1];
    if (v('HTTPSEnable') === '1' && v('HTTPSProxy')) return `http://${v('HTTPSProxy')}:${v('HTTPSPort') || 80}`;
  } catch {}
  return undefined;
}
const SKIP = new Set(['host', 'connection', 'content-length', 'x-relay-url', 'accept-encoding', 'transfer-encoding', 'keep-alive']);
export function localRelay() {
  let agent, agentFor;
  const dispatcher = () => {
    const url = proxyUrl();
    if (url !== agentFor) {
      agentFor = url;
      agent = url ? new ProxyAgent(url) : undefined;
    }
    return agent;
  };
  return {
    name: 'room-local-relay',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/api/local/relay') return next();
        const fail = (status, error) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error }));
        };
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') || req.headers.origin) return fail(403, '仅允许本机服务调用。');
        let target;
        try {
          target = new URL(String(req.headers['x-relay-url']));
        } catch {
          return fail(400, '缺少目标地址。');
        }
        if (target.protocol !== 'https:' || !allowed(target.hostname)) return fail(403, '目标地址不在允许范围内。');
        try {
          const headers = {};
          for (const [k, v] of Object.entries(req.headers)) if (!SKIP.has(k) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
          const body = ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : await getRawBody(req, { limit: '40mb' });
          const upstream = await fetch(target, { method: req.method, headers, body, dispatcher: dispatcher(), signal: AbortSignal.timeout(300000) });
          res.statusCode = upstream.status;
          // fetch() already decoded any compressed body, so its encoding and length no longer apply.
          const decoded = upstream.headers.has('content-encoding');
          upstream.headers.forEach((value, key) => {
            if (['content-encoding', 'transfer-encoding', 'connection'].includes(key) || (decoded && key === 'content-length')) return;
            res.setHeader(key, value);
          });
          if (!upstream.body) return res.end();
          Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
        } catch (e) {
          fail(502, `网络请求失败：${e.name === 'TimeoutError' ? '超时' : e.message}`);
        }
      });
    },
  };
}
