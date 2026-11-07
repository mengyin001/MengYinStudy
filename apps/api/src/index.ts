import { createApp, type ExecutionContextLike } from './app';
import type { Env } from './env';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

export { createApp };
export type { Env };
