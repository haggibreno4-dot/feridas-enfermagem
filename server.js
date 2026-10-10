const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const port = process.env.PORT || 3000;
const root = __dirname;
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ...(process.env.PGSSL === "true" ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;
let dbReady = false;
const sessionsMaxAge = 7 * 24 * 60 * 60;
const loginAttempts = new Map();
const cases = [
  {id:"caso-01",title:"Lesão por pressão — estágio 3",region:"Região sacral",etiology:"Lesão por pressão",tissue:"Granulação + esfacelo",exudate:"Moderado",pain:"4/10",image:"",description:"Caso fictício para treinamento de avaliação sistemática.",actions:["Limpeza conforme protocolo","Avaliar necessidade de desbridamento","Selecionar cobertura conforme objetivo","Registrar e reavaliar"]},
  {id:"caso-02",title:"Úlcera venosa — simulação",region:"Membro inferior",etiology:"Venosa",tissue:"Granulação",exudate:"Alto",pain:"3/10",image:"",description:"Cenário educacional para relacionar achados e objetivos do cuidado.",actions:["Avaliar edema e pele perilesional","Controle de exsudato","Considerar terapia compressiva quando indicada","Registrar evolução"]},
  {id:"caso-03",title:"Ferida cirúrgica — simulação",region:"Perna",etiology:"Pós-operatória",tissue:"Granulação",exudate:"Baixo",pain:"2/10",image:"",description:"Caso fictício para praticar avaliação e documentação.",actions:["Avaliar bordas e sinais inflamatórios","Higienização conforme protocolo","Escolher cobertura apropriada","Reavaliar"]}
];
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".ico":"image/x-icon"};

