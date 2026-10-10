const test = require("node:test");
const assert = require("node:assert/strict");
const { makeClinicalPdf } = require("../clinical-pdf.js");

test("PDF clínico tem cabeçalho válido, catálogo e tabela xref", () => {
  const pdf = makeClinicalPdf(["DERMATRIZ | FICHA DE AVALIACAO", "Paciente: PACIENTE-FICTICIO-01", "Não registrado"]);
  const text = pdf.toString("ascii");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Type \/Catalog/);
  const start = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  assert.match(text, /PACIENTE-FICTICIO-01/);
});

test("PDF clínico cria páginas adicionais para histórico extenso", () => {
  const lines = Array.from({length:120}, (_,i)=>"Linha fictícia "+i+" - dados educativos sem paciente real.");
  const text = makeClinicalPdf(lines).toString("ascii");
  assert.match(text, /\/Count 3/);
  assert.match(text, /Linha ficticia 119/);
});

test("PDF escapa parênteses e barras em conteúdo fornecido", () => {
  const text = makeClinicalPdf(["Observação (teste) \\ fictícia"]).toString("ascii");
  assert.ok(text.includes("Observa"));
  assert.match(text, /\\\(teste\\\)/);
});
