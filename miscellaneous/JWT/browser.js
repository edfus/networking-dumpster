class JWT {
  static decode(jwt) {
    const parts = jwt.split(".");
    if (parts.length !== 3)
      throw new Error("parts.length !== 3");

    const { 0: header, 1: body, 2: signature } = parts;

    const token = {
      header: JSON.parse(this.base64urlDecode(header)),
      body: JSON.parse(this.base64urlDecode(body)),
      signature: this.base64urlDecode(signature)
    };

    this.deepStrictEqual(token.header, {
      "alg": "RS256",
      "typ": "JWT"
    });

    return token;
  }

  static claimNamesMap = {
    typ: "Type",
    alg: "Algorithm",
    iss: "Issuer",
    sub: "Subject",
    aud: "Audience",
    exp: "Expiration Time",
    nbf: "Not Before",
    iat: "Issued At",
    jti: "JWT ID",
    cty: "Content Type"
  };

  static readable (input) {
    if(typeof input !== "object") {
      if(this.claimNamesMap[input])
        return this.claimNamesMap[input];
      return input;
    }

    const newObj = {};
    
    for (const key in input) {
      newObj[this.claimNamesMap[key] ? this.claimNamesMap[key] : key] = input[key];
    }

    return newObj;
  }

  static base64urlDecode(data) {
    return atob(
      data.replace(/_/g, '/').replace(/-/g, '+')
    );
  }

  static base64urlEncode(data) {
    return btoa(
      data.replace(/\//g, '_').replace(/\+/g, '-')
    );
  }

  static _deepStrictEqualError(objA, objB) {
    return new Error([
      "NOT deepStrictEqual: ",
      JSON.stringify(objA, null, 4),
      JSON.stringify(objB, null, 4)
    ].join("\n"));
  }

  static deepStrictEqual(objA, objB) {
    const propsA = Object.keys(objA);
    const propsB = Object.keys(objB);

    if (propsA.length !== propsB)
      throw this._deepStrictEqualError(objA, objB);

    for (const prop of propsA) {
      switch (typeof objA[prop]) {
        case "object":
          deepStrictEqual(objA[prop], objB[prop]);
          continue;
        case "function":
          if (typeof objB !== "function")
            throw this._deepStrictEqualError(objA, objB);
          if (objA[prop].toString() !== objB[prop].toString())
            throw this._deepStrictEqualError(objA, objB);
          continue;
        default:
          if (objA[prop] !== objB[prop]) {
            throw this._deepStrictEqualError(objA, objB);
          }
      }
    }
  }
}

export default JWT;