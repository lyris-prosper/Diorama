// The Worker behind the dev server: every request goes to vinext's app router (app/).
import handler from "vinext/server/fetch-handler";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return handler.fetch(request, env, ctx);
  },
};
