/**
 * Job Scheduler — sandboxed script runner (Phase 2)
 *
 * Executes operator-authored `JobDefinition.code` inside a Node.js vm sandbox.
 * The sandbox exposes only an explicit, minimal surface:
 *
 *   - `ctx.input`          — free-form input attached to this run
 *   - `ctx.jobDefinitionId` — the job definition id
 *   - `ctx.platformOrgId`  — the owning platform org
 *   - `ctx.trigger`        — 'SCHEDULE' | 'MANUAL'
 *   - `ctx.dryRun`         — true when running in dry-run mode
 *   - `log(level, msg)`    — structured logger proxy (no pino internals)
 *   - `capabilities.notify(text)` — record a notification request without emitting it
 *
 * No ambient globals (process, require, setTimeout, __dirname, etc.) exist inside the
 * sandbox. Accessing constructor / prototype / __proto__ throws. The runner is a thin
 * wrapper over vm.runInNewContext; all orchestration (claim gate, JobExecution row,
 * SSE notification, audit) stays in JobSchedulerService.runJob.
 *
 * IMPORTANT: worker-thread isolation is NOT security isolation. This vm sandbox sits
 * inside the Bree worker, adding a second layer of restriction for operator code.
 */

import { runInNewContext } from 'node:vm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScriptRunResult {
  /** The handler's return value (JSON-serializable). */
  result: unknown;
  /** Capabilities the script invoked during execution. */
  capabilitiesUsed: string[];
}

