import { DarkModeToggle } from "./dark-mode-toggle/dark-mode-toggle.js";

class CopyableTextarea extends HTMLTextAreaElement{
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

customElements.define("copyable-textarea", CopyableTextarea, { extends: 'textarea' });

customElements.define("dark-mode-toggle", DarkModeToggle);
