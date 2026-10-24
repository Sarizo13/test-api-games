// Apparence choisie sur cet appareil (thème, motif, ambiance), appliquée avant le premier affichage
// pour éviter un éclair de l'ancien thème. Le reste vit dans appearance.js.
(function () {
  try {
    var a = JSON.parse(localStorage.getItem('ludotheque:appearance') || '{}');
    var root = document.documentElement;
    if (/^[a-z]{2,12}$/.test(a.theme || '')) root.setAttribute('data-theme', a.theme);
    if (a.fx === false) root.setAttribute('data-fx', 'off');
    if (a.ambient === true) root.setAttribute('data-ambient', 'on');
  } catch (e) { /* stockage indisponible : thème par défaut */ }
})();
