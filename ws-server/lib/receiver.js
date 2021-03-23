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

class Parser extends Transform {
  constructor () {
    super({
      readableObjectMode: true
    });

    this[kSource] = {
      payloadData: Buffer.from(""),
      type: "text"
    };
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
      return cb(new RangeError(`Expected chunk.length >= ${endOffset}`));
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
        this[kSource] = null;
        this.emit("opclose", frame);
        return this.end(cb); // close the writable side
      case 0x9:
        return this.emit("ping", frame);
      case 0xA:
        return this.emit("pong", frame);
      default:
        return cb(new Error("an unknown opcode is received"));
    }
  }

  _flush(cb) {
    this[kSource] = null;
    return cb();
  }
}

// act like a reverse proxy agent
class Receiver extends EventEmitter {
  constructor (webSocket) {
    this.parser = new Parser();
    this.ws = webSocket;
    this.ws.pipe(this.parser);

    this.ws.on("error", err => {})


    this.emit("")
  }

  _parserDataHandler () {

  }
}