// hypothesis-selector.js
//
// Handles ONLY the clicking/selection behaviour of the diagnosis-hypothesis
// selector (Healthy / Illness 1 / Illness 2 / Illness 3) added to the SHAP
// explanation card. It does not load or swap any data itself — it just
// tracks which hypothesis is active and hands off to whatever you wire up.
//
// Two ways to hook in the actual data-switching logic later:
//
//   1) Define window.onHypothesisChange(hypothesis) somewhere (e.g. in
//      index.js). It will be called with the selected hypothesis id
//      ("healthy" | "illness-1" | "illness-2" | "illness-3") every time
//      the user clicks a different option.
//
//   2) Or listen for the "hypothesis:change" custom event on the
//      #hypothesis-selector element instead:
//
//        document
//          .getElementById("hypothesis-selector")
//          .addEventListener("hypothesis:change", (e) => {
//            console.log(e.detail.hypothesis);
//          });

(function () {
  const selector = document.getElementById("hypothesis-selector");
  if (!selector) return;

  const buttons = selector.querySelectorAll(".hypothesis-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return; // already selected, nothing to do

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const hypothesis = btn.dataset.hypothesis;

      if (typeof window.onHypothesisChange === "function") {
        window.onHypothesisChange(hypothesis);
      }

      selector.dispatchEvent(
        new CustomEvent("hypothesis:change", { detail: { hypothesis } })
      );
    });
  });
})();
