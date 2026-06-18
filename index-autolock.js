<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LiveChat Widget — AutoLock</title>
<style>
  :root {
    --lc-red:      #c0392b;
    --lc-red-dark: #a93226;
    --lc-red-soft: #e74c3c;
    --lc-bg:       #1a1212;
    --lc-bg2:      #221818;
    --lc-bg3:      #2e1f1f;
    --lc-border:   #3d2222;
    --lc-border2:  #4a2828;
  }

  #lc-launcher {
    position: fixed; bottom: 24px; right: 24px; z-index: 99998;
    width: 58px; height: 58px; border-radius: 50%;
    background: var(--lc-red); border: none; cursor: pointer;
    box-shadow: 0 4px 24px rgba(192,57,43,0.5);
    display: flex; align-items: center; justify-content: center;
    transition: background 0.18s, transform 0.18s;
  }
  #lc-launcher:hover { background: var(--lc-red-dark); transform: scale(1.06); }
  #lc-launcher svg { width: 26px; height: 26px; fill: #fff; }
  #lc-launcher .lc-badge {
    position: absolute; top: 2px; right: 2px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff; border: 2px solid var(--lc-red); display: none;
  }

  #lc-window {
    position: fixed; bottom: 94px; right: 24px; z-index: 99999;
    width: 360px; max-height: 560px;
    background: var(--lc-bg2); border-radius: 14px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--lc-border);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px; transition: opacity 0.2s, transform 0.2s;
    transform-origin: bottom right;
  }
  #lc-window.lc-hidden { opacity: 0; pointer-events: none; transform: scale(0.92) translateY(8px); }

  /* Header */
  #lc-header {
    background: linear-gradient(135deg, var(--lc-red-dark) 0%, var(--lc-red) 100%);
    padding: 14px 16px 12px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  }
  #lc-header .lc-logo {
    width: 36px; height: 36px; border-radius: 8px;
    background: rgba(255,255,255,0.18);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  #lc-header .lc-logo svg { width: 20px; height: 20px; fill: #fff; }
  #lc-header .lc-info { flex: 1; min-width: 0; }
  #lc-header .lc-name { font-weight: 700; font-size: 14px; color: #fff; line-height: 1.2; }
  #lc-header .lc-status { font-size: 11px; color: rgba(255,255,255,0.75); display: flex; align-items: center; gap: 4px; margin-top: 2px; }
  #lc-header .lc-dot { width: 7px; height: 7px; border-radius: 50%; background: #6effa0; display: inline-block; box-shadow: 0 0 6px #6effa0; }
  #lc-header .lc-dot-offline { width: 7px; height: 7px; border-radius: 50%; background: #ffb347; display: inline-block; box-shadow: 0 0 6px #ffb347; }
  .lc-header-btn {
    background: rgba(255,255,255,0.15); border: none; cursor: pointer;
    color: #fff; padding: 5px; display: flex; align-items: center;
    border-radius: 6px; transition: background 0.15s;
  }
  .lc-header-btn:hover { background: rgba(255,255,255,0.28); }
  .lc-header-btn svg { width: 16px; height: 16px; fill: currentColor; }

  /* Intro */
  #lc-intro {
    padding: 20px 16px; flex: 1;
    display: flex; flex-direction: column; gap: 12px;
    overflow-y: auto; background: var(--lc-bg2);
  }
  #lc-intro p { margin: 0; color: #c9a8a8; line-height: 1.5; font-size: 13.5px; }
  #lc-intro label { font-size: 11.5px; font-weight: 700; color: #a07070; text-transform: uppercase; letter-spacing: 0.06em; display: block; margin-bottom: 5px; }
  #lc-intro input, #lc-offline-form input, #lc-offline-form textarea {
    width: 100%; box-sizing: border-box; padding: 9px 12px;
    border: 1px solid var(--lc-border2); border-radius: 7px;
    font-size: 14px; outline: none;
    background: var(--lc-bg3); color: #f0dede;
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  #lc-intro input:focus, #lc-offline-form input:focus, #lc-offline-form textarea:focus {
    border-color: var(--lc-red-soft); box-shadow: 0 0 0 3px rgba(231,76,60,0.15);
  }
  #lc-intro input::placeholder, #lc-offline-form input::placeholder, #lc-offline-form textarea::placeholder { color: #6b4040; }

  /* Previous sessions link on intro */
  #lc-history-link {
    display: none; text-align: center;
    font-size: 12px; color: #a07070;
    margin-top: 2px;
  }
  #lc-history-link button {
    background: none; border: none; cursor: pointer;
    color: var(--lc-red-soft); font-size: 12px; text-decoration: underline;
    padding: 0;
  }
  #lc-history-link button:hover { color: #f0dede; }

  #lc-start-btn {
    width: 100%; padding: 11px;
    background: linear-gradient(135deg, var(--lc-red) 0%, var(--lc-red-soft) 100%);
    color: #fff; border: none; border-radius: 7px;
    font-size: 14px; font-weight: 700; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    margin-top: 4px; letter-spacing: 0.03em;
    box-shadow: 0 3px 12px rgba(192,57,43,0.4);
  }
  #lc-start-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  #lc-start-btn:active { transform: translateY(0); }
  #lc-start-btn:disabled { background: var(--lc-border2); color: #6b4040; cursor: not-allowed; box-shadow: none; transform: none; }

  /* ── Offline form ── */
  #lc-offline {
    padding: 20px 16px; flex: 1;
    display: none; flex-direction: column; gap: 12px;
    overflow-y: auto; background: var(--lc-bg2);
  }
  .lc-offline-notice {
    display: flex; align-items: flex-start; gap: 10px;
    background: var(--lc-bg3); border: 1px solid var(--lc-border2);
    border-radius: 9px; padding: 12px 13px;
  }
  .lc-offline-notice svg { width: 18px; height: 18px; fill: #ffb347; flex-shrink: 0; margin-top: 1px; }
  .lc-offline-notice p { margin: 0; color: #c9a8a8; font-size: 13px; line-height: 1.55; }
  .lc-offline-notice strong { color: #f0dede; display: block; margin-bottom: 3px; font-size: 13.5px; }
  #lc-offline-form { display: flex; flex-direction: column; gap: 12px; }
  #lc-offline-form label { font-size: 11.5px; font-weight: 700; color: #a07070; text-transform: uppercase; letter-spacing: 0.06em; display: block; margin-bottom: 5px; }
  #lc-offline-form textarea { resize: none; min-height: 80px; line-height: 1.5; }
  #lc-offline-send-btn {
    width: 100%; padding: 11px;
    background: linear-gradient(135deg, var(--lc-red) 0%, var(--lc-red-soft) 100%);
    color: #fff; border: none; border-radius: 7px;
    font-size: 14px; font-weight: 700; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    margin-top: 4px; letter-spacing: 0.03em;
    box-shadow: 0 3px 12px rgba(192,57,43,0.4);
  }
  #lc-offline-send-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  #lc-offline-send-btn:disabled { background: var(--lc-border2); color: #6b4040; cursor: not-allowed; box-shadow: none; transform: none; }

  /* Offline confirmation */
  #lc-offline-thanks {
    display: none; flex: 1; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; padding: 32px 20px; text-align: center;
    background: var(--lc-bg2);
  }
  #lc-offline-thanks svg { width: 44px; height: 44px; fill: #6effa0; }
  #lc-offline-thanks strong { font-size: 15px; color: #f0dede; display: block; }
  #lc-offline-thanks p { margin: 0; color: #c9a8a8; font-size: 13.5px; line-height: 1.6; }

  /* Chat */
  #lc-chat { display: none; flex: 1; flex-direction: column; min-height: 0; }
  #lc-messages {
    flex: 1; overflow-y: auto; padding: 14px 14px 8px;
    display: flex; flex-direction: column; gap: 8px;
    min-height: 0; background:#ffffff;
  }
  #lc-messages::-webkit-scrollbar { width: 4px; }
  #lc-messages::-webkit-scrollbar-track { background: transparent; }
  #lc-messages::-webkit-scrollbar-thumb { background: var(--lc-border2); border-radius: 2px; }

  .lc-msg {
    max-width: 82%; padding: 9px 13px; border-radius: 14px;
    line-height: 1.5; word-break: break-word; font-size: 13.5px;
  }
  .lc-msg-customer {
    align-self: flex-end;
    background: linear-gradient(135deg, var(--lc-red) 0%, var(--lc-red-soft) 100%);
    color: #fff; font-weight: 500; border-bottom-right-radius: 3px;
    box-shadow: 0 2px 8px rgba(192,57,43,0.35);
  }
  .lc-msg-agent {
    align-self: flex-start; background: var(--lc-bg3); color: #f0dede;
    border: 1px solid var(--lc-border2); border-bottom-left-radius: 3px;
  }
  .lc-msg-system {
    align-self: center; font-size: 11.5px; color: #6b4040; background: none; padding: 2px 0;
  }

  #lc-input-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-top: 1px solid var(--lc-border);
    background: var(--lc-bg2); flex-shrink: 0;
  }
  #lc-msg-input {
    flex: 1; padding: 8px 12px; border: 1px solid var(--lc-border2); border-radius: 20px;
    font-size: 13.5px; outline: none; background: var(--lc-bg3); color: #f0dede;
    transition: border-color 0.15s, box-shadow 0.15s;
    resize: none; line-height: 1.4; max-height: 80px; overflow-y: auto; font-family: inherit;
  }
  #lc-msg-input:focus { border-color: var(--lc-red-soft); box-shadow: 0 0 0 3px rgba(231,76,60,0.12); }
  #lc-msg-input::placeholder { color: #6b4040; }
  #lc-send-btn {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg, var(--lc-red) 0%, var(--lc-red-soft) 100%);
    border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: opacity 0.15s, transform 0.1s;
    box-shadow: 0 2px 8px rgba(192,57,43,0.4);
  }
  #lc-send-btn:hover { opacity: 0.88; transform: scale(1.05); }
  #lc-send-btn:disabled { background: var(--lc-border2); box-shadow: none; cursor: not-allowed; }
  #lc-send-btn svg { width: 15px; height: 15px; fill: #fff; }

  #lc-end-bar { text-align: center; padding: 6px 12px 10px; background: var(--lc-bg2); flex-shrink: 0; }
  #lc-end-btn {
    background: none; border: none; font-size: 11.5px; color: #6b4040;
    cursor: pointer; text-decoration: underline; transition: color 0.15s;
  }
  #lc-end-btn:hover { color: #c9a8a8; }

  /* Closed */
  #lc-closed {
    display: none; padding: 32px 20px; text-align: center; flex: 1;
    flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: var(--lc-bg2);
  }
  #lc-closed svg { width: 40px; height: 40px; fill: var(--lc-border2); margin-bottom: 4px; }
  #lc-closed p { margin: 0; line-height: 1.6; color: #a07070; }
  #lc-closed strong { display: block; font-size: 15px; color: #f0dede; margin-bottom: 6px; }
  .lc-closed-btns { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 8px; }
  #lc-new-chat-btn {
    padding: 10px 22px;
    background: linear-gradient(135deg, var(--lc-red) 0%, var(--lc-red-soft) 100%);
    color: #fff; border: none; border-radius: 7px;
    font-size: 13.5px; font-weight: 700; cursor: pointer;
    letter-spacing: 0.03em; box-shadow: 0 3px 12px rgba(192,57,43,0.4);
    transition: opacity 0.15s, transform 0.1s;
  }
  #lc-new-chat-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  #lc-view-history-btn {
    padding: 9px 22px;
    background: transparent;
    color: #a07070; border: 1px solid var(--lc-border2); border-radius: 7px;
    font-size: 13px; cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  #lc-view-history-btn:hover { color: #f0dede; border-color: #6b4040; }

  /* History list screen */
  #lc-history {
    display: none; flex: 1; flex-direction: column; min-height: 0; background: var(--lc-bg2);
  }
  #lc-history-list {
    flex: 1; overflow-y: auto; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  #lc-history-list::-webkit-scrollbar { width: 4px; }
  #lc-history-list::-webkit-scrollbar-thumb { background: var(--lc-border2); border-radius: 2px; }
  .lc-session-item {
    background: var(--lc-bg3); border: 1px solid var(--lc-border2);
    border-radius: 10px; padding: 12px 14px; cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .lc-session-item:hover { border-color: var(--lc-red-soft); background: #331f1f; }
  .lc-session-item .lc-si-date { font-size: 11px; color: #6b4040; margin-bottom: 4px; }
  .lc-session-item .lc-si-preview { font-size: 13px; color: #c9a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lc-session-item .lc-si-count { font-size: 11px; color: #6b4040; margin-top: 4px; }
  #lc-history-empty { padding: 40px 20px; text-align: center; color: #6b4040; font-size: 13px; }
  #lc-history-back-bar {
    padding: 8px 12px 12px; border-top: 1px solid var(--lc-border);
    background: var(--lc-bg2); flex-shrink: 0; text-align: center;
  }
  #lc-history-back-btn {
    background: none; border: none; font-size: 12px; color: #6b4040;
    cursor: pointer; text-decoration: underline; transition: color 0.15s;
  }
  #lc-history-back-btn:hover { color: #c9a8a8; }

  /* Session detail (read-only) */
  #lc-session-detail {
    display: none; flex: 1; flex-direction: column; min-height: 0; background: var(--lc-bg2);
  }
  #lc-session-detail-msgs {
    flex: 1; overflow-y: auto; padding: 14px 14px 8px;
    display: flex; flex-direction: column; gap: 8px;
    min-height: 0; background: var(--lc-bg);
  }
  #lc-session-detail-msgs::-webkit-scrollbar { width: 4px; }
  #lc-session-detail-msgs::-webkit-scrollbar-thumb { background: var(--lc-border2); border-radius: 2px; }
  #lc-detail-back-bar {
    padding: 8px 12px 12px; border-top: 1px solid var(--lc-border);
    background: var(--lc-bg2); flex-shrink: 0; text-align: center;
  }
  #lc-detail-back-btn {
    background: none; border: none; font-size: 12px; color: #6b4040;
    cursor: pointer; text-decoration: underline; transition: color 0.15s;
  }
  #lc-detail-back-btn:hover { color: #c9a8a8; }
  .lc-readonly-badge {
    align-self: center; margin: 4px 0 8px;
    font-size: 11px; color: #6b4040;
    background: var(--lc-bg3); border: 1px solid var(--lc-border2);
    border-radius: 20px; padding: 3px 10px;
  }

  #lc-error {
    display: none; margin: 8px 12px 0; padding: 8px 12px;
    background: #2d0f0f; border: 1px solid var(--lc-red-dark);
    border-radius: 6px; font-size: 12px; color: #ff9a9a; flex-shrink: 0;
  }

  @media (max-width: 400px) {
    #lc-window { width: calc(100vw - 24px); right: 12px; bottom: 82px; }
    #lc-launcher { right: 12px; bottom: 12px; }
  }
