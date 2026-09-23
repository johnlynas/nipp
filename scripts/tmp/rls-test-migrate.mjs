/**
 * One-shot transform for RLS integration-test migration (not committed to test surface).
 * 1) AST: replace `prisma` identifier used as a member-object with `fx`.
 * 2) AST: wrap CalendarEventService.<m>(makeCtx('ROLE'), ...) calls in
 *    withTenantAccess(testOrgId, FLAG, () => ...), FLAG = ROLE==='PLATFORM_ADMIN'.
 * Run: npx tsx scripts/tmp/rls-test-migrate.mjs <file>...
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

function transform(srcText, opts) {
  const sf = ts.createSourceFile('t.ts', srcText, ts.ScriptTarget.Latest, true);
  const edits = []; // {start, end, text}

  function isMemberOf(expr, obj) {
    return (
      expr &&
      expr.kind === ts.SyntaxKind.MemberExpression &&
      expr.expression.getText(sf) === obj
    );
  }

  function visit(node) {
    // prisma.<model> -> fx.<model>
    if (
      node.kind === ts.SyntaxKind.Identifier &&
      node.text === 'prisma' &&
      node.parent &&
      node.parent.kind === ts.SyntaxKind.MemberExpression &&
      node.parent.expression === node
    ) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: 'fx' });
    }

    // CalendarEventService.<method>(...) -> withTenantAccess(testOrgId, FLAG, () => ...)
    if (
      node.kind === ts.SyntaxKind.CallExpression &&
      isMemberOf(node.expression, 'CalendarEventService', null)
    ) {
      const method = node.expression.name.getText(sf);
      let flag = false;
      const firstArg = node.arguments[0];
      if (firstArg && firstArg.kind === ts.SyntaxKind.CallExpression && isMemberOf(firstArg.expression, 'makeCtx', null)) {
        const roleLit = firstArg.arguments[0] && firstArg.arguments[0].kind === ts.SyntaxKind.StringLiteral
          ? firstArg.arguments[0].text : '';
        flag = roleLit === 'PLATFORM_ADMIN';
      } else if (firstArg && isMemberOf(firstArg.expression, 'makeCtx', null)) {
        // should not happen; default false
      }
      const callText = node.getText(sf);
      edits.push({
        start: node.getStart(sf),
        end: node.getEnd(),
        text: `withTenantAccess(testOrgId, ${flag}, () => ${callText})`,
      });
    }

    ts.forEachChild(node, visit);
  }
  sf.forEachChild((n) => n && visit(n));

  // Apply edits last-to-first (non-overlapping by construction).
  edits.sort((a, b) => b.start - a.start);
  let out = srcText;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, count: edits.length };
}

const files = process.argv.slice(2);
for (const f of files) {
  const fs = require('fs');
  const original = fs.readFileSync(f, 'utf8');
  const { text, count } = transform(original);
  fs.writeFileSync(f, text);
  console.log(`migrated ${f}: ${count} AST edits`);
}
