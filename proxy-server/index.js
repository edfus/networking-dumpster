import { EventEmitter } from "events";
import { createServer, ServerResponse, request } from "http";
import { connect } from "net";

class App extends EventEmitter {
  middlewares = [];
  context = {
    app: this,
    throw (status, message) {
      const err = new Error(message || status);
      err.status = status;
      err.expose = true;
      throw err;
    },
    assert (shouldBeTruthy, status, message) {
      if(!shouldBeTruthy) {
        this.throw(status, message);
      }
    }
  }

  prepend (middleware) {
    this.middlewares.unshift(middleware);
    return this;
  }

  use (middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  callback () {
    if (!this.listenerCount('error')) {
      console.info(
        "\x1b[1m\x1b[30mNo listener attached for 'error' event,",
        "forwarding all errors to console...\x1b[0m"
      );
      this.on('error', console.error);
    }

    return async (req, duplex, head) => {
      let socket, res;
      if(duplex instanceof ServerResponse) {
        res = duplex;
        socket = req.socket;
      } else {
        res = null;
        socket = duplex;
      }

      const ctx = {
        ...this.context,
        req, res, socket,
        state: {
          head,
          event: ["connect", "request"][res === null ? 0 : 1]
        },
        url: req.url,
        ip: socket.remoteAddress
      }

      let index = 0;
      const next = async () => {
        if(index >= this.middlewares.length)
          return ;
        return this.middlewares[index++](ctx, next);
      };

      try {
        await next();
      } catch (err) {
        const status = Number(err.status || 500);
        if(err.expose) {
          if(res) {
            res.writeHead(status, err.message).end(err.message);
          } else {
            if(socket.bytesWritten) {
              socket.destroy();
            } else {
              socket.write(`HTTP/1.1 ${status} ${err.message}\r\n\r\n${err.message}`)
              ctx.state.status = status;
            }
          }
        } else {
          if(res) {
            res.writeHead(status);
          } else {
            if(socket.bytesWritten) {
              socket.destroy();
            } else {
              socket.write(`HTTP/1.1 ${status} ohhhh\r\n\r\n`);
              ctx.state.status = status;
            }
          }
        }
        err.state = ctx.state;
        this.emit("error", err);
      } finally {
        if(res) {
          if(!res.headersSent)
            res.writeHead(204, {
              "Cache-Control": "no-cache",
              "Connection": "close"
            });
          if(!res.writableEnded && !res.destroyed)
            res.end();
        } else {
          if(!socket.bytesWritten) {
            socket.write([
              `HTTP/1.1 204 No Content\r\n`,
              `Cache-Control: no-cache\r\n`,
              `Connection: close\r\n`,
              `\r\n`
            ].join(""));
            ctx.state.status = 204;
          } else {
            if(!socket.writableEnded && !socket.destroyed)
              socket.end();
          }
        }

        req.resume();
      }
    }
  }

  listen (...argvs) {
    const callback = this.callback();
    return (
      createServer(callback)
        .on("connect", callback)
        .listen(...argvs)
    );
  }
}

class ProxyServer {
  _pipe (...streams) {
    const set = new Set(streams);
    return new Promise((resolve, reject) => {
      const onerror = err => {
        reject(err);
        set.forEach(s => !s.destroyed && s.destroy());
        set.clear();
      };
      set.forEach(s => s.once("error", onerror));
      for (let i = 0; i < streams.length - 1; i++) {
        streams[i].pipe(streams[i + 1]);
      }
      streams[streams.length - 1].emitClose = true;
      streams[streams.length - 1].once("finish", resolve);
      streams[streams.length - 1].once("close", onerror);
    });
  }

  * [Symbol.iterator] () {
    yield * [
      this.requestListener,
      this.connectListener,
    ];
  }

  requestListener = (ctx, next) => this._requestListener(ctx, next);
  connectListener = (ctx, next) => this._connectListener(ctx, next);

  async _requestListener (ctx, next) {
    const { req: clientRequest, res: responseToClient, url, state } = ctx;

    if(state.event !== "request") {
      return next();
    }

    const headers = {};
    const purgePattern = /^proxy-/i;
    for (const key of Object.keys(clientRequest.headers)) {
      if(purgePattern.test(key))
        continue;
      headers[key] = clientRequest.headers[key];
    }

    try {
      state.uriObject = new URL(url);
    } catch (err) {
      return ctx.throw(400, err);
    }

    return new Promise((resolve, reject) => {
      const onerror = err => {
        err.status = 500;
        err.expose = true;
        return reject(err);
      };
      
      const outgoingRequest = request(
        state.uriObject, 
        {
          method: clientRequest.method,
          headers
        },
        incomingResponse => {
          responseToClient.writeHead(
            incomingResponse.statusCode,
            incomingResponse.statusMessage,
            incomingResponse.headers
          );
  
          this._pipe(incomingResponse, responseToClient).then(resolve, onerror);
        }
      );
  
      this._pipe(clientRequest, outgoingRequest).catch(onerror);
    });
  }

  // http connect method
  async _connectListener (ctx) {
    const { socket, state, url } = ctx;

    if(state.event !== "connect") {
      return next();
    }

    try {
      let { 0: hostname, 1: port = 80 } = url.split(/:(?=\d*$)/);

      if (/^\[.+?\]$/.test(hostname)) // ipv6
        hostname = hostname.replace(/^\[(.+?)\]$/, (_, hostname) => hostname);

      state.hostname = hostname;
      state.port = port;
    } catch (err) {
      return ctx.throw(400, err.message);
    }

    return new Promise((resolve, reject) => {
      const onerror = err => {
        err.status = 500;
        err.expose = true;
        return reject(err);
      };
  
      const outgoingSocket = connect(state.port, state.hostname, () => {
        state.status = 200;
        socket.write("HTTP/1.1 200 Connection Established");
        socket.write("\r\n\r\n");
  
        outgoingSocket.write(state.head);
        outgoingSocket.removeListener("error", onerror);
  
        this._pipe(socket, outgoingSocket, socket).then(resolve, onerror);
      });
      
      outgoingSocket.once("error", onerror);
    });
  }
}


export { App, ProxyServer };