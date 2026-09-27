import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const body = await readFile(
      path.join(process.cwd(), 'docs', 'openapi', 'generated', 'openapi.json'),
    );
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch {
    return new Response(
      JSON.stringify({ error: 'openapi.json not generated — run `npm run docs:generate` first' }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}
