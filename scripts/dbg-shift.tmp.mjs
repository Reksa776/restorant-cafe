import crypto from "node:crypto";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const BASE = "http://127.0.0.1:3001";
const PROJECT = "/home/reksa1221/restorant-cafe";
const envRaw = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
const keep = new Set(["DATABASE_URL", "IPAYMU_VA", "IPAYMU_API_KEY"]);
const ENV = {};
for (const line of envRaw.split(/\r?\n/)) { const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m && keep.has(m[1])) ENV[m[1]] = m[2].trim().replace(/^"|"$/g, ""); }
const url = new URL(ENV.DATABASE_URL);
const pool = mysql.createPool({ host: url.hostname, port: url.port||3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password||""), database: url.pathname.replace(/^\//,""), connectionLimit: 3 });
const q = async (sql, params=[]) => (await pool.query(sql, params))[0];
let cookie = ""; let branch = null;
async function login(email,password){
  const c = await fetch(`${BASE}/api/auth/csrf`); cookie = (c.headers.getSetCookie?c.headers.getSetCookie():[]).map(x=>x.split(";")[0]).join("; ");
  const cj = await c.json();
  const form = new URLSearchParams({csrfToken:cj.csrfToken,email,password,callbackURL:`${BASE}/login`,json:"true"});
  const r = await fetch(`${BASE}/api/auth/callback/credentials`,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",...cookie?{cookie}:{}},body:form.toString()});
  const sc = r.headers.getSetCookie?r.headers.getSetCookie():[]; cookie = [...new Set([...cookie.split(";").filter(Boolean),...sc.map(x=>x.split(";")[0])])].join("; ");
  const s = await g("/api/auth/session"); return s;
}
async function g(p){ const r = await fetch(BASE+p,{headers:{cookie,...(branch?{"x-branch-id":branch}:{})}}); return {status:r.status, json: await r.json().catch(()=>null)}; }
async function p(path,body){ const r = await fetch(BASE+path,{method:"POST",headers:{cookie,"Content-Type":"application/json",...(branch?{"x-branch-id":branch}:{})},body:JSON.stringify(body)}); return {status:r.status, json: await r.json().catch(()=>null)}; }
const VA = ENV.IPAYMU_VA;
const sign = (pl)=>{ const s={}; Object.keys(pl).sort().forEach(k=>s[k]=pl[k]); return crypto.createHmac("sha256",VA).update(JSON.stringify(s).replace(/\//g,"\\/"),"utf8").digest("hex"); };
const wh = async (pl)=>{ const r = await fetch(`${BASE}/api/webhooks/ipaymu`,{method:"POST",headers:{"Content-Type":"application/json","x-signature":sign(pl)},body:JSON.stringify(pl)}); return {status:r.status, json: await r.json().catch(()=>null)}; };

const asess = await login("admin@restobahagia.com","admin123");
const rid = asess.json.data.restaurantId;
console.log("restaurant", rid, "branches", asess.json.data.branches.map(b=>b.code));
branch = asess.json.data.branches[0].id;
const ksess = await login("kasir@restobahagia.com","kasir123");
const kid = ksess.json.data.userId;
const kbr = ksess.json.data.branches[0].id;
branch = kbr;
console.log("kasir", kid, "branch", kbr);
const prod = (await q(`SELECT p.id,p.price FROM product p JOIN branchproduct bp ON bp.productId=p.id AND bp.branchId=? WHERE p.restaurantId=? AND p.isActive=1 AND p.isAvailable=1 AND bp.isAvailable=1 AND bp.stock>0 ORDER BY p.price ASC LIMIT 1`,[kbr,rid]))[0];
console.log("prod", prod);
const cust = `sc-${crypto.randomBytes(8).toString("hex")}`;
await q(`INSERT INTO customer (id,restaurantId,name,phone,isActive,createdAt,updatedAt) VALUES (?,?,?,?,1,NOW(6),NOW(6))`,[cust,rid,"DbgShiftMon",`dbg-${Date.now()}`]);
const order = await p("/api/orders",{customerId:cust,orderType:"DINE_IN",items:[{productId:prod.id,quantity:1}]});
console.log("order create", order.status, JSON.stringify(order.json));
const dbo = (await q(`SELECT id,grandTotal,branchId,orderNumber FROM \`order\` WHERE id=?`,[order.json.data.id]))[0];
// open a shift for kasir at MAIN
const sid = `sh${crypto.randomBytes(6).toString("hex")}`;
await q(`INSERT INTO cashiershift (id,restaurantId,branchId,userId,status,shiftNumber,openingCash,openedAt,createdAt,updatedAt) VALUES (?,?,?,?,'OPEN',?,0,NOW(6),NOW(6),NOW(6))`,[sid,rid,kbr,kid,`SH-DBG-${Date.now().toString().slice(-6)}`]);
console.log("shift", sid);
const qr = await p("/api/payments",{orderNumber:dbo.orderNumber, method:"QRIS"});
console.log("QRIS create", qr.status, JSON.stringify(qr.json));
const pRows = await q(`SELECT id,status,method,shiftId,branchId,orderId FROM payment WHERE orderId=?`,[dbo.id]);
console.log("payment rows", pRows);
const close = await p("/api/shifts/close",{});
console.log("shift close", close.status, JSON.stringify(close.json));
await q(`DELETE FROM payment WHERE orderId=?`,[dbo.id]);
await q(`DELETE FROM orderstatushistory WHERE orderId=?`,[dbo.id]);
await q(`DELETE FROM \`order\` WHERE id=?`,[dbo.id]);
await q(`DELETE FROM cashiershift WHERE id=?`,[sid]);
await q(`DELETE FROM customer WHERE id=?`,[cust]);
await pool.end();
