import { strictEqual } from "assert";
import { App, ProxyServer } from "../index.js";
import ProxyTunnel from "forward-proxy-tunnel";

const port = 8081;
const hostname = "127.0.0.1";

const app = new App();

for (const middleware of new ProxyServer()) {
  app.use(middleware);
}

app.on("error", console.error);
app.prepend(
  async (ctx, next) => {
    await next();
    
    console.info(
      new Date().toLocaleString(),
      ctx.ip,
      ctx.req.method,
      ctx.url,
      ctx.state.status || ctx.res?.statusCode
    );
  }
);

const sockets = new Set();

const server = app.listen(port, hostname, function () {
  const address = this.address();
  console.info(`Proxy server is running at http://${address.address}:${address.port}`);
}).on("connection", socket => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

const shutdown = () => {
  process.exitCode = 0;
  console.info("Shutting down...");
  for (const socket of sockets.values()) {
    socket.destroy();
    console.info(`Destroyed connection for ${socket.remoteAddress}.`)
  }
  server.unref().close(() => console.info("Have a nice day."));
};

process.once("SIGINT", shutdown);
process.once("SIGQUIT", shutdown);

describe("proxy server", () => {
  after(() => shutdown());

  it("external sites", async () => {
    if(!server.listening) {
      await new Promise(resolve => {
        server.prependOnceListener("listening", resolve);
      });
    }

    const proxy = new ProxyTunnel(
      `http://${hostname}:${port}`
    );

    await Promise.all([
      proxy.fetch("http://www.google.com/generate_204")
        .then(res => {
          strictEqual(res.statusCode, 204);
          res.resume();
        }),
      proxy.fetch("https://www.google.com/generate_204")
        .then(res => {
          strictEqual(res.statusCode, 204);
          res.resume();
        }),
      proxy.fetch("https://www.google.com/teapot")
        .then(res => {
          strictEqual(res.statusCode, 418);
          res.resume();
        }),
      proxy.fetch("https://nodejs.org")
        .then(res => {
          strictEqual(res.statusCode, 302);
          res.resume();
        }),
      proxy.fetch("https://developer.mozilla.org", { method: "POST", body: "bot" })
        .then(res => {
          strictEqual(res.statusCode, 403);
          res.resume();
        }),
      proxy.fetch("https://github.com/", { method: "HEAD" })
        .then(res => {
          strictEqual(res.statusCode, 200);
          res.resume();
        })
    ]);
  }).timeout(5000);
});