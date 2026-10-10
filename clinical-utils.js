(function(root){
  var limits={sensory:4,moisture:4,activity:4,mobility:4,nutrition:4,friction:3};
  function calculateBradenScore(scores){
    scores=scores&&typeof scores==="object"?scores:{};
    var keys=Object.keys(limits),count=0,total=0,valid=true;
    keys.forEach(function(k){var n=Number(scores[k]);if(scores[k]!==undefined&&scores[k]!==null&&scores[k]!==""&&Number.isInteger(n)&&n>=1&&n<=limits[k]){count++;total+=n}else{valid=false}});
    return {complete:valid&&count===keys.length,answered:count,total:valid&&count===keys.length?total:null,min:6,max:23,atRisk:valid&&count===keys.length?total<=18:null,threshold:18};
  }
  function validateTissueDistribution(values){
    values=values&&typeof values==="object"?values:{};
    var keys=["granulation","slough","necrosis","other"],count=0,sum=0,valid=true;
    keys.forEach(function(k){var raw=values[k];if(raw===undefined||raw===null||raw===""){valid=false;return}var n=Number(raw);if(!Number.isFinite(n)||n<0||n>100){valid=false;return}count++;sum+=n});
    return {complete:count===keys.length,valid:valid&&count===keys.length&&Math.abs(sum-100)<0.000001,sum:sum,remaining:100-sum,answered:count};
  }
  var api={calculateBradenScore:calculateBradenScore,validateTissueDistribution:validateTissueDistribution};
  root.ClinicalUtils=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
