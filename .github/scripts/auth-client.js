const crypto = require("crypto");

class Auth {
  constructor(credentials) {
    if (!credentials.key) {
      throw new Error("!credentials.key");
    }
    if (!credentials.secret) {
      throw new Error("!credentials.secret");
    }
    this.credentials = credentials;
  }

  get(url) {
    return this.request(url, "get");
  }

  post(url) {
    return this.request(url, "post");
  }

  request(url, method) {
    const authData = this._getAuthData(this.credentials, url, method);

    return {
      "Authorization": "WTFAuth ".concat(
        Object.entries(authData)
          // .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
          .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
          .join(", ")
      )
    };
  }

  _getAuthData(credentials, url, method) {
    const authData = {
      auth_token: credentials.key,
      auth_nonce: crypto.randomBytes(32).toString("base64"),
      auth_timestamp: parseInt(Date.now() / 1000),
      auth_signature_method: "HMAC-SHA1"
    };

    if (!(url instanceof URL)) {
      throw new TypeError("Expected param url to be an instance of URL");
    }

    const uriObject = new URL(url);

    for (const key in authData) {
      uriObject.searchParams.append(key, authData[key]);
    }

    uriObject.searchParams.sort();

    const toBeSigned = [
      method.toUpperCase(),
      uriObject.toString()
    ].join(";");

    // signature
    authData.auth_signature = (
      crypto
        .createHmac(
          "sha1",
          Buffer.from(credentials.secret, "base64")
        )
        .update(toBeSigned)
        .digest("base64")
    );

    return authData;
  }
}

function percentEncode(str) {
  return encodeURIComponent(str)
    // for posting status, etc.
    .replace(/\!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/\"/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
};

module.exports = { Auth };