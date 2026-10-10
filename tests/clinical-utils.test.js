const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateBradenScore, validateTissueDistribution, buildWoundNarrative } = require("../clinical-utils.js");

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

test("distribuição parcial é aceita e identificada como incompleta", () => {
  const result = validateTissueDistribution({ granulation:60, slough:25, necrosis:"", other:5 });
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.partial, true);
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

test("evolução em rascunho inclui apenas campos clínicos preenchidos", () => {
  const text = buildWoundNarrative({ reported:"Paciente refere dor ao trocar cobertura", observed:"Leito com granulação observada", length:2.5, primaryDressing:"Espuma de poliuretano" });
  assert.match(text, /paciente\\/acompanhante/i Paciente refere dor ao trocar cobertura/);
  assert.match(text, /Observação profissional: Leito com granulação observada/);
  assert.match(text, /Comprimento \(cm\): 2.5/);
  assert.match(text, /Cobertura primária registrada: Espuma de poliuretano/);
  assert.doesNotMatch(text, /infecção confirmada|sem dor|sem exsudato/i);
});
test("evolução não inventa conteúdo quando campos estão vazios", () => {
  const text = buildWoundNarrative({ pain:"", exudateAmount:"", observed:"" });
  assert.doesNotMatch(text, /Dor relatada|Quantidade de exsudato|Observação profissional/);
});
test("distribuição parcial válida não permite exceder 100%", () => {
  const result = validateTissueDistribution({ granulation:60, slough:45, necrosis:"", other:"" });
  assert.equal(result.valid, false);
  assert.equal(result.sum, 105);
});
