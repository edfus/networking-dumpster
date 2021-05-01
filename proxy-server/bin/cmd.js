#!/bin/bash

import { App, ProxyServer } from "../index.js";

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
      ctx.state.statusCode || ctx.res && ctx.res.statusCode
    );
  }
);

const sockets = new Set();

const server = app.listen(8081, "127.0.0.1", function () {
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
    console.info(`Destroyed connection to ${socket.remoteAddress}.`)
  }
  server.unref().close(() => console.info("Have a nice day."));
};

process.once("SIGINT", shutdown);
process.once("SIGQUIT", shutdown);