function send(res, status, type, data, extraHeaders = {}) {
  res.writeHead(status, {"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'","Cross-Origin-Opener-Policy":"same-origin",...extraHeaders});
  res.end(data);
}
function json(res, status, data, headers) { send(res,status,"application/json; charset=utf-8",JSON.stringify(data),headers); }
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf("=");return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}));
}
function cookieOptions(req, clear = false) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return { "Set-Cookie": "feridas_session=" + (clear ? "" : "") + "; Path=/; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "") + (clear ? "; Max-Age=0" : "; Max-Age="+sessionsMaxAge) };
}
function sessionCookie(req, token) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return {"Set-Cookie":"feridas_session="+encodeURIComponent(token)+"; Path=/; HttpOnly; SameSite=Lax"+(secure?"; Secure":"")+"; Max-Age="+sessionsMaxAge};
}
function clearCookie(req) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return {"Set-Cookie":"feridas_session=; Path=/; HttpOnly; SameSite=Lax"+(secure?"; Secure":"")+"; Max-Age=0"};
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let body="", tooLarge=false;
    req.on("data",chunk=>{body+=chunk;if(body.length>32768){tooLarge=true;reject(new Error("PAYLOAD_TOO_LARGE"));req.destroy();}});
    req.on("end",()=>{if(tooLarge)return;try{resolve(JSON.parse(body||"{}"))}catch{reject(new Error("INVALID_JSON"))}});
    req.on("error",reject);
  });
}
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function originAllowed(req) {
  const origin=req.headers.origin;
  if(!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function getClientKey(req) { return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim(); }
function allowAttempt(req) {
  const key=getClientKey(req), now=Date.now(), item=loginAttempts.get(key);
  if(!item || now-item.start>15*60*1000){loginAttempts.set(key,{start:now,count:1});return true;}
  item.count++; return item.count<=20;
}
async function initDatabase() {
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS user_app_data (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS patients (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_code VARCHAR(64) NOT NULL, display_name VARCHAR(160) NOT NULL,
      birth_date DATE, sex VARCHAR(40), contact TEXT, clinical_context TEXT,
      comorbidities TEXT, allergies TEXT, observations TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, patient_code)
    );
    CREATE INDEX IF NOT EXISTS patients_owner_name_idx ON patients(user_id, display_name);
    CREATE TABLE IF NOT EXISTS wounds (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      wound_code VARCHAR(64) NOT NULL, label VARCHAR(160) NOT NULL, location VARCHAR(160) NOT NULL,
      laterality VARCHAR(40), etiology VARCHAR(120), onset_date DATE, classification VARCHAR(120),
      notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(patient_id, wound_code)
    );
    CREATE INDEX IF NOT EXISTS wounds_owner_patient_idx ON wounds(user_id, patient_id);
    CREATE TABLE IF NOT EXISTS wound_assessments (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      wound_id BIGINT NOT NULL REFERENCES wounds(id) ON DELETE CASCADE,
      assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb, evolution_draft TEXT NOT NULL DEFAULT '', evolution_final TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, finalized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS assessments_wound_time_idx ON wound_assessments(user_id, wound_id, assessed_at DESC);
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(64) NOT NULL, entity_type VARCHAR(32) NOT NULL, entity_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_events_owner_time_idx ON audit_events(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS assessment_amendments (
      id BIGSERIAL PRIMARY KEY, assessment_id BIGINT NOT NULL REFERENCES wound_assessments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS assessment_amendments_assessment_idx ON assessment_amendments(assessment_id, created_at);
  `);
  dbReady=true;
  console.log("Banco de autenticação inicializado.");
}
async function currentUser(req) {
  if(!pool || !dbReady) return null;
  const token=parseCookies(req).feridas_session;
  if(!token || token.length>200) return null;
  const result=await pool.query("SELECT u.id,u.name,u.email FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[hashToken(token)]);
  return result.rows[0] || null;
}
function authUnavailable(res) {
  return json(res,503,{error:"O login ainda não está configurado. O banco PostgreSQL precisa ser conectado ao serviço."});
}
async function authRoute(req,res,pathname) {
  if(!pool || !dbReady) return authUnavailable(res);
  if(pathname==="/api/auth/me" && req.method==="GET") {
    const user=await currentUser(req);
    return json(res,200,{user:user?{id:user.id,name:user.name,email:user.email}:null});
  }
  if(pathname==="/api/auth/register" && req.method==="POST") {
    if(!allowAttempt(req)) return json(res,429,{error:"Muitas tentativas. Aguarde 15 minutos e tente novamente."});
    const body=await readBody(req);
    const name=String(body.name||"").trim(), email=String(body.email||"").trim().toLowerCase(), password=String(body.password||"");
    if(name.length<2 || name.length>80) return json(res,400,{error:"Informe seu nome (de 2 a 80 caracteres)."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) return json(res,400,{error:"Informe um e-mail válido."});
    if(password.length<8 || password.length>128) return json(res,400,{error:"A senha deve ter entre 8 e 128 caracteres."});
    const passwordHash=await bcrypt.hash(password,12);
    try {
      const result=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,passwordHash]);
      const user=result.rows[0];
      return json(res,201,{message:"Conta criada com sucesso. Faça login para validar o acesso.",user});
    } catch(e) {
      if(e.code==="23505") return json(res,409,{error:"Este e-mail já está cadastrado."});
      throw e;
    }
  }
  if(pathname==="/api/auth/login" && req.method==="POST") {
    if(!allowAttempt(req)) return json(res,429,{error:"Muitas tentativas. Aguarde 15 minutos e tente novamente."});
    const body=await readBody(req);
    const email=String(body.email||"").trim().toLowerCase(), password=String(body.password||"");
    if(!email || !password) return json(res,400,{error:"Informe e-mail e senha."});
    const result=await pool.query("SELECT id,name,email,password_hash FROM users WHERE email=$1",[email]);
    const user=result.rows[0];
    if(!user || !(await bcrypt.compare(password,user.password_hash))) return json(res,401,{error:"E-mail ou senha incorretos."});
    const token=crypto.randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[hashToken(token),user.id]);
    return json(res,200,{user:{id:user.id,name:user.name,email:user.email}},{...sessionCookie(req,token)});
  }
  if(pathname==="/api/auth/logout" && req.method==="POST") {
    const token=parseCookies(req).feridas_session;
    if(token) await pool.query("DELETE FROM user_sessions WHERE token_hash=$1",[hashToken(token)]);
    return json(res,200,{ok:true},{...clearCookie(req)});
  }
  return json(res,404,{error:"Rota de autenticação não encontrada."});
}

function cleanText(value,max=4000){return String(value==null?"":value).trim().slice(0,max)}
function audit(userId,action,entityType,entityId){return pool.query("INSERT INTO audit_events(user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)",[userId,action,entityType,entityId||null])}
function pdfEscape(value){return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E]/g," ").replace(/([\\()])/g,"\\$1").slice(0,180)}
function makeClinicalPdf(lines){
 const wrapped=[];for(const item of lines){let rest=String(item||"");if(!rest){wrapped.push("");continue}while(rest.length>92){let cut=rest.lastIndexOf(" ",92);if(cut<35)cut=92;wrapped.push(rest.slice(0,cut));rest=rest.slice(cut).trim()}wrapped.push(rest)}
 const pages=[];for(let i=0;i<wrapped.length;i+=48)pages.push(wrapped.slice(i,i+48));if(!pages.length)pages.push(["Ficha de Avaliacao de Feridas"]);
 const objects=[];const add=o=>{objects.push(o);return objects.length};const catalog=add("");const pagesObj=add("");const font=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");const pageIds=[];
 pages.forEach(lines=>{const stream=lines.map((line,i)=>"BT /F1 9 Tf 48 "+(795-i*15)+" Td ("+pdfEscape(line)+") Tj ET").join("\n");const content=add("<< /Length "+Buffer.byteLength(stream,"ascii")+" >>\nstream\n"+stream+"\nendstream");pageIds.push(add("<< /Type /Page /Parent "+pagesObj+" 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 "+font+" 0 R >> >> /Contents "+content+" 0 R >>"))});
 objects[catalog-1]="<< /Type /Catalog /Pages "+pagesObj+" 0 R >>";objects[pagesObj-1]="<< /Type /Pages /Kids ["+pageIds.map(x=>x+" 0 R").join(" ")+"] /Count "+pageIds.length+" >>";
 let out="%PDF-1.4\n%DermeQuest\n",offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(out,"ascii"));out+=(i+1)+" 0 obj\n"+obj+"\nendobj\n"});const xref=Buffer.byteLength(out,"ascii");out+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";offsets.slice(1).forEach(n=>out+=String(n).padStart(10,"0")+" 00000 n \n");out+="trailer\n<< /Size "+(objects.length+1)+" /Root "+catalog+" 0 R >>\nstartxref\n"+xref+"\n%%EOF";return Buffer.from(out,"ascii")
}
async function clinicalRoute(req,res,pathname){
 if(!pathname.startsWith("/api/records/"))return false;
 if(!pool||!dbReady){authUnavailable(res);return true}
 const user=await currentUser(req);if(!user){json(res,401,{error:"Faça login para acessar prontuários."});return true}
 const uid=user.id,method=req.method;
 if(pathname==="/api/records/patients"&&method==="GET"){
  const q=cleanText(new URL(req.url,"http://localhost").searchParams.get("q"),100);
  const r=await pool.query("SELECT p.id,p.patient_code,p.display_name,p.created_at,p.updated_at,(SELECT COUNT(*) FROM wound_assessments a WHERE a.patient_id=p.id AND a.user_id=p.user_id) AS assessment_count,(SELECT MAX(a.assessed_at) FROM wound_assessments a WHERE a.patient_id=p.id AND a.user_id=p.user_id) AS last_assessment FROM patients p WHERE p.user_id=$1 AND ($2='' OR p.display_name ILIKE '%'||$2||'%' OR p.patient_code ILIKE '%'||$2||'%') ORDER BY p.display_name LIMIT 250",[uid,q]);json(res,200,{patients:r.rows});return true
 }
 if(pathname==="/api/records/patients"&&method==="POST"){
  const b=await readBody(req),code=cleanText(b.patientCode,64),name=cleanText(b.displayName,160);if(!code||!name){json(res,400,{error:"Informe um identificador interno e um nome ou rótulo para o paciente."});return true}
  try{const r=await pool.query("INSERT INTO patients(user_id,patient_code,display_name,birth_date,sex,contact,clinical_context,comorbidities,allergies,observations) VALUES($1,$2,$3,NULLIF($4,'')::date,$5,$6,$7,$8,$9,$10) RETURNING *",[uid,code,name,cleanText(b.birthDate,10),cleanText(b.sex,40),cleanText(b.contact,200),cleanText(b.clinicalContext),cleanText(b.comorbidities),cleanText(b.allergies),cleanText(b.observations)]);await audit(uid,"patient.created","patient",r.rows[0].id);json(res,201,{patient:r.rows[0]});return true}catch(e){if(e.code==="23505"){json(res,409,{error:"Esse identificador já existe na sua lista."});return true}if(e.code==="22007"||e.code==="22008"){json(res,400,{error:"Data de nascimento inválida."});return true}throw e}
 }
 let m=pathname.match(/^\/api\/records\/patients\/(\d+)$/);
 if(m&&method==="GET"){
  const p=await pool.query("SELECT * FROM patients WHERE id=$1 AND user_id=$2",[m[1],uid]);if(!p.rowCount){json(res,404,{error:"Paciente não encontrado."});return true}
  const wounds=await pool.query("SELECT w.*,(SELECT COUNT(*) FROM wound_assessments a WHERE a.wound_id=w.id AND a.user_id=$2) AS assessment_count,(SELECT MAX(a.assessed_at) FROM wound_assessments a WHERE a.wound_id=w.id AND a.user_id=$2) AS last_assessment FROM wounds w WHERE w.patient_id=$1 AND w.user_id=$2 ORDER BY w.created_at DESC",[m[1],uid]);
  const assessments=await pool.query("SELECT a.id,a.wound_id,a.assessed_at,a.status,a.evolution_draft,a.evolution_final,a.version,a.finalized_at,a.payload,w.label AS wound_label,u.name AS professional_name,(SELECT COALESCE(json_agg(json_build_object('id',am.id,'reason',am.reason,'content',am.content,'created_at',am.created_at) ORDER BY am.created_at),'[]'::json) FROM assessment_amendments am WHERE am.assessment_id=a.id AND am.user_id=$2) AS amendments FROM wound_assessments a JOIN wounds w ON w.id=a.wound_id AND w.user_id=$2 JOIN users u ON u.id=a.user_id WHERE a.patient_id=$1 AND a.user_id=$2 ORDER BY a.assessed_at DESC LIMIT 100",[m[1],uid]);json(res,200,{patient:p.rows[0],wounds:wounds.rows,assessments:assessments.rows});return true
 }
 if(m&&method==="PATCH"){
  const b=await readBody(req),code=cleanText(b.patientCode,64),name=cleanText(b.displayName,160);if(!code||!name){json(res,400,{error:"Identificador e nome são obrigatórios."});return true}
  try{const r=await pool.query("UPDATE patients SET patient_code=$3,display_name=$4,birth_date=NULLIF($5,'')::date,sex=$6,contact=$7,clinical_context=$8,comorbidities=$9,allergies=$10,observations=$11,updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *",[m[1],uid,code,name,cleanText(b.birthDate,10),cleanText(b.sex,40),cleanText(b.contact,200),cleanText(b.clinicalContext),cleanText(b.comorbidities),cleanText(b.allergies),cleanText(b.observations)]);if(!r.rowCount){json(res,404,{error:"Paciente não encontrado."});return true}await audit(uid,"patient.updated","patient",m[1]);json(res,200,{patient:r.rows[0]});return true}catch(e){if(e.code==="23505"){json(res,409,{error:"Esse identificador já existe na sua lista."});return true}throw e}
 }
 m=pathname.match(/^\/api\/records\/patients\/(\d+)\/wounds$/);
 if(m&&method==="POST"){
  const b=await readBody(req),p=await pool.query("SELECT id FROM patients WHERE id=$1 AND user_id=$2",[m[1],uid]);if(!p.rowCount){json(res,404,{error:"Paciente não encontrado."});return true}
  const code=cleanText(b.woundCode,64),label=cleanText(b.label,160),location=cleanText(b.location,160);if(!code||!label||!location){json(res,400,{error:"Identificador, nome da ferida e localização são obrigatórios."});return true}
  try{const r=await pool.query("INSERT INTO wounds(user_id,patient_id,wound_code,label,location,laterality,etiology,onset_date,classification,notes) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::date,$9,$10) RETURNING *",[uid,m[1],code,label,location,cleanText(b.laterality,40),cleanText(b.etiology,120),cleanText(b.onsetDate,10),cleanText(b.classification,120),cleanText(b.notes)]);await audit(uid,"wound.created","wound",r.rows[0].id);json(res,201,{wound:r.rows[0]});return true}catch(e){if(e.code==="23505"){json(res,409,{error:"Esse código de ferida já existe neste paciente."});return true}throw e}
 }
 m=pathname.match(/^\/api\/records\/wounds\/(\d+)\/assessments$/);
 if(m&&method==="GET"){const w=await pool.query("SELECT id FROM wounds WHERE id=$1 AND user_id=$2",[m[1],uid]);if(!w.rowCount){json(res,404,{error:"Ferida não encontrada."});return true}const r=await pool.query("SELECT * FROM wound_assessments WHERE wound_id=$1 AND user_id=$2 ORDER BY assessed_at DESC",[m[1],uid]);json(res,200,{assessments:r.rows});return true}
 if(m&&method==="POST"){
  const b=await readBody(req),w=await pool.query("SELECT id,patient_id FROM wounds WHERE id=$1 AND user_id=$2",[m[1],uid]);if(!w.rowCount){json(res,404,{error:"Ferida não encontrada."});return true}
  const payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};const raw=JSON.stringify(payload);if(raw.length>24000){json(res,413,{error:"A avaliação excede o limite permitido."});return true}
  const r=await pool.query("INSERT INTO wound_assessments(user_id,patient_id,wound_id,assessed_at,status,payload,evolution_draft) VALUES($1,$2,$3,COALESCE(NULLIF($4,'')::timestamptz,NOW()),'draft',$5::jsonb,$6) RETURNING *",[uid,w.rows[0].patient_id,m[1],cleanText(b.assessedAt,35),raw,cleanText(b.evolutionDraft,12000)]);await audit(uid,"assessment.created","assessment",r.rows[0].id);json(res,201,{assessment:r.rows[0]});return true
 }
 m=pathname.match(/^\/api\/records\/assessments\/(\d+)$/);
 if(m&&method==="GET"){const r=await pool.query("SELECT a.*,w.label AS wound_label,w.location,u.name AS professional_name FROM wound_assessments a JOIN wounds w ON w.id=a.wound_id AND w.user_id=$2 JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND a.user_id=$2",[m[1],uid]);if(!r.rowCount){json(res,404,{error:"Avaliação não encontrada."});return true}const amendments=await pool.query("SELECT id,reason,content,created_at FROM assessment_amendments WHERE assessment_id=$1 AND user_id=$2 ORDER BY created_at",[m[1],uid]);json(res,200,{assessment:r.rows[0],amendments:amendments.rows});return true}
 if(m&&method==="PATCH"){
  const b=await readBody(req),payload=b.payload&&typeof b.payload==="object"&&!Array.isArray(b.payload)?b.payload:{};const raw=JSON.stringify(payload);if(raw.length>24000){json(res,413,{error:"A avaliação excede o limite permitido."});return true}
  const r=await pool.query("UPDATE wound_assessments SET payload=$3::jsonb,evolution_draft=$4,assessed_at=COALESCE(NULLIF($5,'')::timestamptz,assessed_at),version=version+1,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='draft' RETURNING *",[m[1],uid,raw,cleanText(b.evolutionDraft,12000),cleanText(b.assessedAt,35)]);if(!r.rowCount){json(res,409,{error:"Rascunho não encontrado ou já finalizado. Registros finalizados não podem ser sobrescritos."});return true}await audit(uid,"assessment.draft_updated","assessment",m[1]);json(res,200,{assessment:r.rows[0]});return true
 }
 m=pathname.match(/^\/api\/records\/assessments\/(\d+)\/finalize$/);
 if(m&&method==="POST"){const b=await readBody(req),txt=cleanText(b.evolutionFinal,12000);if(!txt){json(res,400,{error:"Revise e confirme a evolução antes de finalizar."});return true}const r=await pool.query("UPDATE wound_assessments SET status='final',evolution_final=$3,finalized_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1 AND user_id=$2 AND status='draft' RETURNING *",[m[1],uid,txt]);if(!r.rowCount){json(res,409,{error:"Somente rascunhos podem ser finalizados."});return true}await audit(uid,"assessment.finalized","assessment",m[1]);json(res,200,{assessment:r.rows[0]});return true}
 m=pathname.match(/^\/api\/records\/assessments\/(\d+)\/amendments$/);
 if(m&&method==="POST"){const b=await readBody(req),reason=cleanText(b.reason,1000),content=cleanText(b.content,6000);if(!reason||!content){json(res,400,{error:"Informe o motivo e o conteúdo do adendo."});return true}const a=await pool.query("SELECT id FROM wound_assessments WHERE id=$1 AND user_id=$2 AND status='final'",[m[1],uid]);if(!a.rowCount){json(res,404,{error:"Avaliação finalizada não encontrada."});return true}const r=await pool.query("INSERT INTO assessment_amendments(assessment_id,user_id,reason,content) VALUES($1,$2,$3,$4) RETURNING *",[m[1],uid,reason,content]);await audit(uid,"assessment.amended","assessment",m[1]);json(res,201,{amendment:r.rows[0]});return true}
 m=pathname.match(/^\/api\/records\/patients\/(\d+)\/export\.pdf$/);
 if(m&&method==="GET"){
  const p=await pool.query("SELECT * FROM patients WHERE id=$1 AND user_id=$2",[m[1],uid]);if(!p.rowCount){json(res,404,{error:"Paciente não encontrado."});return true}
  const wounds=await pool.query("SELECT * FROM wounds WHERE patient_id=$1 AND user_id=$2 ORDER BY created_at",[m[1],uid]);const as=await pool.query("SELECT a.*,w.label AS wound_label,w.location,u.name AS professional_name FROM wound_assessments a JOIN wounds w ON w.id=a.wound_id AND w.user_id=$2 JOIN users u ON u.id=a.user_id WHERE a.patient_id=$1 AND a.user_id=$2 ORDER BY a.assessed_at",[m[1],uid]);
  const lines=["DERMAQUEST | FICHA DE AVALIACAO DE FERIDAS","Exportacao autenticada | Dados registrados, sem inferencias clinicas","","Paciente: "+p.rows[0].display_name,"Identificador: "+p.rows[0].patient_code,"Cadastro: "+p.rows[0].created_at.toISOString().slice(0,10),"Contexto clinico: "+(p.rows[0].clinical_context||"Nao registrado"),"Comorbidades: "+(p.rows[0].comorbidities||"Nao registrado"),"Alergias: "+(p.rows[0].allergies||"Nao registrado"),"Observacoes: "+(p.rows[0].observations||"Nao registrado"),"","FERIDAS REGISTRADAS"];
  wounds.rows.forEach(w=>lines.push("- "+w.wound_code+" | "+w.label+" | "+w.location+" | Etiologia: "+(w.etiology||"Nao registrada")));
  for(let i=0;i<as.rows.length;i++){const a=as.rows[i];lines.push("","AVALIACAO "+(i+1)+" | "+new Date(a.assessed_at).toISOString()+" | "+a.wound_label+" | Profissional: "+a.professional_name+" | "+(a.status==="final"?"FINALIZADA":"RASCUNHO"));const payload=a.payload||{};Object.keys(payload).forEach(k=>{const v=payload[k];if(v!==""&&v!==null&&v!==undefined)lines.push((k+": "+(typeof v==="object"?JSON.stringify(v):String(v))).slice(0,1000))});lines.push("Evolucao: "+(a.evolution_final||a.evolution_draft||"Nao registrada"));const amendments=await pool.query("SELECT reason,content,created_at FROM assessment_amendments WHERE assessment_id=$1 AND user_id=$2 ORDER BY created_at",[a.id,uid]);amendments.rows.forEach(x=>lines.push("ADENDO "+x.created_at.toISOString().slice(0,10)+" | Motivo: "+x.reason+" | "+x.content))}
  lines.push("","Gerado em: "+new Date().toISOString(),"Versao de exportacao: 1");const pdf=makeClinicalPdf(lines);await audit(uid,"patient.pdf_exported","patient",m[1]);res.writeHead(200,{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="dermaquest-prontuario-'+m[1]+'.pdf"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Content-Length":pdf.length});res.end(pdf);return true
 }
 json(res,404,{error:"Rota de prontuário não encontrada."});return true
}

http.createServer(async (req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  try {
    if(pathname.startsWith("/api/") && ["POST","PUT","PATCH","DELETE"].includes(req.method) && !originAllowed(req)) return json(res,403,{error:"Origem da requisição não permitida."});
    if(pathname==="/api/health") return json(res,200,{ok:true,service:"feridas-enfermagem",database:dbReady?"connected":"not_configured"});
    if(pathname.startsWith("/api/auth/")) return await authRoute(req,res,pathname);
    if(pathname.startsWith("/api/records/") && await clinicalRoute(req,res,pathname)) return;
    if(pathname==="/api/cases") return json(res,200,{cases});
    if(pathname==="/api/data" && (req.method==="GET" || req.method==="PUT")) {
      if(!pool || !dbReady) return authUnavailable(res);
      const user=await currentUser(req);
      if(!user) return json(res,401,{error:"Faça login para sincronizar seu progresso."});
      if(req.method==="GET") {
        const saved=await pool.query("SELECT data,updated_at FROM user_app_data WHERE user_id=$1",[user.id]);
        return json(res,200,{data:saved.rows[0]?.data||{},exists:!!saved.rows[0],userId:String(user.id),updatedAt:saved.rows[0]?.updated_at||null});
      }
      const body=await readBody(req);
      if(!body.data || typeof body.data!=="object" || Array.isArray(body.data)) return json(res,400,{error:"Formato de dados inválido."});
      const raw=JSON.stringify(body.data);
      if(raw.length>30000) return json(res,413,{error:"O progresso excede o limite permitido."});
      const result=await pool.query("INSERT INTO user_app_data(user_id,data,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() RETURNING updated_at",[user.id,raw]);
      return json(res,200,{ok:true,updatedAt:result.rows[0].updated_at});
    }
    const requested=pathname==="/"?"index.html":decodeURIComponent(pathname).replace(/^\/+/, "");
    const file=path.resolve(root,requested);
    if(file!==root && !file.startsWith(root+path.sep)) return send(res,403,"text/plain; charset=utf-8","Forbidden");
    fs.readFile(file,(err,data)=>{if(err)return send(res,404,"text/plain; charset=utf-8","Not found");send(res,200,types[path.extname(file)]||"application/octet-stream",data)});
  } catch(err) {
    if(err.message==="INVALID_JSON") return json(res,400,{error:"Corpo da requisição inválido."});
    if(err.message==="PAYLOAD_TOO_LARGE") return;
    console.error("Erro na requisição:",err.message);
    if(!res.headersSent) json(res,500,{error:"Erro interno. Tente novamente."});
  }
}).listen(port,()=>console.log("DermeQuest rodando na porta "+port));

if(pool) initDatabase().catch(err=>{console.error("Falha ao inicializar banco:",err.message);dbReady=false;});
process.on("SIGTERM",async()=>{if(pool)await pool.end();process.exit(0)});
process.on("SIGINT",async()=>{if(pool)await pool.end();process.exit(0)});
