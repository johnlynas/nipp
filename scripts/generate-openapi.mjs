// OpenAPI spec generator for nipp API routes.
//
// Scans app/api/**/route.ts, parses JSDoc header blocks ("METHOD /path" lines
// + description prose) and emits docs/openapi/generated/openapi.json.
//
// Usage: npm run docs:generate  (node scripts/generate-openapi.mjs)
//
// Header formats supported (any subset):
//   /**
//    * GET /api/foo          -- list foos
//    * POST /api/foo         -- create a foo
//    *
//    * Description prose line 1
//    */
//
// Two documentation styles exist in the repo:
//   1. One shared header block above all handlers (most routes)
//   2. One JSDoc block directly above each exported handler (dashboard/admin/*)
// Both work: for each exported method we take the nearest preceding block
// that declares it, falling back to any block declaring it in the file.
// Substantial prose-only blocks immediately above a handler are used as the
// description when no endpoint-declaration lines exist (e.g. SSE stream).
//
// Handler export styles detected:
//   export const GET = ...            / export async function GET() {...}
//   export const { GET } = toNextJsHandler(...)
//   export { handler as POST }
//   export async function fetch() {...}  (web catch-all, e.g. SSE)
//
// Path params: [orgId] and :orgId both map to {orgId}.
// Catch-alls: [...slug] map to {slug} (documented as a single path param).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const API_DIR = join(ROOT, 'app', 'api');
const OUT_DIR = join(ROOT, 'docs', 'openapi', 'generated');
const OUT_FILE = join(OUT_DIR, 'openapi.json');

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/;
const PATH_LINE_DESC_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\S{2,}\s*--\s*(.+)/;

function normalizePathInComment(p) {
  // Comments use either [orgId] / [...slug] or :roleId — normalize to {orgId}/{slug}
  return p
    .replace(/\[\.\.\.([A-Za-z0-9_]+)\]/g, '{$1}')
    .replace(/\[([A-Za-z0-9_]+)\]/g, '{$1}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Extract all JSDoc blocks with positions; split into method lines + prose. */
function collectBlocks(source) {
  const endpointBlocks = []; // { pos, methods: {M:{path,inlineDesc}}, prose }
  const proseOnlyBlocks = []; // { pos, prose }
  for (const block of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const rawLines = block[0]
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''));

    const methods = {};
    const prose = [];
    for (const line of rawLines) {
      if (!line.trim()) continue;
      const methodMatch = line.match(METHOD_RE);
      if (methodMatch && methodMatch[2].startsWith('/')) {
        // Only "METHOD /path..." lines are endpoint declarations — prose like
        // "DELETE removes the member" must not be captured.
        const descMatch = line.match(PATH_LINE_DESC_RE);
        methods[methodMatch[1]] = {
          path: normalizePathInComment(methodMatch[2]),
          inlineDesc: descMatch ? descMatch[1].trim() : undefined,
        };
        continue;
      }
      prose.push(line.trim());
    }

    const trimmedProse = [...new Set(prose)].join('\n').trim();
    if (Object.keys(methods).length) {
      endpointBlocks.push({ pos: block.index, methods, prose: trimmedProse });
    } else if (trimmedProse.length > 80 && trimmedProse.includes('\n')) {
      // Substantial prose-only JSDoc (multi-line, not a trivial helper comment)
      proseOnlyBlocks.push({ pos: block.index, prose: trimmedProse });
    }
  }
  return { endpointBlocks, proseOnlyBlocks };
}

