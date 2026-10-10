const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateBradenScore, validateTissueDistribution } = require("../clinical-utils.js");

test("Braden calcula o mínimo válido e reconhece o limiar geral de risco", () => {
  const result = calculateBradenScore({ sensory:1, moisture:1, activity:1, mobility:1, nutrition:1, friction:1 });
  assert.equal(result.complete, true);
  assert.equal(result.total, 6);
  assert.equal(result.atRisk, true);
});

test("Braden calcula o máximo válido", () => {
  const result = calculateBradenScore({ sensory:4, moisture:4, activity:4, mobility:4, nutrition:4, friction:3 });
  assert.equal(result.total, 23);
  assert.equal(result.atRisk, false);
});

test("Braden não calcula total quando falta um domínio", () => {
  const result = calculateBradenScore({ sensory:4, moisture:4, activity:4, mobility:4, nutrition:4 });
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
});

test("Braden rejeita valores fora da escala", () => {
  const result = calculateBradenScore({ sensory:5, moisture:4, activity:4, mobility:4, nutrition:4, friction:3 });
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
});

test("distribuição de tecidos válida totaliza 100%", () => {
  const result = validateTissueDistribution({ granulation:60, slough:25, necrosis:10, other:5 });
  assert.equal(result.valid, true);
  assert.equal(result.sum, 100);
});

test("distribuição de tecidos incompleta não é considerada válida", () => {
  const result = validateTissueDistribution({ granulation:60, slough:25, necrosis:"", other:5 });
  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
});

test("distribuição de tecidos rejeita soma superior a 100%", () => {
  const result = validateTissueDistribution({ granulation:60, slough:30, necrosis:15, other:0 });
  assert.equal(result.valid, false);
  assert.equal(result.sum, 105);
});

test("distribuição de tecidos rejeita valores fora do intervalo", () => {
  const result = validateTissueDistribution({ granulation:-1, slough:50, necrosis:20, other:31 });
  assert.equal(result.valid, false);
});