</style>
</head>
<body>

<button id="lc-launcher" aria-label="Öppna live chat">
  <svg viewBox="0 0 24 24"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H6l-2 2V4h16v10z"/></svg>
  <span class="lc-badge" id="lc-badge"></span>
</button>

<div id="lc-window" class="lc-hidden" role="dialog" aria-label="Live chat">

  <div id="lc-header">
    <div class="lc-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
    </div>
    <div class="lc-info">
      <div class="lc-name" id="lc-header-title">AutoLock Support</div>
      <div class="lc-status" id="lc-status-line">
        <span class="lc-dot" id="lc-status-dot"></span>
        <span id="lc-status-text">Online nu</span>
      </div>
    </div>
    <button class="lc-header-btn" id="lc-close-btn" aria-label="Stäng chat">
      <svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>
    </button>
  </div>

  <div id="lc-error"></div>

  <!-- Intro / start form (online hours) -->
  <div id="lc-intro">
    <div id="lc-closed-notice" style="display:none;background:#1a0a0a;border:1px solid #3a1f1f;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:#c9a8a8;line-height:1.55;">
      <span style="color:#ffb347;font-weight:700;display:block;margin-bottom:3px;">⏰ ⏰ Vi är för tillfället stängda</span>
      Ditt meddelande är mottaget och vi återkommer under våra öppettider (mån–fre 08–16).
    </div>
    <p>Har du frågor om stöldskydd eller utrustning till din skåpbil? Vi finns här!</p>
    <div>
      <label for="lc-name-input">Namn</label>
      <input type="text" id="lc-name-input" placeholder="Ditt namn" autocomplete="given-name">
    </div>
    <div>
      <label for="lc-email-input">E-post</label>
      <input type="email" id="lc-email-input" placeholder="din@email.se" autocomplete="email">
    </div>
    <div>
      <label for="lc-phone-input">Telefon <span style="font-weight:400;color:#555;text-transform:none">((valfritt))</span></label>
      <input type="tel" id="lc-phone-input" placeholder="+46 12 345 67 89" autocomplete="tel">
    </div>
    <button id="lc-start-btn">Starta chat</button>
    <div id="lc-history-link">
      <button id="lc-show-history-btn">Se tidigare samtal</button>
    </div>
  </div>

  <!-- Offline / eftermiddag: efterlad besked -->
  <div id="lc-offline">
    <div class="lc-offline-notice">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      <p>
        <strong>Vi är stängda för idag</strong>
        Skriv dina uppgifter så återkommer vi när kontoret öppnar igen.
      </p>
    </div>
    <div id="lc-offline-form">
      <div>
        <label for="lc-off-name">Namn</label>
        <input type="text" id="lc-off-name" placeholder="Ditt namn" autocomplete="given-name">
      </div>
      <div>
        <label for="lc-off-email">E-post</label>
        <input type="email" id="lc-off-email" placeholder="din@email.se" autocomplete="email">
      </div>
      <div>
        <label for="lc-off-phone">Telefon <span style="font-weight:400;color:#555;text-transform:none">((valfritt))</span></label>
        <input type="tel" id="lc-off-phone" placeholder="+46 12 345 67 89" autocomplete="tel">
      </div>
      <div>
        <label for="lc-off-msg">Meddelande</label>
        <textarea id="lc-off-msg" placeholder="Beskriv vad du behöver hjälp med…" rows="3"></textarea>
      </div>
      <button id="lc-offline-send-btn">Skicka meddelande</button>
    </div>
  </div>

  <!-- Offline tak-skærm -->
  <div id="lc-offline-thanks">
    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
    <strong>Meddelande mottaget!</strong>
    <p>Tack — vi återkommer till dig så snart som möjligt när kontoret öppnar igen.</p>
  </div>

  <!-- Active chat -->
  <div id="lc-chat">
    <div id="lc-messages" role="log" aria-live="polite"></div>
    <div id="lc-input-bar">
      <textarea id="lc-msg-input" rows="1" placeholder="Skriv ditt meddelande…" aria-label="Skriv besked"></textarea>
      <button id="lc-send-btn" aria-label="Skicka">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
    <div id="lc-end-bar">
      <button id="lc-end-btn">Avsluta chat</button>
    </div>
  </div>

  <!-- Chat ended -->
  <div id="lc-closed">
    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
    <p><strong>Chat avslutad</strong>Tack för din förfrågan till AutoLock. Vi återkommer så snart som möjligt.</p>
    <div class="lc-closed-btns">
      <button id="lc-new-chat-btn">Starta ny chat</button>
      <button id="lc-view-history-btn">Se tidigare samtal</button>
    </div>
  </div>

  <!-- History list -->
  <div id="lc-history">
    <div id="lc-history-list"></div>
    <div id="lc-history-back-bar">
      <button id="lc-history-back-btn">← Tillbaka</button>
    </div>
  </div>

  <!-- Session detail (read-only) -->
  <div id="lc-session-detail">
    <div id="lc-session-detail-msgs"></div>
    <div id="lc-detail-back-bar">
      <button id="lc-detail-back-btn">← Tillbaka till samtal</button>
    </div>
  </div>

