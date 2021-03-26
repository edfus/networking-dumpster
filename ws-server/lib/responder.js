class BasicResponder {
  // no frame fragmentation
  encode (payloadData, type, opcode) {
    if (!opcode)
      opcode = type === "binary" ? 0x2 : 0x1;
  
    if(!(payloadData instanceof Buffer)) {
      payloadData = Buffer.from(payloadData);
    }
  
    const header = [(1 << 7) + opcode];
  
    if (payloadData.length < 126) {
      header.push(payloadData.length);
    } else if (payloadData.length < 65536) {
      header.push(126, payloadData.length >> 8, payloadData.length & 0xFF);
    } else { // >= 65536
      header.push(127);
      for (let i = 7; i >= 0; --i) {
        header.push((payloadData.length & (0xFF << (i * 8))) >> (i * 8));
      }
      // max: 2^63 bytes
    }
  
    return payloadData.length
            ? Buffer.concat([Buffer.from(header), payloadData])
            : Buffer.from(header)
    ;
  }

  close (webSocket, additionalData = "") {
    return webSocket.end(this.encode(additionalData, null, 0x8));
  }

  pong (webSocket, additionalData = "") {
    return webSocket.write(this.encode(additionalData, null, 0xA));
  }

  send (webSocket, payloadData = "", type = "text") {
    return webSocket.write(this.encode(payloadData, type));
  }

  assign(receiver, socket) {
    receiver.on("ping", () => this.pong(socket));
  }
}

export default BasicResponder;