/** First exported position of handler method m (any style: bare, destructured `=`, aliased `as`). */
function findHandlerIndex(source, m) {
  let best = undefined;
  const consider = (idx) => { if (idx !== undefined && (best === undefined || idx < best)) best = idx; };
  consider(source.match(new RegExp(`export ((?:async )?function ${m}\\b|(?:const|let|var) ${m} =)`))?.index);
  for (const d of source.matchAll(/export (?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=/g)) {
    if (new RegExp(`\\b${m}\\b`).test(d[1])) consider(d.index);
  }
  for (const d of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    if (new RegExp(`\\bas\\s+${m}\\b`).test(d[1])) consider(d.index);
  }
  return best;
}

/** Method -> { declared, path?, inlineDesc?, prose, hasHeader } for every handler exported by source. */
function parseRouteHeaders(source) {
  const { endpointBlocks, proseOnlyBlocks } = collectBlocks(source);

  const allBlocks = [...endpointBlocks, ...proseOnlyBlocks].sort((a, b) => a.pos - b.pos);
  const globalMap = {};
  for (const b of endpointBlocks) {
    for (const [m] of Object.entries(b.methods)) if (!globalMap[m]) globalMap[m] = b;
  }

  // Positions of every handler export, used so a prose block only documents its
  // own handler — not one whose real header sits between them.
  const handlerPositions = [];
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const idx = findHandlerIndex(source, m);
    if (idx !== undefined) handlerPositions.push(idx);
  }

  const result = {}; // method -> { path, inlineDesc, prose, hasHeader }
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const idx = findHandlerIndex(source, m);
    if (idx === undefined) continue;
    result[m] = resolveHeaderFor(m, idx, endpointBlocks, allBlocks, globalMap, handlerPositions);
  }

  // Web catch-all `fetch` handler (SSE stream): not an OpenAPI method, attach
  // the nearest substantive prose block as its description.
  const fm = source.match(/export ((?:async )?function fetch\b|(?:const|let|var) fetch =)/);
  if (fm && fm.index !== undefined) {
    let proseFallback = '';
    for (const b of [...allBlocks].reverse()) {
      const between = handlerPositions.filter((p) => p > b.pos && p < fm.index).length;
      if (b.pos < fm.index && between === 0 && 'prose' in b) {
        proseFallback = b.prose;
        break;
      }
    }
    result.fetch = { path: undefined, inlineDesc: undefined, prose: proseFallback, hasHeader: Boolean(proseFallback) };
  }

  const anyHeader = Object.values(result).some((v) => v.hasHeader);
  return { byMethod: result, hasHeader: anyHeader };
}

function resolveHeaderFor(m, handlerIndex, endpointBlocks, allBlocks, globalMap, handlerPositions) {
  // 1. Nearest preceding endpoint-declaring block for this method.
  let chosen = null;
  for (let i = endpointBlocks.length - 1; i >= 0; i--) {
    const b = endpointBlocks[i];
    if (b.pos < handlerIndex && b.methods[m]) {
      chosen = b;
      break;
    }
  }
  // 2. Any block in the file declaring this method.
  if (!chosen) chosen = globalMap[m] || null;

  let prose = chosen?.prose || '';
  if (!prose) {
    // 3. Nearest preceding substantive JSDoc with no other handler in between.
    for (const b of [...allBlocks].reverse()) {
      const gapHandlers = handlerPositions.filter((p) => p > b.pos && p < handlerIndex).length;
      if (b.pos < handlerIndex && 'prose' in b && gapHandlers === 0) {
        prose = b.prose;
        break;
      }
    }
  }

  return chosen
    ? { path: chosen.methods[m].path, inlineDesc: chosen.methods[m].inlineDesc, prose, hasHeader: true }
    : { path: undefined, inlineDesc: undefined, prose, hasHeader: Boolean(prose) };
}

function derivePath(filePath) {
  // app/api/organizations/[orgId]/teams/route.ts -> /api/organizations/{orgId}/teams
  const rel = relative(API_DIR, filePath);
  return (
    '/api/' +
    rel
      .replace(/route\.ts$/, '')
      .replace(/\[([A-Za-z0-9_]+)\]/g, '{$1}') // [param] and [...rest] both use brackets
      .split('/')
      .filter(Boolean)
      .join('/')
  );
}

/** Every HTTP method (plus `fetch` catch-all) a route file exports. */
function detectHandlers(source) {
  const handlers = [];
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (new RegExp(`export ((?:async )?function ${m}\\b|(?:const|let|var) ${m} =)`).test(source)) handlers.push(m);
  }
  // Destructured: export const { GET, POST } = fn(...)
  const dest = source.matchAll(/export (?:const|let|var)?\s*\{\s*([^}]+)\s*\}\s*=/g);
  for (const d of dest) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (new RegExp(`\\b${m}\\b`).test(d[1]) && !handlers.includes(m)) handlers.push(m);
    }
  }
  // Aliased: export { handler as POST } / export { X as GET, Y as POST }
  for (const d of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (new RegExp(`\\bas\\s+${m}\\b`).test(d[1]) && !handlers.includes(m)) handlers.push(m);
    }
  }
  // Web catch-all (SSE stream etc.)
  if (/export ((?:async )?function fetch\b|(?:const|let|var) fetch =)/.test(source)) handlers.push('fetch');
  return handlers;
}

// ---------------------------------------------------------------------------
// Tags / auth heuristics
// ---------------------------------------------------------------------------

const TAG_ORDER = [
  'admin',
  'dashboard-admin',
  'organizations',
  'roles',
  'auth',
  'security',
  'cache',
  'notifications',
  'health',
];

function pathIsAuthSurface(apiPath) {
  return /^\/api\/auth(\/|$)/.test(apiPath);
}

