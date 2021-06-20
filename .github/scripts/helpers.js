const { Transform } = require("stream");

class StringReader extends Transform {
  constructor(maxLength = Infinity) {
    super({ readableObjectMode: true });
    this[Symbol.for("kLength")] = 0;
    this[Symbol.for("kMaxLength")] = maxLength;
    this[Symbol.for("kTmpSource")] = [];
  }

  _transform(chunk, enc, cb) {
    this[Symbol.for("kTmpSource")].push(chunk);
    if (this[Symbol.for("kLength")] += chunk.length > this[Symbol.for("kMaxLength")])
      return cb(new RangeError(`${this.constructor.name}: maxLength ${maxLength} reached.`));
    return cb();
  }

  _flush(cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    );

    try {
      return cb(null, data);
    } catch (err) {
      return cb(err);
    }
  }
}

class JSONParser extends StringReader {
  constructor(maxLength) {
    super({ maxLength });
  }

  async _flush(cb) {
    try {
      const data = await new Promise((resolve, reject) => {
        super._flush((err, str) => err ? reject(err) : resolve(str))
      });
      return cb(null, JSON.parse(data));
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = { JSONParser, StringReader };