</div>

<script>
(function () {
  var API_BASE = 'https://livechat-ecru-seven.vercel.app'; // Relativ URL – virker både lokalt og på Vercel
  var LS_KEY   = 'autolock_chat_sessions_se';

  // ── Office hours: 08:00–16:00 (Danish local time) ─────────────────────────
  var OFFICE_OPEN_HOUR  = 8;
  var OFFICE_CLOSE_HOUR = 16;

  function isOfficeOpen() {
    var now = new Date();
    var hour = parseInt(now.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', hour: 'numeric', hour12: false }), 10);
    return hour >= OFFICE_OPEN_HOUR && hour < OFFICE_CLOSE_HOUR;
  }

  var sessionId   = null;
  var lastMsgId   = 0;
  var pollTimer   = null;
  var isOpen      = false;
  var currentMsgs = [];

  var historyBackTarget = 'intro';

  var launcher        = document.getElementById('lc-launcher');
  var badge           = document.getElementById('lc-badge');
  var win             = document.getElementById('lc-window');
  var closeBtn        = document.getElementById('lc-close-btn');
  var headerTitle     = document.getElementById('lc-header-title');
  var statusDot       = document.getElementById('lc-status-dot');
  var statusText      = document.getElementById('lc-status-text');
  var introEl         = document.getElementById('lc-intro');
  var offlineEl       = document.getElementById('lc-offline');
  var offlineThanksEl = document.getElementById('lc-offline-thanks');
  var chatEl          = document.getElementById('lc-chat');
  var closedEl        = document.getElementById('lc-closed');
  var historyEl       = document.getElementById('lc-history');
  var historyList     = document.getElementById('lc-history-list');
  var sessionDetailEl = document.getElementById('lc-session-detail');
  var detailMsgsEl    = document.getElementById('lc-session-detail-msgs');
  var errorEl         = document.getElementById('lc-error');
  var nameInput       = document.getElementById('lc-name-input');
  var emailInput      = document.getElementById('lc-email-input');
  var phoneInput      = document.getElementById('lc-phone-input');
  var startBtn        = document.getElementById('lc-start-btn');
  var historyLink     = document.getElementById('lc-history-link');
  var showHistoryBtn  = document.getElementById('lc-show-history-btn');
  var messagesEl      = document.getElementById('lc-messages');
  var msgInput        = document.getElementById('lc-msg-input');
  var sendBtn         = document.getElementById('lc-send-btn');
  var endBtn          = document.getElementById('lc-end-btn');
  var newChatBtn      = document.getElementById('lc-new-chat-btn');
  var viewHistoryBtn  = document.getElementById('lc-view-history-btn');
  var historyBackBtn  = document.getElementById('lc-history-back-btn');
  var detailBackBtn   = document.getElementById('lc-detail-back-btn');

  var offSendBtn  = document.getElementById('lc-offline-send-btn');
  var offName     = document.getElementById('lc-off-name');
  var offEmail    = document.getElementById('lc-off-email');
  var offPhone    = document.getElementById('lc-off-phone');
  var offMsg      = document.getElementById('lc-off-msg');

  var CHAT_SVG  = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H6l-2 2V4h16v10z"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>';

  function updateStatusIndicator() {
    if (isOfficeOpen()) {
      statusDot.className = 'lc-dot';
      statusText.textContent = 'Online nu';
    } else {
      statusDot.className = 'lc-dot-offline';
      statusText.textContent = 'Åbner igen kl. 08:00';
    }
  }

  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch(e) { return []; }
  }

  function saveSessions(sessions) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(sessions)); } catch(e) {}
  }

  function saveSession(id, name, messages) {
    var sessions = loadSessions();
    sessions = sessions.filter(function(s) { return s.id !== id; });
    sessions.unshift({ id: id, name: name, date: new Date().toISOString(), messages: messages });
    if (sessions.length > 20) sessions = sessions.slice(0, 20);
    saveSessions(sessions);
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return 'Lige nu';
    if (diff < 3600000) return Math.floor(diff/60000) + ' min siden';
    if (diff < 86400000) return 'I dag ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    return d.getDate() + '/' + (d.getMonth()+1) + '/' + d.getFullYear();
  }

  function showOnly(el) {
    [introEl, offlineEl, offlineThanksEl, chatEl, closedEl, historyEl, sessionDetailEl].forEach(function(e) {
      e.style.display = 'none';
    });
    el.style.display = 'flex';
  }

  function toggleChat() {
    isOpen = !isOpen;
    win.classList.toggle('lc-hidden', !isOpen);
    badge.style.display = 'none';
    launcher.innerHTML = (isOpen ? CLOSE_SVG : CHAT_SVG) + '<span class="lc-badge" id="lc-badge" style="display:none"></span>';
    badge = document.getElementById('lc-badge');

    if (isOpen && !sessionId) {
      updateStatusIndicator();
      refreshHistoryLink();
      showOnly(introEl);
      var closedNotice = document.getElementById('lc-closed-notice');
      if (closedNotice) closedNotice.style.display = isOfficeOpen() ? 'none' : 'block';
      nameInput.focus();
    }
    if (isOpen && sessionId) msgInput.focus();
  }

  launcher.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', function() { isOpen = true; toggleChat(); });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    setTimeout(function() { errorEl.style.display = 'none'; }, 5000);
  }

  function refreshHistoryLink() {
    var sessions = loadSessions();
    historyLink.style.display = sessions.length > 0 ? 'block' : 'none';
  }

  showHistoryBtn.addEventListener('click', function() {
    historyBackTarget = 'intro';
    openHistory();
  });

  viewHistoryBtn.addEventListener('click', function() {
    historyBackTarget = 'closed';
    openHistory();
  });

  offSendBtn.addEventListener('click', submitOfflineForm);

  function submitOfflineForm() {
    var name  = offName.value.trim();
    var email = offEmail.value.trim();
    var msg   = offMsg.value.trim();

    if (!name)  { showError('Vänligen ange ditt namn.'); offName.focus(); return; }
    if (!email) { showError('Vänligen ange din e-postadress.'); offEmail.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Ange en giltig e-postadress.'); offEmail.focus(); return; }
    if (!msg)   { showError('Vänligen skriv ett meddelande.'); offMsg.focus(); return; }

    offSendBtn.disabled = true;
    offSendBtn.textContent = 'Skickar…';

    fetch(API_BASE + '/offline/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: offPhone.value.trim() || undefined,
        message: msg
      })
    })
    .then(function() { showOnly(offlineThanksEl); })
    .catch(function() {
      var offlineMsgs = [];
      try { offlineMsgs = JSON.parse(localStorage.getItem('autolock_offline_msgs')) || []; } catch(e) {}
      offlineMsgs.push({ name: name, email: email, phone: offPhone.value.trim(), message: msg, date: new Date().toISOString() });
      try { localStorage.setItem('autolock_offline_msgs', JSON.stringify(offlineMsgs)); } catch(e) {}
      showOnly(offlineThanksEl);
    });
  }

  function openHistory() {
    var sessions = loadSessions();
    headerTitle.textContent = 'Tidligere samtaler';
    historyList.innerHTML = '';

    if (sessions.length === 0) {
      historyList.innerHTML = '<div id="lc-history-empty">Ingen tidligere samtaler fundet.</div>';
    } else {
      sessions.forEach(function(s) {
        var item = document.createElement('div');
        item.className = 'lc-session-item';
        var preview = '—';
        var customerMsgs = s.messages.filter(function(m) { return m.role === 'customer'; });
        if (customerMsgs.length > 0) preview = customerMsgs[0].text;
        if (preview.length > 60) preview = preview.slice(0, 60) + '…';
        var msgCount = s.messages.filter(function(m) { return m.role !== 'system'; }).length;
        item.innerHTML =
          '<div class="lc-si-date">' + formatDate(s.date) + (s.name ? ' · ' + s.name : '') + '</div>' +
          '<div class="lc-si-preview">' + escHtml(preview) + '</div>' +
          '<div class="lc-si-count">' + msgCount + ' besked' + (msgCount !== 1 ? 'er' : '') + '</div>';
        item.addEventListener('click', function() { openSessionDetail(s); });
        historyList.appendChild(item);
      });
    }
    showOnly(historyEl);
  }

  historyBackBtn.addEventListener('click', function() {
    headerTitle.textContent = 'AutoLock Support';
    updateStatusIndicator();
    if (historyBackTarget === 'closed') {
      showOnly(closedEl);
    } else {
      if (isOfficeOpen()) {
        refreshHistoryLink();
        showOnly(introEl);
      } else {
        showOnly(offlineEl);
      }
    }
  });

  function openSessionDetail(session) {
    detailMsgsEl.innerHTML = '';
    var rdBadge = document.createElement('div');
    rdBadge.className = 'lc-readonly-badge';
    rdBadge.textContent = 'Avslutad konversation – skrivskyddad';
    detailMsgsEl.appendChild(rdBadge);
    session.messages.forEach(function(m) {
      var div = document.createElement('div');
      div.className = m.role === 'system' ? 'lc-msg lc-msg-system' : 'lc-msg lc-msg-' + m.role;
      div.textContent = m.text;
      detailMsgsEl.appendChild(div);
    });
    detailMsgsEl.scrollTop = 0;
    headerTitle.textContent = formatDate(session.date);
    showOnly(sessionDetailEl);
  }

  detailBackBtn.addEventListener('click', function() {
    headerTitle.textContent = 'Tidligere samtaler';
    openHistory();
  });

  startBtn.addEventListener('click', startSession);
  nameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') startSession(); });

  function startSession() {
    var name = nameInput.value.trim();
    var email = emailInput.value.trim();
    if (!name)  { showError('Vänligen ange ditt namn.'); nameInput.focus(); return; }
    if (!email) { showError('Vänligen ange din e-postadress.'); emailInput.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Ange en giltig e-postadress.'); emailInput.focus(); return; }

    startBtn.disabled = true;
    startBtn.textContent = 'Startar…';
    currentMsgs = [];

    fetch(API_BASE + '/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // ── RETTET: sender browserens sprog så agentens svar oversættes korrekt ──
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phoneInput.value.trim() || undefined,
        lang: 'sv'
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      sessionId = data.session.id;
      showOnly(chatEl);
      if (!isOfficeOpen()) {
        addSystemMsg('  Kunden skrev utanför öppettider (mån–fre 08–16). Återkom så snart som möjligt.');
      } else {
        addSystemMsg('Chat startad – en medarbetare från AutoLock återkommer så snart som möjligt.');
      }
      msgInput.focus();
      startPolling();
    })
    .catch(function() {
      showError('Kunde inte ansluta. Försök igen.');
      startBtn.disabled = false;
      startBtn.textContent = 'Start chat';
    });
  }

  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  msgInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  function sendMessage() {
    var text = msgInput.value.trim();
    if (!text || !sessionId) return;
    msgInput.value = '';
    msgInput.style.height = 'auto';
    addMsg('customer', text);
    fetch(API_BASE + '/message/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ message: text })
    }).catch(function() { showError('Meddelandet kunde inte skickas.'); });
  }

  var sseSource = null;

  function startPolling() {
    if (sseSource || !sessionId) return;
    sseSource = new EventSource(API_BASE + '/message/sse?session_id=' + sessionId);
    sseSource.addEventListener('message', function(e) {
      var m = JSON.parse(e.data);
      if (m.role === 'agent') {
        addMsg('agent', m.text);
        if (!isOpen) badge.style.display = 'block';
      }
    });
    sseSource.addEventListener('closed', function() { handleClosed(); });
    sseSource.onerror = function() {
      // SSE reconnects automatically – ingen handling nødvendig
    };
  }

  function stopPolling() {
    if (sseSource) { sseSource.close(); sseSource = null; }
  }

  function handleClosed() {
    var name = nameInput.value.trim() || 'Anonym';
    if (sessionId) saveSession(sessionId, name, currentMsgs.slice());
    sessionId = null;
    stopPolling();
    showOnly(closedEl);
  }

  endBtn.addEventListener('click', function() {
    if (!sessionId) return;
    stopPolling();
    fetch(API_BASE + '/session/close', { method: 'POST', headers: { 'X-Session-Id': sessionId } })
    .then(function() { handleClosed(); }).catch(function() { handleClosed(); });
  });

  newChatBtn.addEventListener('click', function() {
    lastMsgId = 0;
    currentMsgs = [];
    messagesEl.innerHTML = '';
    nameInput.value = '';
    emailInput.value = '';
    phoneInput.value = '';
    startBtn.disabled = false;
    startBtn.textContent = 'Start chat';
    msgInput.value = '';
    msgInput.style.height = 'auto';
    headerTitle.textContent = 'AutoLock Support';
    updateStatusIndicator();
    if (isOfficeOpen()) {
      refreshHistoryLink();
      showOnly(introEl);
      nameInput.focus();
    } else {
      showOnly(offlineEl);
      offName.focus();
    }
  });

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'lc-msg lc-msg-' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    currentMsgs.push({ role: role, text: text });
  }

  function addSystemMsg(text) {
    var div = document.createElement('div');
    div.className = 'lc-msg lc-msg-system';
    div.textContent = text;
    messagesEl.appendChild(div);
    currentMsgs.push({ role: 'system', text: text });
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  updateStatusIndicator();
  refreshHistoryLink();

})();
</script>
</body>
</html>
