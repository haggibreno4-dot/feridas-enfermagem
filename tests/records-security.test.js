const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const route = source.slice(source.indexOf("async function clinicalRoute"), source.indexOf("http.createServer(async"));

test("clinical API requires an authenticated session before route handling", () => {
  assert.match(route, /const user=await currentUser\(req\)/);
  assert.match(route, /if\(!user\).*json\(res,401/);
});

test("patient and wound reads apply owner filters in SQL", () => {
  assert.match(route, /FROM patients WHERE id=\$1 AND user_id=\$2/);
  assert.match(route, /FROM wounds w WHERE w\.patient_id=\$1 AND w\.user_id=\$2/);
  assert.match(route, /FROM wound_assessments WHERE wound_id=\$1 AND user_id=\$2/);
});

test("finalized assessments cannot be overwritten by draft updates", () => {
  assert.match(route, /WHERE id=\$1 AND user_id=\$2 AND status='draft' RETURNING/);
  assert.match(route, /status='final',evolution_final=\$3/);
});

test("PDF export verifies patient ownership and scopes related records", () => {
  assert.match(route, /SELECT \* FROM patients WHERE id=\$1 AND user_id=\$2/);
  assert.match(route, /WHERE a\.patient_id=\$1 AND a\.user_id=\$2/);
  assert.match(route, /patient\.pdf_exported/);
});
