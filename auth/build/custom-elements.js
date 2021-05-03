import { DarkModeToggle } from "./dark-mode-toggle/dark-mode-toggle.js";
import JWT from "./json-web-token/jwt.js";

const jwtTemplate = document.createElement("template");
const jwtStyle    = document.createElement("style");
const jwtContent  = document.createElement("section");

jwtStyle.textContent   = `
@import url("./style/root.css");

[part="tab-wrap"]{
  width: 100%;
}

[part="tab-nav"] {
  margin-bottom: 1.5em;
  display: flex;
  width: 100%;
}

[part="tab-button"] {
  text-decoration: none;
  text-align: center;
  border: 0;
  width: 50%;
  outline: none;
  cursor: pointer;
  background-color: inherit;
}

label {
  border-top: 1px solid rgba(155,155,155,0.5);
  border-bottom: 1px solid rgba(155,155,155,0.5);
  line-height: 2.5;
  padding: 0 .7em;
}

[part="tab"] {
  width: 100%;
  display: none;
}
[part="tab"].current {
  display: block;
}

[part="tab-button"] {
  font-size: 1em;
  padding-bottom: .3em;
  border-bottom: .3em solid transparent;
}

[part="tab-button"].current {
  border-bottom: .3em solid #fb015b;
}

#decoded-jwt-header {
  color: #fb015b;
}
#decoded-jwt-payload {
  color: #d63aff;
}
#decoded-jwt-signature {
  color: #00b9f1;
}
#encoded-jwt-content {
  color: chartreuse;
}
#encoded-jwt-invalid-log {
  color: crimson;
}
`;
jwtContent.textContent = `
<section part="tab-wrap">
  <nav part="tab-nav" id="jwt-switch">
    <button type="button" part="tab-button" class="current" for="encoded-jwt">Encoded</button>
    <button type="button" part="tab-button" for="decoded-jwt">Decoded</button>
  </nav>
  <div part="tab-content" id="jwt-tab">
    <div class="current" part="tab" id="encoded-jwt">
      <pre id="encoded-jwt-content" contenteditable></pre>
      <pre id="encoded-jwt-invalid-log"></pre>
    </div>
    <div id="decoded-jwt" part="tab">
      <div>
        <label for="decoded-jwt-header">HEADER:</label>
        <textarea id="decoded-jwt-header"></textarea>
      </div>
      <div>
        <label for="decoded-jwt-payload">PAYLOAD:</label>
        <textarea id="decoded-jwt-payload"></textarea>
      </div>
      <div>
        <label for="decoded-jwt-signature">SIGNATURE:</label>
        <textarea id="decoded-jwt-signature"></textarea>
      </div>
    </div>
  </div>
</section>
`;

jwtTemplate.appendChild(jwtContent);
jwtTemplate.appendChild(jwtStyle);

class JWTComponent extends HTMLElement {
  constructor() {
    super();
    const shadowRoot = this.attachShadow({mode: 'open'});
    shadowRoot.appendChild(jwtTemplate.content.cloneNode(true));

    this.encodedJWTContent = shadowRoot.getElementById("encoded-jwt-content");
    this.encodedJWTInvalidLog = shadowRoot.getElementById("encoded-jwt-invalid-log");

    this.decodedJWTHeader = shadowRoot.getElementById("decoded-jwt-header");
    this.decodedJWTPayload = shadowRoot.getElementById("decoded-jwt-payload");
    this.decodedJWTSignature = shadowRoot.getElementById("decoded-jwt-signature");

    const switches = shadowRoot.querySelectorAll("#jwt-switch > button[for]");
    const tabs = shadowRoot.querySelectorAll("#jwt-tab > div");
    const reset = () => {
      tabs.forEach(
        t => t.classList.remove("current")
      );
      switches.forEach(
        s => s.classList.remove("current")
      );
    };

    switches.forEach(
      s => {
        s.addEventListener("click", event => {
          const id  = event.target.getAttribute("for");
          const dom = shadowRoot.getElementById(id);
          if(dom) {
            reset();
            dom.classList.add("current");
            event.target.classList.add("current");
          }
        });
      }
    );

    this.encodedJWTContent.addEventListener("input", () => {
      let token;
      try {
        token = JWT.decode(jwt.value);
      } catch (err) {
        return encodedJWTInvalidLog.innerText = "Invalid JWT: ".concat(err.message);
      }

      this.decodedJWTHeader.value = JWT.readable(token.header);
      this.decodedJWTPayload.value = JWT.readable(token.payload);
      this.decodedJWTSignature.value = JWT.readable(token.signature);

      this.token = token;
      this.dispatchEvent(new Event("token"));
    }, { passive: true });
  }
}

class CopyableInput extends HTMLInputElement {
  copy () {
    if(!this.value)
      return false;
    if (navigator.clipboard) {  
      return navigator.clipboard.writeText(this.value);
    }
    
    if (document.queryCommandSupported('copy')) {
      this.select();
      return document.execCommand("Copy");
    }

    return false;
  }
}

customElements.define("copyable-input", CopyableInput, { extends: 'input' });
customElements.define("dark-mode-toggle", DarkModeToggle);
customElements.define("json-web-token", JWTComponent);