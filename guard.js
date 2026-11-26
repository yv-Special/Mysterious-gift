(function () {
  var K = "paperSeal.v1", E = "2a2cae4ef4f309e8d6524087237ca2e12d4ef08b607e65f65196abc92b034533", ok = false;
  try { ok = localStorage.getItem(K) === E; } catch (e) {}
  if (!ok) { try { ok = sessionStorage.getItem(K) === E; } catch (e) {} }
  if (!ok) { ok = location.hash.indexOf(E) >= 0; }
  if (!ok) { location.replace("./index.html"); }
})();
