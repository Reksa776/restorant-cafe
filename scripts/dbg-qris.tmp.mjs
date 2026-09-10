import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const BASE = "http://127.0.0.1:3001";
const PROJECT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envRaw = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
const keep = new Set(["DATABASE_URL", "IPAYMU_VA", "IPAYMU_API_KEY"]);
const ENV = {};
for (const line of envRaw.split(/\r?\n/)) { const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && keep.has(m[1])) ENV[m[1]] = m[2].trim().replace(/^"|"$/g, ""); }
const url = new URL(ENV.DATABASE_URL);
const pool = mysql.createPool({ host: url.hostname, port: url.port||3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password||""), database: url.pathname.replace(/^\//,""), connectionLimit: 6 });
const q = async (sql, params=[]) => (await pool.query(sql, params))[0];
const makeApi = () => {
  let cookie=""; let branch=null;
  return {
    setBranch(b){branch=b;},
    async login(email,password){
      const c = await fetch(`${BASE}/api/auth/csrf`); cookie=(c.headers.getSetCookie?c.headers.getSetCookie():[]).map(x=>x.split(";")[0]).join("; ");
      const cj=await c.json();
      const form=new URLSearchParams({csrfToken:cj.csrfToken,email,password,callbackURL:`${BASE}/login`,json:"true"});
      await fetch(`${BASE}/api/auth/callback/credentials`,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:form.toString()});
      const sc=c.headers.getSetCookie?c.headers.getSetCookie():[];
      const r=await fetch(`${BASE}/api/auth/callback/credentials`,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",...(cookie?{cookie}:{})},body:form.toString()});
      const s2=sc.map(x=>x.split(";")[0]); cookie=[...new Set([...cookie.split(";").filter(Boolean),...s2])].join("; ");
      const s=await this.get("/api/auth/session"); return s;
    },
    async get(p){const r=await fetch(BASE+p,{headers:{cookie,...(branch?{"x-branch-id":branch}:{})}});return{status:r.status,json:await r.json().catch(()=>null)};},
    async post(p,b){const r=await fetch(BASE+p,{method:"POST",headers:{cookie,"Content-Type":"application/json",...(branch?{"x-branch-id":branch}:{})},body:JSON.stringify(b)});return{status:r.status,json:await r.json().catch(()=>null)};},
  };
};
const sign = (pl)=>{ const s={}; Object.keys(pl).sort().forEach(k=>s[k]=pl[k]); return crypto.createHmac("sha256",ENV.IPAYMU_VA).update(JSON.stringify(s).replace(/\//g,"\\/"),"utf8").digest("hex"); };
const wh = async (pl)=>{ const r=await fetch(`${BASE}/api/webhooks/ipaymu`,{method:"POST",headers:{"Content-Type":"application/json","x-signature":sign(pl)},body:JSON.stringify(pl)}); return{status:r.status,json:await r.json().catch(()=>null)}; };

const admin=makeApi(); const asess=await admin.login("admin@restobahagia.com","admin123");
const rid=asess.json.data.restaurantId; const abr=asess.json.data.branches[0].id;
console.log("admin session role", asess.json.data.role, "branch", abr);
admin.setBranch(abr);
const kasir=makeApi(); const ksess=await kasir.login("kasir@restobahagia.com","kasir123");
const kid=ksess.json.data.userId; const kbr=ksess.json.data.branches[0].id;
console.log("kasir role", ksess.json.data.role, "branch", kbr, "scoped", ksess.json.data.branchScoped);
kasir.setBranch(kbr);

await q(`UPDATE cashiershift SET status='CLOSED' WHERE userId=? AND status='OPEN'`,[kid]);
const prod=(await q(`SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=? WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`,[kbr,rid]))[0];
console.log("prod", prod.id, prod.price);

const mkCust=async()=>{const id=`sc-${crypto.randomBytes(8).toString("hex")}`;await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,[id,rid,"DbgQRIS",`dbgq-${Date.now()}-${Math.floor(Math.random()*1e4)}`]);return id;};
const mkOrder=async()=>{const cid=await mkCust();const o=await admin.post("/api/orders",{customerId:cid,orderType:"DINE_IN",items:[{productId:prod.id,quantity:1}]});console.log("order create",o.status,JSON.stringify(o.json));const d=(await q(`SELECT id,grandTotal,branchId,orderNumber FROM \`order\` WHERE id=?`,[o.json.data.id]))[0];return d;};

const sid=`sh${crypto.randomBytes(6).toString("hex")}`;
await q(`INSERT INTO cashiershift (id,restaurantId,branchId,userId,status,shiftNumber,openingCash,openedAt,createdAt,updatedAt) VALUES (?,?,?,?,'OPEN',?,0,NOW(6),NOW(6),NOW(6))`,[sid,rid,kbr,kid,`SH-DBG2-${Date.now().toString().slice(-6)}`]);
console.log("open shift",sid);

const o=await mkOrder();
const qr=await kasir.post("/api/payments",{orderNumber:o.orderNumber,method:"QRIS"});
console.log("QRIS create", qr.status, JSON.stringify(qr.json));
const rows=await q(`SELECT id,status,method,shiftId,providerRef,paymentUrl FROM payment WHERE orderId=?`,[o.id]);
console.log("payment rows after create", rows);
const whr=await wh({reference_id:o.orderNumber,trx_id:`TRX-DBG-${Date.now()}`,status:"berhasil",total:String(o.grandTotal),amount:String(o.grandTotal)});
console.log("webhook", whr.status, JSON.stringify(whr.json));

async function cleanup(){
  await q(`DELETE FROM paymenttransaction WHERE paymentId IN (SELECT id FROM payment WHERE orderId=?)`,[o.id]);
  await q(`DELETE FROM payment WHERE orderId=?`,[o.id]);
  await q(`DELETE FROM orderstatushistory WHERE orderId=?`,[o.id]);
  await q(`DELETE FROM \`order\` WHERE id=?`,[o.id]);
  await q(`DELETE FROM cashiershift WHERE id=?`,[sid]);
  await q(`DELETE FROM customer WHERE id=?`,[(await q(`SELECT customerId c FROM \`order\` WHERE id=?`,[o.id]))[0]?.c]);
  await pool.end();
}
await cleanup();
console.log("done");
process.exit(0);