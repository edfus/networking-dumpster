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
class Parser extends Transform {
  constructor () {
    super({
      readableObjectMode: true
    });
  }

  _transform(chunk, encoding, cb) {
    const frame = {
      isFinal:       (chunk[0] & 128) === 128,   // 10000000
      opCode:         chunk[0] & 0b1111,         // binary number
      isMasked:      (chunk[1] & 128) === 128,   // 10000000 
      payloadLength:  chunk[1] & 127,            // 01111111, the first part
      // maskingKey:     '',
      payloadData:    null
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

    const rawData = chunk.slice(startOffset, startOffset + frame.payloadLength);
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
      frame.payloadData = rawData
    }

    return cb(null, frame);
  }

  _flush(cb) {
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