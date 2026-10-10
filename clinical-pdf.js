function pdfEscape(value){return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E]/g," ").replace(/([\\()])/g,"\\$1").slice(0,180)}
function makeClinicalPdf(lines){
 const wrapped=[];for(const item of lines){let rest=String(item||"");if(!rest){wrapped.push("");continue}while(rest.length>92){let cut=rest.lastIndexOf(" ",92);if(cut<35)cut=92;wrapped.push(rest.slice(0,cut));rest=rest.slice(cut).trim()}wrapped.push(rest)}
 const pages=[];for(let i=0;i<wrapped.length;i+=48)pages.push(wrapped.slice(i,i+48));if(!pages.length)pages.push(["Ficha de Avaliacao de Feridas"]);
 const objects=[];const add=o=>{objects.push(o);return objects.length};const catalog=add("");const pagesObj=add("");const font=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");const pageIds=[];
 pages.forEach(lines=>{const stream=lines.map((line,i)=>"BT /F1 9 Tf 48 "+(795-i*15)+" Td ("+pdfEscape(line)+") Tj ET").join("\n");const content=add("<< /Length "+Buffer.byteLength(stream,"ascii")+" >>\nstream\n"+stream+"\nendstream");pageIds.push(add("<< /Type /Page /Parent "+pagesObj+" 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 "+font+" 0 R >> >> /Contents "+content+" 0 R >>"))});
 objects[catalog-1]="<< /Type /Catalog /Pages "+pagesObj+" 0 R >>";objects[pagesObj-1]="<< /Type /Pages /Kids ["+pageIds.map(x=>x+" 0 R").join(" ")+"] /Count "+pageIds.length+" >>";
 let out="%PDF-1.4\n%DermaTriz\n",offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(out,"ascii"));out+=(i+1)+" 0 obj\n"+obj+"\nendobj\n"});const xref=Buffer.byteLength(out,"ascii");out+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";offsets.slice(1).forEach(n=>out+=String(n).padStart(10,"0")+" 00000 n \n");out+="trailer\n<< /Size "+(objects.length+1)+" /Root "+catalog+" 0 R >>\nstartxref\n"+xref+"\n%%EOF";return Buffer.from(out,"ascii")
}
module.exports={makeClinicalPdf};
