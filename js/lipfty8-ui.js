(function () {
  "use strict";

  const current = document.getElementById("current-player");
  const status = document.getElementById("status");
  const timer = document.getElementById("move-timer");
  if (!current || !status || !timer) return;

  const playerCard = current.closest(".player-status-card");
  const timerCard = timer.closest(".move-timer-card");
  const playerLabel = playerCard?.querySelector(".turn-label");
  const timerLabel = timerCard?.querySelector(".turn-label");

  function settings() {
    try {
      return JSON.parse(localStorage.getItem("lipfty-settings") || "{}");
    } catch (_) {
      return {};
    }
  }

  function otherParticipant(receiver) {
    const s = settings();
    const player1 = (s.player1 || "Player").trim();
    const player2 = (s.player2 || "Player 2").trim();
    if (s.mode === "computer") return receiver === "Computer" ? player1 : "Computer";
    return receiver === player1 ? player2 : player1;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function updateDecisionDisplay() {
    const selectableReserve = document.querySelector(".board-cell--reserve-selectable");
    const message = status.textContent.trim();

    if (!selectableReserve) {
      setText(playerLabel, "Current turn");
      setText(timerLabel, "Move timer");
      return;
    }

    let chooser = null;
    let receiver = null;

    const normalHandover = message.match(/^(.+?): choose a reserve piece(?:\/colour)? for (.+?)\.$/);
    if (normalHandover) {
      chooser = normalHandover[1];
      receiver = normalHandover[2];
    } else if (message.includes("opponent chooses the first normal reserve piece")) {
      receiver = current.textContent.trim();
      chooser = otherParticipant(receiver);
      setText(status, `${chooser}: choose a reserve piece for ${receiver}.`);
    }

    /* Other selectable states, such as a responder choosing their own first
       compulsory placement or Final Four piece, already show the true actor. */
    if (!chooser || !receiver || chooser === receiver) {
      setText(playerLabel, "Current turn");
      setText(timerLabel, "Move timer");
      return;
    }

    setText(playerLabel, "Decision by");
    setText(current, chooser);
    setText(timerLabel, "Choice timer");
  }

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      updateDecisionDisplay();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  scheduleUpdate();
})();
