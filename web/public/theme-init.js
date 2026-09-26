// Applies the saved theme before the first paint, so a dark-mode user never sees a white flash.
(function () {
  try {
    var saved = localStorage.getItem("theme") || "system";
    var dark = saved === "dark" || (saved === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    /* storage blocked: fall through to the light default */
  }
})();