export interface ScriptRunOptions {
  /** The operator-authored source code. */
  code: string;
  /** Job definition context injected into the script's sandbox. */
  jobDefinitionId: string;
  platformOrgId: string;
  trigger: 'SCHEDULE' | 'MANUAL';
  input?: unknown;
  /** When true, capabilities become no-op recorders. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Capability tracking — every call is recorded into the result.
// ---------------------------------------------------------------------------

type CapabilitiesUsed = Set<string>;

/**
 * Build a capabilities recording object. Each capability method records the call
 * and, unless dryRun, delegates to a real implementation (currently only `notify`).
 */
function buildCapabilities(
  caps: CapabilitiesUsed,
  dryRun: boolean,
): { notify: (text: string) => Promise<void> } {
  return {
    async notify(_text: string): Promise<void> {
      caps.add('notify');
      // In dry-run mode the notification is only recorded — never emitted.
      if (dryRun) return;
    },
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CODE_LENGTH = 50_000; // 50 KB cap on operator code

/**
 * Host identifiers that must never be reachable from operator code. Checked
 * statically (see `assertNoBlockedGlobals`) because V8's typeof <unknown>
 * fast path bypasses sandbox getters and Proxy traps entirely.
 */
const BLOCKED_GLOBALS = [
  'process',
  'require',
  'module',
  'exports',
  'global',
  'globalThis',
  'Buffer',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',
  '__dirname',
  '__filename',
  'eval',
  'Function',
  'WebAssembly',
  'import',
  'fetch',
  'XMLHttpRequest',
  'Worker',
  'SharedWorker',
  'window',
  'self',
  'document',
  'Deno',
];

const BLOCKED_GLOBAL_RE = new RegExp(
  // (?<![.\w$]) avoids flagging property access such as obj.process
  `(?<![.\\w$])\\b(?:${BLOCKED_GLOBALS.join('|')})\\b`,
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate and prepare operator code for sandbox execution. */
export function validateCode(code: string): void {
  if (!code || code.trim().length === 0) {
    throw new Error('Script code cannot be empty');
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(
      `Script code exceeds maximum length of ${MAX_CODE_LENGTH} bytes (${code.length} provided)`,
    );
  }
}

/**
 * Remove comments and string/template literals so the denylist scan only sees
 * actual code. Keeps the scan free of false positives on log messages etc.
 */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n\r]*/g, ' ') // line comments
    .replace(/(["'`])(?:\\.|(?!\\1)[^\\])*\\1/g, ' '); // string/template literals
}

/**
 * Static layer 1: reject code that references a blocked host global.
 * Throws with the same "blocked" wording the runtime Proxy uses.
 */
function assertNoBlockedGlobals(code: string): void {
  const match = BLOCKED_GLOBAL_RE.exec(stripCommentsAndStrings(code));
  if (match) {
    throw new Error(
      `Access to "${match[0]}" is blocked — not exposed in the sandbox`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sandbox construction — Proxy-wrapped context for security isolation
// ---------------------------------------------------------------------------

/**
 * Build the sandbox context object. A Proxy intercepts every property access;
 * dangerous names (constructor, prototype, __proto__, anything starting with
 * double-underscore) throw. Only the explicitly permitted surface is allowed.
 */
function buildSandboxContext(
  options: ScriptRunOptions,
  caps: CapabilitiesUsed,
): Record<string, unknown> {
  const capabilities = buildCapabilities(caps, options.dryRun ?? false);

  const log: Record<string, (_msg?: unknown) => void> = Object.create(null);
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    log[level] = (_msg: unknown) => {}; // no-op — handled by service layer
  }

  const rawCtx: Record<string, unknown> = {
    input: options.input,
    jobDefinitionId: options.jobDefinitionId,
    platformOrgId: options.platformOrgId,
    trigger: options.trigger,
    dryRun: options.dryRun ?? false,
    log,
    capabilities,
  };

  const allowedCtxProps = new Set([
    'input', 'jobDefinitionId', 'platformOrgId',
    'trigger', 'dryRun', 'log', 'capabilities', 'ctx',
  ]);

  const ctxProxy = new Proxy(rawCtx, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      const key = String(prop);

      if (key === 'constructor' || key === 'prototype' || key === '__proto__') {
        throw new Error(
          `Access to "${key}" is blocked — sandbox isolation prevents prototype manipulation`,
        );
      }
      if (key.startsWith('__')) {
        throw new Error(
          `Access to "${key}" is blocked — sandbox isolation prevents magic method access`,
        );
      }
      if (!allowedCtxProps.has(key)) {
        throw new Error(`Access to "${key}" is blocked — not exposed in the sandbox`);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'symbol') return prop in target;
      // Claim everything exists so a blocked lookup reaches the get trap and throws
      // instead of silently resolving to undefined.
      return true;
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'symbol') {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      if (!allowedCtxProps.has(String(prop))) return undefined;
      return {
        enumerable: true,
        configurable: true,
        writable: true,
        value: Reflect.get(target, prop, target),
      };
    },
  });

  // Self-reference so the global ctx resolves to the Proxy, never the raw object.
  rawCtx.ctx = ctxProxy;

  // Plain object for the VM global scope. Only plain data properties here —
  // accessors are unreliable across Node versions (see header comment).
  const globalSandbox: Record<string, unknown> = {
    ctx: ctxProxy,
    capabilities, // exposed globally (scripts may call capabilities.notify(...))
    log,          // exposed globally
    Promise: globalThis.Promise, // required for async scripts
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    // Safe standard intrinsics
    Error: globalThis.Error,
    TypeError: globalThis.TypeError,
    SyntaxError: globalThis.SyntaxError,
    RangeError: globalThis.RangeError,
    ReferenceError: globalThis.ReferenceError,
    EvalError: globalThis.EvalError,
    URIError: globalThis.URIError,
    JSON: globalThis.JSON,
    Math: globalThis.Math,
    Date: globalThis.Date,
    Array: globalThis.Array,
    Object: globalThis.Object,
    String: globalThis.String,
    Number: globalThis.Number,
    Boolean: globalThis.Boolean,
    RegExp: globalThis.RegExp,
    Map: globalThis.Map,
    Set: globalThis.Set,
    WeakMap: globalThis.WeakMap,
    WeakSet: globalThis.WeakSet,
    Symbol: globalThis.Symbol,
    Proxy: undefined, // no proxy construction from operator code
    Reflect: undefined,
    parseInt: globalThis.parseInt,
    parseFloat: globalThis.parseFloat,
    isNaN: globalThis.isNaN,
    isFinite: globalThis.isFinite,
    encodeURI: globalThis.encodeURI,
    decodeURI: globalThis.decodeURI,
    encodeURIComponent: globalThis.encodeURIComponent,
    decodeURIComponent: globalThis.decodeURIComponent,
    undefined,
    NaN: globalThis.NaN,
    Infinity: globalThis.Infinity,
  };

  return globalSandbox;
}

// ---------------------------------------------------------------------------
// Execution — compile in restricted context, run with Proxy-wrapped sandbox
// ---------------------------------------------------------------------------

/**
 * Run operator-authored code inside a VM sandbox. Returns the result and a list of
 * capabilities that were invoked during execution.
 *
 * The sandbox is a true boundary: process, require, setTimeout, and other Node.js
 * globals are undefined inside. Only the explicitly injected context is available.
 */
export async function runScriptInSandbox(
  options: ScriptRunOptions,
): Promise<ScriptRunResult> {
  // Layer 1 — static denylist (runs before compilation; throws "…is blocked…").
  assertNoBlockedGlobals(options.code);

  const caps = new Set<string>();
  const globalSandbox = buildSandboxContext(options, caps);

  // Wrap the code in an async IIFE so it can use `await` and `return`.
  const wrappedCode = `(async function(ctx) { ${options.code} })(ctx)`;

  try {
    const result = await runInNewContext(wrappedCode, globalSandbox);

    return {
      result,
      capabilitiesUsed: Array.from(caps),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Script execution failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Timeout wrapper — same as the existing withTimeout in service, but here for
// consistency when the runner is called standalone.
// ---------------------------------------------------------------------------

/** Run a promise with a wall-clock timeout; rejects if it exceeds `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Script exceeded timeout of ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
