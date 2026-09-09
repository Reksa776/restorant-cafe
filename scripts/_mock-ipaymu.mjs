// Local mock of the iPaymu v2 "payment/direct" endpoint. Used ONLY by the
// runtime smoke harness (scripts/e2e-kasir-payment-branding-v2.mjs) so the
// port-3001 test instance never fires real gateway requests. Protocol-
// faithful: same request shape (VA/signature/timestamp headers), same
// success/response bodies the provider's parser accepts.
import http from "node:http";

const VA = process.env.MOCK_VA || "1179000899000000";
let requests = 0;

function fail(res, code, message) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ Status: code, Message: message, Success: false }));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    requests += 1;
    // The mock accepts whatever VA the test server presents (it is the
    // server's own configured value — never logged) and only requires a
    // signature header to be present.
    if (!req.headers.va) return fail(res, 400, "missing va");
    if (!req.headers.signature) return fail(res, 400, "missing signature");
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return fail(res, 400, "bad json");
    }
    const amount = String(body.amount || "0");
    const ref = String(body.referenceId || "MOCK-REF");
    const channel = body.paymentMethod === "qris" ? "qris" : "va";
    const data =
      channel === "qris"
        ? {
            Reference: ref,
            QrString: `MOCK-QRIS-${ref}`,
            QrImage: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
            Expired: new Date(Date.now() + 24 * 3600 * 1000)
              .toISOString()
              .slice(0, 19)
              .replace("T", " "),
          }
        : {
            Reference: ref,
            PaymentUrl: `http://127.0.0.1:4711/mock/va/${ref}`,
            Expired: new Date(Date.now() + 24 * 3600 * 1000)
              .toISOString()
              .slice(0, 19)
              .replace("T", " "),
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ Status: 200, Message: "OK", Success: true, Data: data }));
  });
});

server.listen(4711, "127.0.0.1", () => {
  console.log(`[mock-ipaymu] listening on 127.0.0.1:4711 (va=${VA})`);
});
