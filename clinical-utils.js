(function(root){
  var limits={sensory:4,moisture:4,activity:4,mobility:4,nutrition:4,friction:3};
  function calculateBradenScore(scores){
    scores=scores&&typeof scores==="object"?scores:{};
    var keys=Object.keys(limits),count=0,total=0,valid=true;
    keys.forEach(function(k){var n=Number(scores[k]);if(scores[k]!==undefined&&scores[k]!==null&&scores[k]!==""&&Number.isInteger(n)&&n>=1&&n<=limits[k]){count++;total+=n}else{valid=false}});
    return {complete:valid&&count===keys.length,answered:count,total:valid&&count===keys.length?total:null,min:6,max:23,atRisk:valid&&count===keys.length?total<=18:null,threshold:18};
  }
  function validateTissueDistribution(values, keys){
    values=values&&typeof values==="object"?values:{};
    keys=Array.isArray(keys)&&keys.length?keys:["granulation","slough","necrosis","other"];
    var count=0,sum=0,valid=true,invalid=[];
    keys.forEach(function(k){var raw=values[k];if(raw===undefined||raw===null||raw==="")return;var n=Number(raw);if(!Number.isFinite(n)||n<0||n>100){valid=false;invalid.push(k);return}count++;sum+=n});
    if(sum>100.000001)valid=false;
    return {complete:valid&&count===keys.length&&Math.abs(sum-100)<0.000001,valid:valid&&count>0,partial:count<keys.length||Math.abs(sum-100)>=0.000001,sum:sum,remaining:100-sum,answered:count,invalid:invalid};
  }
  function buildWoundNarrative(payload){
    payload=payload&&typeof payload==="object"?payload:{};
    var sections=[
      ["Identificação e classificação",{"etiology":"Etiologia informada","classification":"Classificação registrada","classificationNotes":"Observação sobre classificação","onsetDate":"Início da lesão"}],
      ["Medidas informadas",{"length":"Comprimento (cm)","width":"Largura (cm)","depth":"Profundidade (cm)","measurementMethod":"Método de medida"}],
      ["Anamnese e relato",{"informationSource":"Origem da informação","diabetes":"Diabetes mellitus","mobility":"Mobilidade","nutrition":"Estado nutricional","continence":"Continência/umidade","pain":"Dor relatada","painMethod":"Método de avaliação da dor","painScore":"Escore de dor","historyTreatment":"Tratamentos anteriores","clinicalFactors":"Fatores clínicos","reported":"Relato do paciente/acompanhante"}],
      ["Achados observados",{"tissueCompleteness":"Composição do leito","bedNotes":"Achados do leito","exudateAmount":"Quantidade de exsudato","exudateType":"Característica do exsudato","odor":"Odor avaliado","edgeAdherent":"Aderência das bordas","periwound":"Pele perilesional","edgesNotes":"Bordas","exudateNotes":"Observações sobre exsudato","localSigns":"Achados locais","infectionConcern":"Suspeita clínica registrada","clinicalSignsNotes":"Sinais clínicos","observed":"Observação profissional"}],
      ["Procedimentos e plano registrados",{"cleaning":"Limpeza registrada","primaryDressing":"Cobertura primária registrada","secondaryDressing":"Cobertura secundária registrada","products":"Produtos complementares","procedure":"Procedimento efetivamente registrado","tolerance":"Tolerância/resposta registrada","intercurrences":"Intercorrências registradas","guidance":"Orientações fornecidas","followupPlan":"Plano de acompanhamento","reassessmentDate":"Reavaliação prevista","otherNotes":"Observações adicionais"}]
    ];
    var lines=["Rascunho de evolução para revisão profissional. Conteúdo baseado exclusivamente nos campos preenchidos."];
    sections.forEach(function(section){var rows=[];Object.keys(section[1]).forEach(function(key){var value=payload[key];if(value!==undefined&&value!==null&&String(value).trim()!==""&&value!==false)rows.push(section[1][key]+": "+String(value).trim().replace(/[\\r\\n]+/g," "))});if(rows.length)lines.push("",section[0]+":",rows.join("; ")+".")});
    var tissues=["Granulação","Esfacelo","Necrose","Epitelização","Outros"].filter(function(name){return payload["tissue-"+name]!==undefined&&payload["tissue-"+name]!==null&&payload["tissue-"+name]!==""}).map(function(name){return name+" "+payload["tissue-"+name]+"%"});
    if(tissues.length)lines.push("Tecidos e percentuais informados: "+tissues.join(", ")+(payload.tissueCompleteness==="Avaliação parcial"?" (distribuição parcial).":"."));
    return lines.join("\n");
  }
  var api={calculateBradenScore:calculateBradenScore,validateTissueDistribution:validateTissueDistribution,buildWoundNarrative:buildWoundNarrative};
  root.ClinicalUtils=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
