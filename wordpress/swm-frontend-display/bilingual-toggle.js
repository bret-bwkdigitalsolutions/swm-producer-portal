(function () {
  "use strict";

  var STORAGE_KEY = "swm_preferred_lang";

  function init() {
    var toggle = document.querySelector(".swm-lang-toggle");
    if (!toggle) return;

    var buttons = toggle.querySelectorAll(".swm-lang-btn");
    var sections = document.querySelectorAll(".swm-lang-content");

    // Determine default language
    var stored = localStorage.getItem(STORAGE_KEY);
    var defaultLang = stored || (navigator.language.startsWith("es") ? "es" : "en");

    switchLang(defaultLang, buttons, sections);

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var lang = btn.getAttribute("data-lang");
        switchLang(lang, buttons, sections);
        localStorage.setItem(STORAGE_KEY, lang);
      });
    });
  }

  function switchLang(lang, buttons, sections) {
    buttons.forEach(function (btn) {
      var isActive = btn.getAttribute("data-lang") === lang;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    sections.forEach(function (section) {
      section.style.display = section.getAttribute("data-lang") === lang ? "" : "none";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
