// Optional Docker-free fallback. Install @electric-sql/pglite outside the repo and
// pass its absolute module path in ASSISTANT_TEST_PGLITE_MODULE. No live DB access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const modulePath = process.env.ASSISTANT_TEST_PGLITE_MODULE;
assert.ok(modulePath && path.isAbsolute(modulePath), 'Set ASSISTANT_TEST_PGLITE_MODULE to an isolated PGlite installation.');
const { PGlite } = require(modulePath);
function expand(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\\ir (.+)$/gm, (_, relative) => expand(path.resolve(path.dirname(file), relative.trim())));
}
// Keep each top-level statement in a distinct transaction, matching psql. In
// particular updated_at tests must not run under one transaction-stable now().
function statements(sql) {
  const result = [];
  let start = 0, quote = null, comment = false;
  for (let i = 0; i < sql.length; i++) {
    if (comment) { if (sql[i] === '\n') comment = false; continue; }
    if (quote) {
      if (sql.startsWith(quote, i)) {
        if (quote === "'" && sql[i + 1] === "'") { i++; continue; }
        i += quote.length - 1; quote = null;
      }
      continue;
    }
    if (sql.startsWith('--', i)) { comment = true; i++; continue; }
    if (sql[i] === "'") { quote = "'"; continue; }
    const dollar = sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/);
    if (dollar) { quote = dollar[0]; i += quote.length - 1; continue; }
    if (sql[i] === ';') { result.push(sql.slice(start, i + 1)); start = i + 1; }
  }
  if (sql.slice(start).trim()) result.push(sql.slice(start));
  return result;
}
(async () => {
  const db = new PGlite();
  try {
    console.log((await db.query('select version()')).rows[0]);
    for (const sql of statements(expand(path.join(__dirname, 'assistant-db.test.sql')))) {
      try {
        const results = await db.exec(sql);
        for (const result of results) for (const row of result.rows) if (row.result) console.log(row.result);
      } catch (error) { console.error('Failed SQL:', sql.slice(0, 250)); throw error; }
    }
  } finally { await db.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
