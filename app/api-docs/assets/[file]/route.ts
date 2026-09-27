import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Static dist files live in node_modules — direct path, no import (the package's
// index.js requires the browser bundle, which crashes on `self` in Node edge contexts).
const DIST_ROOT = path.join(process.cwd(), 'node_modules', 'swagger-ui-dist');

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// /api-docs/assets/<file> — serves swagger-ui-dist static files.
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (path.basename(file) !== file || path.extname(file) === '') {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  try {
    const body = await readFile(path.join(DIST_ROOT, file));
    return new Response(body, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
  } catch {
    return new Response(JSON.stringify({ error: `Not found: ${file}` }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
}
