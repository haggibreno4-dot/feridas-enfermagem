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
  res.writeHead(status, {"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin",...extraHeaders});
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
http.createServer(async (req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  try {
    if(pathname==="/api/health") return json(res,200,{ok:true,service:"feridas-enfermagem",database:dbReady?"connected":"not_configured"});
    if(pathname.startsWith("/api/auth/")) return await authRoute(req,res,pathname);
    if(pathname==="/api/cases") return json(res,200,{cases});
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