function tagFor(apiPath) {
  const segs = apiPath.replace(/^\/api\//, '').split('/');
  if (segs[0] === 'dashboard' && segs[1] === 'admin') return 'dashboard-admin';
  for (const s of segs) {
    if (!s.startsWith('{')) return s;
  }
  return 'other';
}

function authNote(apiPath) {
  const notes = [];
  const tag = tagFor(apiPath);
  if (pathIsAuthSurface(apiPath)) {
    notes.push('Part of the BetterAuth integration (driven by session cookie).');
  } else if (tag === 'admin' || tag === 'dashboard-admin') {
    notes.push('Requires super admin session.');
  } else if (apiPath !== '/api/health' && apiPath !== '/api/csp-report') {
    notes.push('Requires authenticated session (BetterAuth cookie).');
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Spec assembly
// ---------------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const routes = walk(API_DIR);

const paths = {};
const tagCounts = {};
let documented = 0;
let undocumented = 0;

for (const file of routes) {
  const source = readFileSync(file, 'utf8');
  const doc = parseRouteHeaders(source);
  const derivedPath = derivePath(file);
  const handlers = detectHandlers(source);
  const relFile = relative(ROOT, file);

  if (doc.hasHeader) documented += 1;
  else undocumented += 1;

  // Handled methods: exported handlers plus any JSDoc-declared ones.
  const methodSet = new Set([...Object.keys(doc.byMethod), ...handlers]);

  for (const method of [...methodSet].sort()) {
    const isFetch = method === 'fetch';
    const info = doc.byMethod[method];
    const inlineDesc = info?.inlineDesc;
    const pathName = info?.path || derivedPath;
    const effectiveApiPath = pathName;
    const tag = tagFor(effectiveApiPath);
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;

    const headerProse = info?.prose;
    // Prose-only SSE/other: trim to first ~400 chars so the spec stays usable.
    const proseSnippet = headerProse && !inlineDesc ? headerProse.slice(0, 600) : headerProse;

    const descriptionParts = [
      inlineDesc ? `${method.toUpperCase()} — ${inlineDesc}` : undefined,
      proseSnippet && (!inlineDesc || !proseSnippet.includes(inlineDesc))
        ? proseSnippet
        : undefined,
      ...(isFetch ? ['Served via the web `fetch` catch-all handler (not a standard method export).'] : []),
      ...authNote(effectiveApiPath),
      `Handler: \`${relFile}\`.`,
    ].filter(Boolean);

    // fetch has no OpenAPI method key — document as GET with a clear note.
    const opKey = isFetch ? 'get' : method.toLowerCase();

    const operation = {
      tags: [tag],
      summary: isFetch ? `Stream (${method}) ${pathName}` : inlineDesc || `${method.toUpperCase()} ${pathName}`,
      description: [...new Set(descriptionParts)].join('\n\n'),
      security: pathIsAuthSurface(effectiveApiPath) || effectiveApiPath === '/api/health' || effectiveApiPath === '/api/csp-report'
        ? []
        : [{ cookieAuth: [] }],
      parameters: [],
      responses: {
        default: {
          description:
            'Unspecified — response schema not yet documented (add a zod schema + JSDoc header to fill this in).',
        },
      },
    };

    for (const param of [...pathName.matchAll(/\{([A-Za-z0-9_]+)\}/g)]) {
      operation.parameters.push({
        name: param[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }

    (paths[pathName] ||= {})[opKey] = operation;
  }
}

const tags = TAG_ORDER.concat(
  Object.keys(tagCounts).filter((t) => !TAG_ORDER.includes(t)),
).map((name) => ({
  name,
  description: `Endpoints under /api/${name === 'dashboard-admin' ? 'dashboard/admin' : name}`,
}));

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'NIPP API',
    version: pkg.version,
    description: [
      'Generated by `npm run docs:generate` from JSDoc headers in app/api/ (see scripts/generate-openapi.mjs).',
      'Request/response schemas are not yet modelled — they will appear as zod-to-openapi definitions are added.',
    ].join(' '),
  },
  servers: [{ url: '/', description: 'Same origin' }],
  tags,
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: 'BetterAuth session cookie. Set the cookie in Swagger UI using Authorize.',
      },
    },
  },
  paths,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(spec, null, 2) + '\n');

const opCount = Object.values(paths).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(`Wrote ${relative(ROOT, OUT_FILE)}`);
console.log(`routes: ${routes.length} | operations: ${opCount} | documented: ${documented} | undocumented: ${undocumented}`);
if (undocumented > 0) {
  console.log('\nRoutes missing JSDoc headers (summary-only in spec):');
  for (const file of routes) {
    if (!parseRouteHeaders(readFileSync(file, 'utf8')).hasHeader) console.log('  -', relative(ROOT, file));
  }
}
