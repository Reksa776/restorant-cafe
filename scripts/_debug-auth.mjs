const BASE = "http://127.0.0.1:3001";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const setCookies = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : [];
const csrfJson = await csrfRes.json();
const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
const form = new URLSearchParams({
  csrfToken: csrfJson.csrfToken,
  email: "admin@restobahagia.com",
  password: "admin123",
  callbackURL: `${BASE}/login`,
  json: "true",
});
const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 Chrome/126",
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
  },
  body: form.toString(),
});
const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
const jar = sc.map((c) => c.split(";")[0]).join("; ");
const probe = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jar } });
const sess = await probe.json().catch(() => null);
console.log("session:", JSON.stringify(sess));
