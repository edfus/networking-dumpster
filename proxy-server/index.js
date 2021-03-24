import { connect, Socket } from "net";
import { createServer, request, Server } from "http";

const proxyAuth = Buffer.from("test:test").toString("base64");

class ProxyServer extends Server {
  _pipe (...streams) {
    const set = new Set(streams);
    const errorHandler = err => {
      set.forEach(s => s.destroy());
      set.clear();
      this.emit("error", err);
    };
    set.forEach(s => s.once("error", errorHandler));
    for (let i = 0; i < streams.length - 1; i++) {
      streams[i].pipe(streams[i + 1]);
    }
    streams = null;
  }

  verifyAuth (request, socket) {
    const auth = request.headers['proxy-authorization'];
    if (!auth || auth !== `Basic ${proxyAuth}`) {
      if (socket instanceof Socket) {
        socket.write([
          "HTTP/1.1 407 Proxy Authentication Required",
          'Proxy-Authenticate: Basic realm="proxy"',
          "Proxy-Connection: close"
        ].join('\r\n'));
        socket.end("\r\n\r\n\r\n");
      } else {
        const response = socket;
        response.writeHead(407, {
          "Proxy-Authenticate": 'Basic realm="proxy"',
          "Proxy-Connection": 'close'
        }).end();
      }
      return false;
    }
    delete request.headers['proxy-authorization'];
    return true;
  };

  requestListener (req, res) {
    try {
      const tmpErrorHandler = err => {
        res.writeHead(500, err.message).end(err.message);
        this.emit("error", err);
      };

      const serverReq = request(req.url, {
        method: req.method,
        headers: {
          "Authorization": `Basic ${serverAuth}`,
          ...req.headers,
        }
      })
        .once("response", serverRes => {
          serverReq.removeListener("error", tmpErrorHandler);
          res.writeHead(
            serverRes.statusCode,
            serverRes.statusMessage,
            serverRes.headers
          );
         this._pipe(serverRes, res);
        })
        .once("error", tmpErrorHandler);
      ;

     this._pipe(req, serverReq);
    } catch (err) {
      res.writeHead(400, "Bad Proxy Request").end(err.message);
      this.emit("error", err);
    }
  }

  // http connect method
  connectListener (request, socket, head) {
    try {
      let { 0: hostname, 1: port = 80 } = request.url.split(/:(?=\d*$)/);

      if (/^\[.+?\]$/.test(hostname))
        hostname = hostname.replace(/^\[(.+?)\]$/, (_, hostname) => hostname);

      const tmpErrorHandler = err => {
        socket.end(`HTTP/1.1 500 ${err.message}\r\n\r\n\r\n`);
        this.emit("error", err);
      };

      const serverSocket = connect(port, hostname, () => {
        socket.write("HTTP/1.1 200 Connection Established");
        socket.write("\r\n\r\n\r\n");

        serverSocket.write(head);
        serverSocket.removeListener("error", tmpErrorHandler);

       this._pipe(socket, serverSocket, socket);
      })
        .once("error", tmpErrorHandler)
      ;
    } catch (err) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n\r\n');
      this.emit("error", err);
    }
  }
}

function createProxyServer() {
  const proxyServer = new ProxyServer();

  const requestListener = function (req, res) {
    if(!proxyServer.verifyAuth(req, res))
      return ;

    return proxyServer.requestListener.call(proxyServer, req, res);
  }

  const connectListener = function (request, socket, head) {
    if(!proxyServer.verifyAuth(request, socket))
      return ;

    return proxyServer.requestListener.call(proxyServer, request, socket, head);
  }

  return createServer(requestListener)
          .on("connect", connectListener)
          .on("error", console.error)
  ;
}

export { ProxyServer, createProxyServer };