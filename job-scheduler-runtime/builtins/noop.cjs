/**
 * Built-in handler: `noop`
 *
 * The minimal smoke-test handler. Proves the full Bree worker-per-run path —
 * materialized file → forked worker → bootstrap → result back to the parent —
 * without touching the database or any platform service.
 */
'use strict';

async function execute(ctx) {
  const input = ctx.input !== undefined && ctx.input !== null ? JSON.stringify(ctx.input) : null;
  return {
    ok: true,
    handler: 'noop',
    trigger: ctx.trigger,
    hadInput: input !== null,
    actorId: ctx.actorId ?? null,
    at: new Date().toISOString(),
  };
}

module.exports = { execute };
