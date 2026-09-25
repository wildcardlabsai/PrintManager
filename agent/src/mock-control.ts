import http from "node:http";
import type { MockPrinterFleet } from "./flashforge/mock.js";

/**
 * Local-only control endpoint for the simulated printers (development and
 * automated tests): POST /printers/<serial>/<action>, GET /printers/<serial>.
 * Bound to 127.0.0.1 and only started in mock mode.
 */
export function startMockControl(fleet: MockPrinterFleet, port: number) {
  const server = http.createServer((req, res) => {
    const m = req.url?.match(/^\/printers\/([^/]+)(?:\/([a-z_]+))?$/);
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!m) return send(404, { error: "not found" });
    const serial = decodeURIComponent(m[1]);
    if (req.method === "GET") {
      fleet.tick();
      const s = fleet.snapshot(serial);
      return s ? send(200, { ...s, spec: { ...s.spec, checkCode: undefined } }) : send(404, { error: "unknown printer" });
    }
    if (req.method === "POST" && m[2]) {
      if (m[2] === "set_check_code") {
        const s = fleet.snapshot(serial);
        if (!s) return send(404, { error: "unknown printer" });
        s.spec.checkCode = new URL(req.url!, "http://x").searchParams.get("code") ?? "";
        return send(200, { ok: true });
      }
      return fleet.control(serial, m[2]) ? send(200, { ok: true }) : send(400, { error: "unknown printer or action" });
    }
    send(405, { error: "method not allowed" });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
