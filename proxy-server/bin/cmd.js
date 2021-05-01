#!/bin/bash

import { App, ProxyServer } from "../index.js";
import { inspect } from "util";

const argvs = process.argv.slice(2);

const downstreamProxy = (
  extractArg(/^(?<=--(https?[_-])?proxy=).+$/i, 0) ||
  extractArg(/^--(https?[_-])?proxy|-p$/i, 1) ||
  ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "proxy"].reduce(
    (proxy, name) => proxy ? proxy : process.env[name], void 0
  )
);

const port = (
  extractArg(/^(?<=--port=).+$/i, 0) ||
  extractArg(/^--port|-p$/i, 1) || 8081
);

const hostname = (
  extractArg(/^(?<=--host(name)?=).+$/i, 0) ||
  extractArg(/^--host(name)?|-h$/i, 1) || "127.0.0.1"
);

if (argvs.length) {
  console.info("Unrecognized arguments:", argvs);
  onFallback();
}

if (downstreamProxy) {
  console.info("Downstream proxy:", downstreamProxy);
}

const app = new App();
const proxyServer = new ProxyServer(downstreamProxy);

for (const middleware of proxyServer) {
  app.use(middleware);
}

app.on("error", err => {
  const state = err.state;

  if (state.uriObject)
    state.uriObject = state.uriObject.toString();

  if (!state.head?.length)
    delete state.head;

  console.error(
    new Date().toLocaleString(),
    inspect(state, { colors: checkIsColorEnabled(process.stderr) }),
    err.message
  );
});

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

  if (sockets.size) {
    console.info(`Destroying ${sockets.size} existing connections...`);
  }

  for (const socket of sockets.values()) {
    socket.destroy();
  }

  if (proxyServer.downstream) {
    console.info(`Destroying connections to downstream proxy...`);
    proxyServer.downstream.destroy();
  }

  console.info("Closing server...");
  server.unref().close(() => console.info("Have a nice day."));
};

process.once("SIGINT", shutdown);
process.once("SIGQUIT", shutdown);

function extractArg(matchPattern, offset = 0) {
  for (let i = 0; i < argvs.length; i++) {
    if (matchPattern.test(argvs[i])) {
      const matched = argvs.splice(i, offset + 1);
      return matched.length <= 2 ? matched[offset] : matched.slice(1);
    }
  }
  return false;
}

function checkIsColorEnabled(tty) {
  return "FORCE_COLOR" in process.env
    ? [1, 2, 3, "", true, "1", "2", "3", "true"].includes(process.env.FORCE_COLOR)
    : !(
      "NO_COLOR" in process.env ||
      process.env.NODE_DISABLE_COLORS == 1 // using == by design
    ) && tty.isTTY;
}