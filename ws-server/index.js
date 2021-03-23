import { createServer, Server as HTTPServer } from "http";
import { channel } from "diagnostics_channel";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Writable } from "stream";
import { exec } from "child_process";
import { createHash } from "crypto";
import { strictEqual } from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const loggerChannel = channel("logger");
const log = {
  _root: join(__dirname, "./.log.hidden")
}

const wsServer = createServer((req, res) => {
  res.writeHead(
    426, "Upgrade to Web Socket Required", {
      "Connection": "Upgrade"
    }
  ).end("This service requires use of the Web Socket protocol");
  req.resume();
})
  .on("upgrade", (request, socket, head) => {
    if(notImplemented(request))
      return ;

    try {
      strictEqual(
        Buffer
          .from(req.headers['sec-websocket-key'], "base64")
          .length,
        16 // https://tools.ietf.org/html/rfc6455#section-4.2.1 point 5
      );
    } catch (err) {
      request.writeHead(400, "Bad Web Socket Upgrade Request")
            .end(`Bad sec-websocket-key: ${err.message}`);
      return ;
    }

    // https://tools.ietf.org/html/rfc6455#section-1.3
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

    const key = (
      createHash('sha1')
        .update(req.headers['sec-websocket-key'].concat(GUID))
        .digest('base64')
    );

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${key}`,
    ].join('\r\n').concat("\r\n\r\n"));
  })
;

wsServer
  .on("error", err => loggerChannel.publish(formatError(err)))
  .listen(22345, () => {
    console.info("Server running at", wsServer.address());
    exec(`start ${getServerAddress(wsServer, "ws:")}`, err => 
      err && loggerChannel.publish(formatError(err))
    ).unref();
  })


/**
 * message: { type, name, message, stack? }
 */
loggerChannel.subscribe(
  (rootDir => {
    if(!existsSync(rootDir))
      mkdirSync(rootDir);
    return (
      (message, name) => {
        if(typeof message.type !== "string") {
          console.warn("loggerChannel: typeof message.type !== 'string'");
          console.warn(message);

          message.type = "_default";
        }
    
        if(!(log[message.type] instanceof Writable)) {
          log[message.type] = createWriteStream(
            join(rootDir, `./${message.type}.log.txt`)
          );
        }
    
        log[message.type].write(message.stack || message.message);
        log[message.type].write("\n\n");
      }
    );
  })(log._root)
);

function getServerAddress(server, protocol) {
  const protocol = protocol || server instanceof HTTPServer ? "http:" : "https:";

  const address = server.address();
  return (
    address.family === "IPv6"
    ? `${protocol}//[${address.address}]:${address.port}`
    : `${protocol}//${address.address}:${address.port}`
  );
}

function formatError(err) {
  return {
    type: "error",
    ...err
  }
}

function checkCORS(request) {
  request.headers["origin"]
}

function notImplemented(request) {
  if(request.headers["sec-webSocket-protocol"]) {
    request.writeHead(
      501, "sec-webSocket-protocol Not Implemented"
    ).end("sec-webSocket-protocol Not Implemented");
    return false;
  }

  if(request.headers["sec-webSocket-extensions"]) {
    request.writeHead(
      501, "sec-webSocket-extensions Not Implemented"
    ).end("sec-webSocket-extensions Not Implemented");
    return false;
  }

  if(Number(request.headers["sec-webSocket-version"]) !== 13) {
    request.writeHead(
      501, 
      `sec-webSocket-version ${request.headers["sec-webSocket-version"]} Not Implemented`,
      {
        "Connection": "Upgrade"
      }
    ).end("sec-webSocket-version should be 13");
    return false;
  }

  return true;
}