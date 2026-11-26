/* 封蜡校验（前端） */
(function () {
  var K = "paperSeal.v1";
  var E = "2a2cae4ef4f309e8d6524087237ca2e12d4ef08b607e65f65196abc92b034533";
  var FAIL = "paperSeal.fail";
  var S = "paper-letter::yv-2026-winter";
  var LOCKT = "paperSeal.till";

  var $ = function (id) { return document.getElementById(id); };
  var input = $("code"), btn = $("open"), err = $("err"), paper = document.querySelector(".paper");

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function slow(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } var out = ""; for (var j = 0; j < 8; j++) { out += ("0000000" + ((h << j | h >>> (32 - j)) >>> 0).toString(16)).slice(-8); } return out.slice(0, 64); }
  function digest(s) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(hex);
    }
    return Promise.resolve(slow(s));
  }
  function expectFor(s) {
    if (window.crypto && crypto.subtle) { return digest(s); }
    return Promise.resolve(slow(s));
  }
  function same(a, b) {
    if (a.length !== b.length) return false;
    var r = 0; for (var i = 0; i < a.length; i++) { r |= a.charCodeAt(i) ^ b.charCodeAt(i); }
    return r === 0;
  }

  function cooldownLeft() {
    try { var t = +localStorage.getItem(LOCKT) || 0; return Math.max(0, t - Date.now()); } catch (e) { return 0; }
  }
  function tick() {
    var left = cooldownLeft();
    if (left > 0) {
      btn.disabled = true;
      err.textContent = "试得太多次了，" + Math.ceil(left / 1000) + " 秒后再来。";
      setTimeout(tick, 500);
    } else {
      btn.disabled = false;
    }
  }

  function clean(v) { return (v || "").replace(/[\s\u3000·]/g, ""); }

  function submit() {
    var v = clean(input.value);
    if (!v) { err.textContent = "先写下口令。"; input.focus(); return; }
    if (cooldownLeft() > 0) { tick(); return; }
    btn.disabled = true; err.textContent = "";
    expectFor(S + v).then(function (got) {
      if (same(got, E)) {
        var stored = false;
        try { localStorage.setItem(K, E); stored = localStorage.getItem(K) === E; } catch (e) {}
        if (!stored) { try { sessionStorage.setItem(K, E); } catch (e) {} }
        err.textContent = "";
        paper.classList.add("fade");
        setTimeout(function () {
          location.replace("./card.html" + (stored ? "" : "#k=" + E));
        }, 420);
      } else {
        btn.disabled = false;
        var n = 1;
        try { n = (+localStorage.getItem(FAIL) || 0) + 1; localStorage.setItem(FAIL, n); } catch (e) {}
        if (n >= 5) {
          try { localStorage.setItem(LOCKT, Date.now() + 30000); localStorage.setItem(FAIL, 0); } catch (e) {}
          tick();
        } else {
          err.textContent = "口令不对，再想想。";
        }
        input.classList.add("ghost");
        paper.classList.add("shake");
        setTimeout(function () { paper.classList.remove("shake"); input.classList.remove("ghost"); }, 460);
        input.select();
      }
    });
  }

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  input.addEventListener("input", function () { err.textContent = ""; });
  setTimeout(function () { input.focus(); }, 260);
  tick();
})();
