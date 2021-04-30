import EventEmitter from "events";
import { Transform } from "stream";
/**
  0               1               2               3 
  4               5               6               7            
  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
  +-+-+-+-+-------+-+-------------+-------------------------------+
  |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
  |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
  |N|V|V|V|       |S|             |   (if payload len==126/127)   |
  | |1|2|3|       |K|             |                               |
  +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
  |     Extended payload length continued, if payload len == 127  |
  + - - - - - - - - - - - - - - - +-------------------------------+
 * 
 */
const kSource = Symbol("source");

/**
 * emit: ping, pong, opclose
 */
class Parser extends Transform {
  constructor () {
    super({
      readableObjectMode: true
    });

    this.flush();
  }

  _transform(chunk, encoding, cb) {
    const frame = {
      isFinal:       (chunk[0] & 128) === 128,   // 10000000
      opcode:         chunk[0] & 0b1111,         // binary number
      isMasked:      (chunk[1] & 128) === 128,   // 10000000 
      payloadLength:  chunk[1] & 127,            // 01111111, the first part
      payloadData:    null,
      type: "text"                               // text, binary, control
    };

    let startOffset = 2;
    switch(frame.payloadLength) {
      case 0: return cb();
      // Extended payload length 
      case 126: 
        frame.payloadLength = (chunk[2] << 8) + chunk[3];
        startOffset = 4;
        break;
      case 127:
        let payloadLength = 0;
        for (let i = 7; i >= 0; --i) {
          payloadLength += (chunk[startOffset++] << (i * 8)); // 2 ~ 9
        }
        frame.payloadLength = payloadLength;
    }

    const endOffset = startOffset + frame.payloadLength;
    if(chunk.length < endOffset) {
      return cb(new RangeError(`expected chunk.length >= ${endOffset}`));
    }

    // get payload data
    const rawData = chunk.slice(startOffset, endOffset);
    if (frame.isMasked) {
      const maskingKey = [
        chunk[startOffset++],
        chunk[startOffset++],
        chunk[startOffset++],
        chunk[startOffset++]
      ];

      frame.payloadData = (
        rawData
          .map((byte, index) => byte ^ maskingKey[index % 4])
      );
    } else {
      frame.payloadData = rawData;
    }

    // frame fragmentation / control
    // https://tools.ietf.org/html/rfc6455#section-5.2
    switch (frame.opcode) {
      case 0x0:
        if(this[kSource].payloadData.length) { // first frame buffered
          this[kSource].payloadData = Buffer.concat([
            this[kSource].payloadData,
            frame.payloadData
          ]);

          if(frame.isFinal) {
            cb(null, this[kSource]);
            this[kSource] = {
              payloadData: Buffer.from(""),
              type: "text"
            };
          } // terminated by a single frame with the FIN bit set and an opcode of 0
        } else {
          return cb(new Error("unexpected frame.opcode 0x0"));
        }
        return frame = null;
      
      case 0x1:
        frame.type = "text";
        if(frame.isFinal) {
          return cb(null, frame);
        } else {
          this[kSource] = {
            payloadData: frame.payloadData,
            type: frame.type
          };
          return frame = null;
        }

      case 0x2:
        frame.type = "binary";
        if(frame.isFinal) {
          return cb(null, frame);
        } else {
          this[kSource] = {
            payloadData: frame.payloadData,
            type: frame.type
          };
          return frame = null;
        }
      
      case 0x8:
        this.flush();
        this.emit("opclose", frame);
        return cb();
      case 0x9:
        return this.emit("ping", frame);
      case 0xA:
        return this.emit("pong", frame);
      default:
        return cb(new Error("an unknown opcode is received"));
    }
  }

  flush () {
    this[kSource] = {
      payloadData: Buffer.from(""),
      type: "text"
    };
  }
}

class Receiver extends EventEmitter {
  constructor (parserDataHandler = this._chunkToString) {
    this.parserDataHandler = parserDataHandler;
  }

  listen (webSocket) {
    this.parser = new Parser();
    this.ws = webSocket;
    this.ws.pipe(this.parser);
    this.ws.once("error", err => {
      this.ws.unpipe(this.parser);
      this.ws = null;
      this.parser.flush();
      this.emit("error", err);
    });
    this.parser
      .once("error", err => {
        this.ws.unpipe(this.parser);
        this.ws.destroy();
        this.ws = null;
        this.parser.flush();
        this.emit("error", err);
      })
      .on("ping", frame => {
        this.emit("ping", frame.payloadData);
      })
      .on("opclose", frame => {
        this.ws.unpipe(this.parser);
        this.ws.end();
        this.ws = null;
        this.parser.flush();
        this.parserDataHandler(
          frame,
          this._cb(data => {
            this.emit("close", data);
            process.nextTick(this.emit("free"));
          })
        );
      })
      .on("data", frame => {
        this.parserDataHandler(
          frame,
          this._cb(data => this.emit("data", data))
        );
      });

    return this;
  }

  _chunkToString ({ payloadData: chunk, type }, cb) {
    if(type === "binary")
      return cb(null, chunk);
    return cb(null, chunk.toString());
  }

  _cb (then) {
    return (err, data) => {
      if(err) return this.emit("error", err);

      return then(data);
    };
  }
}

class ReceiverCluster {
  constructor ({dataHandler = null, min = 1, max = 4} = {}) {
    this.dataHandler = dataHandler;
    this.pool = {
      free: new Array(min).fill(void 0).map(_ => new Receiver(dataHandler)),
      totalLength: min
    };
  }

  assign(webSocket) {
    let receiver;
    if(this.pool.free.length) {
      receiver = this.pool.free.shift();
    } else {
      receiver = new Receiver(this.dataHandler);
    }

    receiver
      .listen(webSocket)
      .once("free", () => {

      })
      .once("error")
  }
}

export default Receiver;