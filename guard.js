(function () {
  var K = "paperSeal.v1", E = "b1b975810afc02d68069da197d85956507b368b383e10ced8cc352cdeeb51073", ok = false;
  try { ok = localStorage.getItem(K) === E; } catch (e) {}
  if (!ok) { try { ok = sessionStorage.getItem(K) === E; } catch (e) {} }
  if (!ok) { ok = location.hash.indexOf(E) >= 0; }
  if (!ok) { location.replace("./index.html"); }
})();
