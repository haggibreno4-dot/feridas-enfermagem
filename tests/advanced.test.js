const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "advanced.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function createApp(view, initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const context = {
    Date, Math, JSON, Array, Object, String, Number, RegExp, Promise,
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: () => Promise.resolve({ ok: false }),
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    },
    state: { view },
    alert: () => {},
    navigator: {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("biblioteca apresenta 13 tipos de cobertura", () => {
  const app = createApp("coverage");
  assert.equal(app.DermeAdvanced.counts.coverages, 13);
  const html = app.DermeAdvanced.render();
  assert.match(html, /Alginato de cálcio/);
  assert.match(html, /Cobertura com prata/);
  assert.match(html, /Protetor de pele/);
});


test("flashcards, Caso do Dia e prática guiada foram removidos do módulo avançado", () => {
  for (const view of ["flashcards", "daily", "clinical", "evolution"]) {
    const app = createApp(view);
    assert.equal(app.DermeAdvanced.render(), null);
  }
  assert.equal(source.includes("function flashcards"), false);
  assert.equal(source.includes("function daily("), false);
  assert.equal(source.includes("function clinical("), false);
  assert.equal(source.includes("function evolution("), false);
  assert.equal(index.includes('data-view="flashcards"'), false);
  assert.equal(index.includes('data-view="daily"'), false);
});

test("ferramenta de medição não é carregada e não existe no repositório", () => {
  assert.equal(index.includes("measurement.js"), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "measurement.js")), false);
});

test("matriz de coberturas usa contexto e explica limitações", () => {
  const app = createApp("coverage");
  const html = app.DermeAdvanced.render();
  assert.match(html, /matrixEtiology/);
  assert.match(html, /matrixTissue/);
  assert.match(html, /matrixSkin/);
  assert.match(html, /Composição:/);
  assert.match(html, /Precauções:/);
  assert.ok(source.includes("Por que aparece:"));
});
