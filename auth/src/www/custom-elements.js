import { DarkModeToggle } from "./dark-mode-toggle/dark-mode-toggle.js";
import JWT from "./json-web-token/jwt.js";

const jwtTemplate = document.createElement("template");
const jwtStyle    = document.createElement("style");
const jwtContent  = document.createElement("section");

jwtStyle.textContent   = `"{{IMPORT('./json-web-token/template.css')}}"`;
jwtContent.textContent = `"{{IMPORT('./json-web-token/template.html')}}"`;

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