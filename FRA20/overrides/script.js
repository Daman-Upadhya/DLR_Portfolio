/* FRA20 only. With Outcome and By priority hidden (style.css), By category would sit alone in
   its row: move it in front of the ageing / owner / trade cards, which style.css makes a 2 x 2 grid.
   Only the card moves; app.js finds its chart by id, so it keeps drawing as before. */
(function () {
  'use strict';
  var cat = document.getElementById('consCatPie'), age = document.getElementById('consAgeing');
  if (!cat || !age) return;
  var card = cat.closest('.card'), row = age.closest('.grid');
  if (card && row) row.insertBefore(card, row.firstChild);
})();
