import { createInterface } from 'node:readline';

// stdout is exclusively newline-delimited JSON; use stderr for diagnostics.
export function runPlugin(manifest, factory) {
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');
  let handlers;
  let queue = Promise.resolve();
  const ctx = {
    state: {}, config: {},
    publish: cards => send({ type: 'cards', cards }),
    save: state => { ctx.state = state; send({ type: 'state', state }); },
    log: message => process.stderr.write(String(message).slice(0,1000) + '\n'),
  };
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    queue = queue.then(async () => {
      let m;
      try {
        m = JSON.parse(line);
        if (m.type === 'init') {
          if (m.apiVersion !== manifest.apiVersion) throw new Error('Incompatible core');
          ctx.state = m.state ?? {}; ctx.config = m.config ?? {};
          handlers = await factory(ctx);
          send({ type: 'ready', apiVersion: manifest.apiVersion, id: manifest.id });
          await handlers.start?.();
        } else if (m.type === 'ping') send({ type: 'pong' });
        else if (m.type === 'request') {
          if (!handlers) throw new Error('Plugin not initialized');
          let result;
          if (m.method === 'action') result = await handlers.action?.(m.params);
          else if (m.method === 'event') result = await handlers.event?.(m.params);
          else if (m.method === 'configure') { ctx.config = m.params; result = await handlers.configure?.(m.params); }
          else throw new Error('Unknown method');
          send({ type: 'response', id: m.id, result: result ?? null });
        } else if (m.type === 'stop') { await handlers?.stop?.(); process.exit(0); }
      } catch (e) {
        if (m?.type === 'request') send({ type: 'response', id: m.id, error: e.message });
        else ctx.log(e.message);
      }
    });
  });
  lines.on('close', () => process.exit(0));
}
