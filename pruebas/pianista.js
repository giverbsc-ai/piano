// El «pianista virtual» de las pruebas. Se ejecuta dentro de la página: toca una pieza completa con el reloj simulado.
// Con {keep: true} toca la pieza que ya está abierta (por ejemplo, la de un paso de teoría) sin cambiarle el modo.
function pianist(){
  window.__play = (key, o = {}) => {
    const t = window.__t;
    if (!o.keep){ t.goLearn(); t.aids.dur = !!o.dur; t.aids.tempo = false; t.aids.parts = false; t.setSpeed(1); t.openSong(key); t.setMode(o.mode || 'esperar'); }
    t.start();
    const P = t.P, dt = 1 / 120, held = new Map();
    const handOf = n => n.hand === 'L' ? 'L' : 'R';
    const velFor = n => {
      const jitter = o.jitter == null ? 3 : o.jitter, j = Math.round((Math.sin(n.start * 7.3 + n.midi) * 0.5) * 2 * jitter);
      const h = handOf(n), F = o['f' + h] != null ? o['f' + h] : o.f || 104, Pn = o['p' + h] != null ? o['p' + h] : o.p || 46;
      // Reguladores: por defecto sigue la rampa; 'flat' no cambia; 'sudden' salta de golpe a la mitad; 'reverse' va al revés.
      const lv = !n.hair ? 0 : o.hair === 'flat' ? 0.5 : o.hair === 'sudden' ? (n.lv >= 0.5 ? 1 : 0) : o.hair === 'reverse' ? 1 - n.lv : o.hair === 'small' ? 0.45 + 0.1 * n.lv : n.lv;
      const v = o.flat != null ? o.flat + j : n.hair ? Pn + (F - Pn) * lv + j : n.dyn === 'f' ? F + j : n.dyn === 'p' ? Pn + j : 76 + j;
      return 0.35 + 0.65 * Math.max(1, Math.min(127, v)) / 127;
    };
    const releaseDue = () => { for (const [m, h] of [...held]) if ((h.c != null && P.clock >= h.c) || (h.t != null && P.t >= h.t)){ held.delete(m); t.release(m); } };
    let count = 0;
    const hit = n => {
      count++;
      if (held.has(n.midi)){ held.delete(n.midi); t.release(n.midi); }
      t.press(n.midi, o.src || 'midi', o.src && o.src !== 'midi' ? 0.8 : velFor(n));
      const hold = o.badEvery && count % o.badEvery === 0 ? (n.art === 's' ? 'full' : 'tap') : (o.hold || 'good');
      // Ligado bien hecho: la nota anterior de esa mano se suelta después de tocar la nueva.
      for (const [m, h] of [...held]) if (h.leg && h.hand === handOf(n) && m !== n.midi){ held.delete(m); t.release(m); }
      if (hold === 'tap') held.set(n.midi, {c: P.clock + 0.09});
      else if (hold === 'full') held.set(n.midi, {t: n.start + n.dur * 0.97});
      else if (n.art === 's') held.set(n.midi, {c: P.clock + 0.09});
      else if (n.art === 'l') held.set(n.midi, {leg: true, hand: handOf(n), t: n.start + n.dur * 3});
      else held.set(n.midi, {t: n.start + n.dur * 0.93});
    };
    let guard = 0, wSince = null, wT = null;
    while (!P.finished && guard++ < 400000){
      releaseDue();
      t.step(dt); window.__tick(dt * 1000);
      if (P.finished) break;
      if (P.mode === 'esperar'){
        if (P.waiting){
          if (wSince == null || wT !== P.t){ wSince = P.clock; wT = P.t; }
          if (!o.think || P.clock - wSince >= o.think){
            for (const n of t.pendingGroup()){ if (o.wrong && !n._w){ n._w = true; t.press(n.midi + 1, o.src || 'midi', 0.8); t.release(n.midi + 1); } hit(n); }
            wSince = null;
          }
        } else wSince = null;
      } else {
        for (const n of P.notes){ if (n.start > P.t + 1e-9) break; if (n.state === 0 && !n.auto) hit(n); }
      }
    }
    for (const m of [...held.keys()]) t.release(m);
    const card = document.querySelector('#doneCard');
    const out = {finished: P.finished, stars: (card.querySelector('.stars-big') || {getAttribute(){ return ''; }}).getAttribute('aria-label'),
      text: card.textContent.replace(/\s+/g, ' ').trim(), hits: P.hits, total: P.total, errors: P.errors, shorts: P.shorts, longs: P.longs,
      best: t.Data.progress[key] || null, title: card.querySelector('h2') ? card.querySelector('h2').textContent : ''};
    return out;
  };
}
module.exports = pianist;
