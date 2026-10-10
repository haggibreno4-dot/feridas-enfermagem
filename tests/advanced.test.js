const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "advanced.js"), "utf8");

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

test("flashcards incluem conceitos clínicos e mensuração", () => {
  const app = createApp("flashcards");
  assert.equal(app.DermeAdvanced.counts.flashcards, 14);
  assert.match(app.DermeAdvanced.render(), /Repetição espaçada|REPETIÇÃO ESPAÇADA/);
});

test("caso do dia inclui três perguntas", () => {
  const app = createApp("daily");
  const html = app.DermeAdvanced.render();
  assert.equal((html.match(/class="daily-question"/g) || []).length, 3);
  assert.match(html, /Caso fictício/);
});

test("prática guiada apresenta etapas e histórico", () => {
  const app = createApp("clinical");
  const html = app.DermeAdvanced.render();
  assert.match(html, /Etapa 1 \/ 3/);
  assert.match(html, /Histórico de prática/);
});

test("rascunho de evolução não inventa campos vazios", () => {
  const app = createApp("evolution", {
    "dq-evolution-draft": { context: "Pessoa relata dor 3/10", response: "Relata melhora" }
  });
  const html = app.DermeAdvanced.render();
  assert.match(html, /Pessoa relata dor 3\/10/);
  assert.match(html, /Relata melhora/);
  assert.doesNotMatch(html, /Temperatura:|Sinais vitais:/);
});
