// Prueba de la ruta de ejercicios: revisa que cada ejercicio esté bien escrito y lo toca un «pianista virtual»
// para comprobar la calificación, incluidas las notas cortas y ligadas, la fuerza y los reguladores.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});

function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  if (!/const NUBE_CFG = [^;]*;/.test(h)) throw new Error('falta NUBE_CFG');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, UNITS, RUTA, SONGS, TSONGS, Data, settings, aids, songData, findSong, openSong, start, step, press, release, setPedal,
    pendingGroup, setMode, setSpeed, togglePlay, rebuild, get partSel(){ return partSel; }, meterOf, keySig, isBlack, pc, goLearn, goHome, renderList, reset,
    paint(){ const grp = new Set(P && P.mode !== 'escuchar' ? pendingGroup() : []); draw(grp); drawScore(grp); }};\nNube.bind();`;
  if (!h.includes('Nube.bind();')) throw new Error('falta bind');
  return h.replace('Nube.bind();', hook);
}
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };

// Se ejecuta dentro de la página: toca un ejercicio completo con el reloj simulado.
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

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  async function open(viewport, dev, fake){
    const ctx = await browser.newContext({viewport});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(([dev, fake]) => {
      localStorage.setItem('piano:ajustes', JSON.stringify({device: dev}));
      if (fake){
        let now = 1000; performance.now = () => now; window.__tick = ms => { now += ms; };
        window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
      }
    }, [dev, fake]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    await page.evaluate(pianist);
    return page;
  }

  /* ============ 1. Los ejercicios están bien escritos ============ */
  console.log('1. Contenido de los ejercicios');
  const A = await open({width: 1366, height: 768}, 'pc', true);
  const info = await A.evaluate(() => {
    const t = __t, out = {n: t.LESSONS.length, units: [], problems: [], warn: [], ids: t.LESSONS.map(l => l.id), lvl: {}};
    const inUnits = t.UNITS.flatMap(u => u.ids);
    out.units = t.UNITS.map(u => [u.lvl || 1, u.title, u.ids.length]);
    if (inUnits.join() !== t.LESSONS.map(l => l.id).join()) out.problems.push('el orden de UNITS no coincide con LESSONS');
    const keys = new Set();
    for (const s of [...t.LESSONS, ...t.SONGS, ...t.TSONGS]){ if (keys.has(s.key)) out.problems.push('clave repetida ' + s.key); keys.add(s.key); }
    for (const l of t.LESSONS){
      out.lvl[l.lvl] = (out.lvl[l.lvl] || 0) + 1;
      const d = t.songData(l), M = t.meterOf(l), sig = t.keySig(l), p = m => `${l.id}: ${m}`;
      if (!d.notes.length){ out.problems.push(p('sin notas')); continue; }
      if (!l.title || !l.summary || !l.goal || l.goal.length < 60) out.problems.push(p('faltan textos'));
      const bars = d.length / M.mlen;
      if (l.lvl === 2 && Math.abs(bars - Math.round(bars)) > 1e-6) out.problems.push(p(`dura ${d.length} pulsos: no completa compases de ${M.mlen}`));
      for (const n of d.notes){
        const k0 = Math.floor(n.start / M.mlen + 1e-6), k1 = Math.floor((n.start + n.dur - 1e-3) / M.mlen);
        if (k1 !== k0 && l.lvl === 2) out.problems.push(p(`nota que cruza la barra de compás en el pulso ${n.start}`));
        if (n.midi < 43 || n.midi > 84) out.problems.push(p('nota fuera del rango esperado: ' + n.midi));
        if (l.lvl === 2 && !n.finger) out.problems.push(p('nota sin dedo en el pulso ' + n.start));
        if (sig.n){
          if (t.isBlack(n.midi) && !sig.alt.has(t.pc(n.midi))) out.warn.push(p('alteración fuera de la armadura en ' + n.start));
          if (!t.isBlack(n.midi) && sig.nat.has(t.pc(n.midi))) out.problems.push(p('necesitaría becuadro en ' + n.start));
        } else if ((+l.sig || 0) === 0 && l.lvl === 2 && t.isBlack(n.midi) && l.id !== 're-mayor-menor') out.problems.push(p('tecla negra sin armadura en ' + n.start));
      }
      // Digitación: en un acorde los dedos siguen el orden de las notas; en una línea, la mano no se cruza salvo con el pulgar.
      for (const hand of ['R', 'L']){
        const ns = d.notes.filter(n => (n.hand === 'L') === (hand === 'L'));
        const groups = new Map(); for (const n of ns){ const k = Math.round(n.start * 24); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
        let prev = null;
        for (const g of [...groups.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1].sort((a, b) => a.midi - b.midi))){
          if (g.length > 1){
            const fs = g.map(n => n.finger);
            const good = fs.every((f, i) => i === 0 || (hand === 'R' ? f > fs[i - 1] : f < fs[i - 1]));
            if (fs.every(Boolean) && !good) out.problems.push(p(`dedos del acorde en ${g[0].start}: ${fs.join('-')}`));
            const span = g[g.length - 1].midi - g[0].midi; if (span > 12) out.problems.push(p('acorde de más de una octava en ' + g[0].start));
            prev = null; continue;
          }
          const n = g[0];
          if (prev && n.finger && prev.finger && n.start - (prev.start + prev.dur) < 0.01){
            const up = (n.midi - prev.midi) * (hand === 'R' ? 1 : -1), df = n.finger - prev.finger;
            const cross = (up > 0 && n.finger === 1 && prev.finger >= 3) || (up < 0 && prev.finger === 1 && n.finger >= 3);
            if (up === 0 && df !== 0) out.warn.push(p(`cambia de dedo en la misma tecla en ${n.start}`));
            if (up !== 0 && !cross && Math.sign(up) !== Math.sign(df)) (l.lvl === 2 ? out.problems : out.warn).push(p(`dedo ${prev.finger}→${n.finger} contra el movimiento en ${n.start}`));
            if (up !== 0 && !cross && Math.abs(n.midi - prev.midi) > 3 * Math.abs(df) + 2) out.warn.push(p(`estiramiento grande ${prev.finger}→${n.finger} en ${n.start}`));
          }
          prev = n;
        }
      }
    }
    return out;
  });
  ok(info.n === 48, 'hay 48 ejercicios (24 de antes y 24 nuevos)', info.n);
  ok(info.lvl[1] === 24 && info.lvl[2] === 24, 'Nivel 1 con 24 y Nivel 2 con 24', info.lvl);
  ok(info.ids.slice(0, 24).join() === 'do-central,do-re-mi,cinco-do,saltos,ritmo,silencios,mary,cinco-sol,escala,fa-sost,escala-sol,izquierda,turnos,acorde-do,tres-acordes,arpegio,la-menor,dos-manos,estrellita-manos,acorde-izq,tres-acordes-izq,bajo-acorde,melodia-acordes,estrellita-acordes', 'los 24 de antes conservan su nombre interno y su orden (no se pierde avance)');
  ok(info.problems.length === 0, 'ningún ejercicio tiene errores de escritura', info.problems);
  console.log('    unidades:', JSON.stringify(info.units));
  if (info.warn.length) console.log('    avisos para revisar a mano:', JSON.stringify(info.warn, null, 0));

  /* ============ 2. El pianista virtual toca todos los ejercicios ============ */
  console.log('2. Tocar los 48 ejercicios');
  const ids = info.ids;
  const bad = [], badR = [];
  for (const id of ids){
    const r = await A.evaluate(([id]) => __play(id, {mode: 'esperar'}), [id]);
    if (!(r.finished && /^3 de 3/.test(r.stars) && r.errors === 0 && r.hits === r.total && r.best && r.best.stars === 3)) bad.push([id, r.stars, r.hits, r.total, r.errors, r.shorts, r.longs, r.text.slice(0, 160)]);
    const q = await A.evaluate(([id]) => __play(id, {mode: 'ritmo'}), [id]);
    if (!(q.finished && /^3 de 3/.test(q.stars) && q.errors === 0 && q.hits === q.total)) badR.push([id, q.stars, q.hits, q.total, q.errors, q.shorts, q.longs, q.text.slice(0, 160)]);
  }
  ok(bad.length === 0, 'modo Esperar: tocados bien, los 48 dan tres estrellas', bad);
  ok(badR.length === 0, 'modo Ritmo: tocados bien, los 48 dan tres estrellas', badR);
  await A.evaluate(() => { __t.Data.progress = {}; });
  const w = await A.evaluate(() => __play('cinco-fa', {mode: 'esperar', wrong: true}));
  ok(/^1 de 3|^0 de 3/.test(w.stars) && w.errors === w.total, 'con una tecla equivocada antes de cada nota, baja a una estrella o menos', [w.stars, w.errors]);

  /* ============ 3. Expresión ============ */
  console.log('3. Fuerte y suave');
  let r = await A.evaluate(() => __play('fuerte-suave', {}));
  ok(/^3 de 3/.test(r.stars) && /Se nota la diferencia entre fuerte y suave/.test(r.text), 'con contraste claro: tres estrellas y lo dice', r.text.slice(0, 200));
  r = await A.evaluate(() => __play('fuerte-suave', {flat: 80, jitter: 4}));
  ok(/^1 de 3/.test(r.stars) && /Casi no hay diferencia/.test(r.text) && r.title === 'Falta la expresión' && /lo que falta es la expresión/.test(r.text), 'todo con la misma fuerza: una estrella y explica qué falta', [r.stars, r.title, r.text.slice(0, 220)]);
  r = await A.evaluate(() => __play('fuerte-suave', {f: 67, p: 55}));
  ok(/^1 de 3/.test(r.stars), 'contraste pequeño (12 puntos): no alcanza', r.stars);
  r = await A.evaluate(() => __play('fuerte-suave', {f: 88, p: 60}));
  ok(/^3 de 3/.test(r.stars), 'contraste claro aunque no extremo (28 puntos): alcanza', r.stars);
  r = await A.evaluate(() => __play('fuerte-suave', {f: 50, p: 100}));
  ok(/^1 de 3/.test(r.stars), 'al revés (suave donde va fuerte): no aprueba', r.stars);
  r = await A.evaluate(() => __play('fuerte-suave', {flat: 100, jitter: 0}));
  ok(/^3 de 3/.test(r.stars) && /La fuerza no se pudo medir/.test(r.text), 'teclado que no mide la fuerza: califica solo las notas y lo avisa', r.text.slice(0, 220));
  r = await A.evaluate(() => __play('fuerte-suave', {src: 'ptr'}));
  ok(/^3 de 3/.test(r.stars) && /La fuerza no se pudo medir/.test(r.text), 'tocando en la pantalla: igual, solo las notas', r.stars);
  r = await A.evaluate(() => __play('eco', {mode: 'ritmo'}));
  ok(/^3 de 3/.test(r.stars) && /Se nota la diferencia/.test(r.text), '«El eco» en modo Ritmo con contraste: tres estrellas', r.stars);
  r = await A.evaluate(() => __play('estudio-fa', {flat: 70, jitter: 5}));
  ok(/^1 de 3/.test(r.stars), 'el estudio final sin matices: una estrella', r.stars);
  r = await A.evaluate(() => __play('estudio-fa', {fR: 95, pR: 50, fL: 45, pL: 45}));
  ok(/^3 de 3/.test(r.stars) && /Se nota la diferencia/.test(r.text), 'estudio final: melodía con matices y la izquierda pareja y suave: aprueba', [r.stars, r.text.slice(0, 160)]);
  r = await A.evaluate(() => __play('estudio-fa', {fR: 70, pR: 70, fL: 66, pL: 42}));
  ok(/^1 de 3/.test(r.stars) && /Casi no hay diferencia/.test(r.text), 'estudio final: solo el acompañamiento cambia de fuerza: no aprueba', [r.stars, r.text.slice(0, 160)]);
  r = await A.evaluate(() => {
    // «Por partes»: los dos primeros compases tienen un solo matiz.
    const t = __t; t.goLearn(); t.aids.parts = true; t.openSong('fuerte-suave'); t.partSel.idx = 0; t.rebuild();
    const marks = t.P.dynMarks.map(k => k.t + k.v).join();
    const res = __play('fuerte-suave', {keep: true}); t.aids.parts = false; res.marks = marks; return res;
  });
  ok(/un solo matiz/.test(r.text) && !/La fuerza no se pudo medir/.test(r.text) && r.marks === '0p', 'practicando una parte con un solo matiz, no culpa al teclado', [r.marks, r.text.slice(0, 220)]);
  r = await A.evaluate(() => { const t = __t; t.goLearn(); t.aids.parts = true; t.openSong('estudio-fa'); t.partSel.idx = 1; t.rebuild(); const m = t.P.dynMarks.map(k => k.t + k.v).join(); t.aids.parts = false; return m; });
  ok(r === '8p', 'una parte que empieza a mitad de un matiz lo muestra al principio', r);

  console.log('4. Notas cortas y ligadas');
  r = await A.evaluate(() => __play('staccato', {}));
  ok(/^3 de 3/.test(r.stars) && r.longs === 0 && /Las notas cortas salieron cortas/.test(r.text), 'staccato bien tocado', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('staccato', {hold: 'full'}));
  ok(/^1 de 3/.test(r.stars) && r.longs >= 24 && r.title === 'Falta la expresión' && /quedaron sonando de más/.test(r.text) && /la dejaste sonar y va corta/.test(r.text) && /lo que falta es la expresión/.test(r.text), 'staccato con todas las notas largas: una estrella, «Falta la expresión» y dice cuáles', [r.stars, r.longs, r.title, r.text.slice(0, 260)]);
  r = await A.evaluate(() => __play('staccato', {hold: 'full', mode: 'ritmo'}));
  ok(/^1 de 3/.test(r.stars) && r.longs >= 24, 'lo mismo en modo Ritmo', [r.stars, r.longs]);
  r = await A.evaluate(() => __play('staccato', {badEvery: 3}));
  ok(/^1 de 3/.test(r.stars) && r.longs >= 7 && r.longs <= 9 && r.title === 'Falta la expresión', 'staccato con una de cada tres notas larga: ya no aprueba', [r.stars, r.longs, r.title]);
  r = await A.evaluate(() => __play('staccato', {badEvery: 6}));
  ok(/^[23] de 3/.test(r.stars) && r.longs >= 3 && r.longs <= 5, 'con algún descuido aislado sí aprueba', [r.stars, r.longs]);
  r = await A.evaluate(() => __play('legato', {}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0 && /Las notas ligadas salieron unidas/.test(r.text), 'legato bien tocado, sin activar la ayuda «Duración»', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('legato', {mode: 'ritmo'}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0, 'legato en modo Ritmo', [r.stars, r.shorts]);
  r = await A.evaluate(() => __play('legato', {hold: 'tap'}));
  ok(/^1 de 3/.test(r.stars) && r.shorts >= 18 && r.title === 'Falta la expresión' && /quedaron separadas de la siguiente/.test(r.text), 'legato tocado picado: una estrella y «Falta la expresión»', [r.stars, r.shorts, r.title]);
  r = await A.evaluate(() => __play('legato', {badEvery: 3}));
  ok(/^1 de 3/.test(r.stars) && r.title === 'Falta la expresión', 'legato con una de cada tres notas suelta: no aprueba', [r.stars, r.shorts]);
  r = await A.evaluate(() => __play('legato', {hold: 'full', think: 1.5}));
  ok(/^1 de 3/.test(r.stars) && r.shorts >= 15, 'soltar cada nota y tardar segundo y medio en tocar la siguiente no cuenta como ligado', [r.stars, r.shorts]);
  const early = await A.evaluate(() => {
    // Ligado más rápido que el pulso: cada nota se toca antes de que llegue su barra y la anterior se suelta después.
    const t = __t; t.goLearn(); t.aids.dur = false; t.openSong('legato'); t.setMode('esperar'); t.start();
    const P = t.P; let prev = null, g = 0;
    while (!P.finished && g++ < 200000){
      t.step(1 / 120); window.__tick(1000 / 120);
      const grp = t.pendingGroup();
      if (grp.length && grp[0].start - P.t <= 0.6){ const n = grp[0]; t.press(n.midi, 'midi', 0.7); if (prev != null && prev !== n.midi) t.release(prev); else if (prev === n.midi){ t.release(prev); t.press(n.midi, 'midi', 0.7); } prev = n.midi; }
    }
    return {shorts: P.shorts, hits: P.hits, total: P.total, fin: P.finished};
  });
  ok(early.fin && early.hits === early.total && early.shorts === 0, 'legato tocado más rápido que el pulso, pero ligando de verdad, también vale', early);
  const gap = await A.evaluate(() => {
    // Modo Ritmo, un cuarto de pulso adelantado y con un hueco de 20 ms entre notas: sigue siendo ligado.
    const t = __t; t.goLearn(); t.openSong('legato'); t.setMode('ritmo'); t.start();
    const P = t.P; let prev = null, g = 0, relAt = -1;
    while (!P.finished && g++ < 200000){
      t.step(1 / 120); window.__tick(1000 / 120);
      const n = P.notes.find(x => x.state === 0 && x.start - P.t <= 0.25);
      if (n && relAt < 0 && prev != null){ t.release(prev); prev = null; relAt = P.clock + 0.02; }
      if (n && (relAt < 0 || P.clock >= relAt)){ t.press(n.midi, 'midi', 0.7); prev = n.midi; relAt = -1; }
    }
    return {shorts: P.shorts, hits: P.hits, total: P.total};
  });
  ok(gap.hits === gap.total && gap.shorts === 0, 'un hueco de 20 milésimas tocando algo adelantado no se castiga', gap);
  const paused = await A.evaluate(() => {
    // Pausa con una nota corta abajo: el tiempo en pausa no cuenta.
    const t = __t; t.goLearn(); t.openSong('staccato'); t.setMode('esperar'); t.start();
    const P = t.P; let g = 0;
    while (!P.waiting && g++ < 5000){ t.step(1 / 120); window.__tick(1000 / 120); }
    const n = t.pendingGroup()[0]; t.press(n.midi, 'midi', 0.7);
    t.togglePlay(); window.__tick(5000); t.togglePlay();
    t.step(1 / 120); t.release(n.midi);
    return {longs: P.longs, playing: P.playing};
  });
  ok(paused.longs === 0 && paused.playing, 'pausar con una nota corta presionada no la cuenta como larga', paused);
  r = await A.evaluate(() => __play('ligado-picado', {}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0 && r.longs === 0, 'ligado y picado, cada frase a su manera', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('ligado-picado', {hold: 'tap'}));
  ok(r.shorts >= 10 && r.longs === 0 && /^1 de 3/.test(r.stars), 'todo picado: fallan solo las frases ligadas', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('ligado-picado', {hold: 'full'}));
  ok(r.longs >= 12 && r.shorts === 0 && /^1 de 3/.test(r.stars), 'todo ligado: fallan solo las frases picadas', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('cinco-do', {hold: 'tap'}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0, 'un ejercicio sin marcas no califica la duración si la ayuda está apagada (como antes)', [r.stars, r.shorts]);
  r = await A.evaluate(() => __play('cinco-do', {hold: 'tap', dur: true}));
  ok(r.shorts > 5 && /soltadas antes de tiempo/.test(r.text), 'y con la ayuda «Duración» encendida sí (como antes)', [r.stars, r.shorts]);

  console.log('5. Crescendo y diminuendo');
  r = await A.evaluate(() => __play('crescendo', {}));
  ok(/^3 de 3/.test(r.stars) && /Crescendos y diminuendos: 4 de 4 bien\./.test(r.text), 'subiendo y bajando poco a poco: 4 de 4 y tres estrellas', r.text.slice(0, 200));
  r = await A.evaluate(() => __play('crescendo', {mode: 'ritmo'}));
  ok(/^3 de 3/.test(r.stars) && /Crescendos y diminuendos: 4 de 4 bien/.test(r.text), 'igual en modo Ritmo', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('crescendo', {hair: 'flat', jitter: 4}));
  ok(/^1 de 3/.test(r.stars) && r.title === 'Falta la expresión' && /Crescendos y diminuendos: 0 de 4 bien\. Cambia la fuerza poco a poco/.test(r.text), 'todo con la misma fuerza: una estrella y dice qué hacer', r.text.slice(0, 260));
  r = await A.evaluate(() => __play('crescendo', {hair: 'reverse'}));
  ok(/^1 de 3/.test(r.stars) && /0 de 4 bien/.test(r.text), 'al revés (bajar donde va subir): no vale', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('crescendo', {hair: 'sudden', jitter: 1}));
  ok(/^1 de 3/.test(r.stars) && /0 de 4 bien/.test(r.text), 'cambiar de golpe a mitad de la frase: no vale', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('crescendo', {hair: 'small', jitter: 2}));
  ok(/^1 de 3/.test(r.stars), 'un cambio demasiado pequeño: no alcanza', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('crescendo', {f: 92, p: 58}));
  ok(/^3 de 3/.test(r.stars) && /4 de 4 bien/.test(r.text), 'una rampa moderada (34 puntos) y pareja: alcanza', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('crescendo', {src: 'ptr'}));
  ok(/^3 de 3/.test(r.stars) && /La fuerza no se pudo medir/.test(r.text), 'tocando en la pantalla: califica solo las notas y lo avisa', r.text.slice(0, 200));
  r = await A.evaluate(() => __play('crescendo', {flat: 90, jitter: 0}));
  ok(/^3 de 3/.test(r.stars) && /La fuerza no se pudo medir/.test(r.text), 'teclado que no mide la fuerza: igual', r.stars);
  r = await A.evaluate(() => __play('fuerte-suave', {}));
  ok(/^3 de 3/.test(r.stars) && /Se nota la diferencia/.test(r.text) && !/Crescendos/.test(r.text), 'un ejercicio sin reguladores no habla de crescendos', r.text.slice(0, 160));

  console.log('6. Ruta');
  await A.evaluate(() => { const t = __t; t.Data.progress = {}; for (const l of t.LESSONS.slice(0, 23)) t.Data.progress[l.key] = {stars: 3, pct: 100}; });
  r = await A.evaluate(() => __play('estrellita-acordes', {}));
  ok(/Completaste el último ejercicio del Nivel 1\. Sigue con el Nivel 2\./.test(r.text) && /Siguiente ejercicio/.test(r.text), 'al terminar el Nivel 1 anuncia el Nivel 2', r.text.slice(-200));
  await A.click('#doneCard [data-act="next"]');
  ok((await A.textContent('#soTitle')) === 'Cinco dedos en Fa' && /Ejercicio 25 de 48/.test(await A.textContent('#soKicker')), '«Siguiente ejercicio» abre el 25: Cinco dedos en Fa');
  await A.evaluate(() => { const t = __t; for (const l of t.LESSONS.slice(0, 47)) t.Data.progress[l.key] = {stars: 3, pct: 100}; });
  r = await A.evaluate(() => __play('estudio-fa', {}));
  ok(/Terminaste toda la ruta de ejercicios/.test(r.text) && /Ir a las canciones/.test(r.text), 'al terminar el 48 dice que la ruta está completa', r.text.slice(-200));
  await A.context().close();

  /* ============ 7. Cómo se ve ============ */
  console.log('7. Capturas');
  const B = await open({width: 820, height: 1180}, 'tab-v', true);
  await B.evaluate(() => { const t = __t; t.Data.progress = {}; for (const l of t.LESSONS.slice(0, 26)) t.Data.progress[l.key] = {stars: l.index % 3 ? 3 : 2, pct: 96}; t.settings.learnTab = 'ejercicios'; t.goLearn(); });
  const txt = await B.textContent('#songList');
  ok(/Nivel 1 · Primeros pasos/.test(txt) && /Completo/.test(txt) && /Nivel 2 · Tocar con soltura/.test(txt) && /2 de 24/.test(txt) && /¿Y después de los ejercicios\?/.test(txt) && /26 de 48 completados/.test(txt), 'la lista muestra los dos niveles, su avance y qué sigue');
  ok((await B.locator('#songList .song.is-next .t').textContent()) === 'La armadura de Sol', 'marca el siguiente ejercicio');
  await B.evaluate(() => { const el = [...document.querySelectorAll('#songList .ruta-lv')][1]; document.querySelector('#songList').scrollTop = el.offsetTop - 80; });
  await B.screenshot({path: path.join(SHOTS, '20-ruta-nivel2.png')});
  const shot = async (page, id, name, advance, extra) => {
    await page.evaluate(([id, advance, extra]) => {
      const t = __t; t.goLearn(); t.openSong(id); if (extra && extra.mode) t.setMode(extra.mode); t.start();
      const P = t.P; let g = 0;
      while (P.t < advance && g++ < 100000){ t.step(1 / 120); if (P.waiting){ for (const n of t.pendingGroup()){ t.press(n.midi, 'midi', 0.7); t.release(n.midi); } } }
      t.paint();
    }, [id, advance, extra || null]);
    await page.screenshot({path: path.join(SHOTS, name)});
    const res = await page.evaluate(() => ({h: __t.P.scoreH, hint: document.querySelector('#hint').textContent, sig: __t.P.sig.k}));
    return res;
  };
  let v = await shot(B, 'cinco-fa', '21-cinco-fa.png', 2.2);
  ok(v.h > 0 && v.sig === -1 && /Si♭ con el dedo 4/.test(v.hint), 'Fa mayor: la partitura se muestra y la tecla negra se llama Si♭', v);
  v = await shot(B, 'escala-re', '22-escala-re.png', 1.2);
  ok(v.sig === 2 && /Fa♯/.test(v.hint), 'Re mayor: dos sostenidos y Fa♯', v);
  v = await shot(B, 'staccato', '23-staccato.png', 1.2);
  ok(/· corto$/.test(v.hint), 'staccato: la pista dice «corto»', v.hint);
  v = await shot(B, 'fuerte-suave', '24-fuerte-suave.png', 4.2);
  ok(/· suave$/.test(v.hint), 'matices: la pista dice «suave»', v.hint);
  v = await shot(B, 'crescendo', '25-crescendo.png', 5.2);
  ok(/· cada vez más fuerte$/.test(v.hint), 'crescendo: la pista dice «cada vez más fuerte»', v.hint);
  v = await shot(B, 'crescendo', '25b-diminuendo.png', 10.2);
  ok(/· cada vez más suave$/.test(v.hint), 'diminuendo: la pista dice «cada vez más suave»', v.hint);
  v = await shot(B, 'estudio-fa', '26-estudio-fa.png', 1.7);
  ok(/^Derecha: Do \(5\)\. Izquierda: Fa \(5\) · suave$/.test(v.hint), 'estudio final: dos manos y matiz en la pista', v.hint);
  v = await shot(B, 'seis-octavos', '27-seis-octavos.png', 1.2);
  v = await shot(B, 'semicorcheas', '28-semicorcheas.png', 0.6);
  v = await shot(B, 'legato', '34-legato.png', 2.2);
  v = await shot(B, 'ligado-picado', '35-ligado-picado.png', 5.2);
  v = await shot(B, 're-mayor-menor', '29-re-mayor-menor.png', 9.2);
  ok(/Fa con el dedo 3/.test(v.hint), 'al salir de un ejercicio con bemoles, los nombres vuelven a ser los normales', v.hint);
  const accs = id => B.evaluate(id => { const t = __t; t.goLearn(); t.openSong(id); const c = {sh: 0, fl: 0, na: 0}; for (const ch of t.P.sheet.chords) for (const it of ch.items) if (it.acc) c[it.acc]++; return c; }, id);
  let ac = await accs('cinco-fa');
  ok(ac.sh === 0 && ac.fl === 0 && ac.na === 0, 'Fa mayor: el bemol va solo en la armadura, no en cada nota', ac);
  ac = await accs('escala-re');
  ok(ac.sh === 0 && ac.na === 0, 'Re mayor: los sostenidos van solo en la armadura', ac);
  ac = await accs('re-mayor-menor');
  ok(ac.sh === 3 && ac.na === 1, 'Re mayor y menor: tres Fa♯ escritos y un becuadro donde vuelve el Fa natural en el mismo compás', ac);
  ac = await accs('fa-sost');
  ok(ac.sh === 5 && ac.na === 0 && ac.fl === 0, 'un ejercicio de antes con Fa♯ se dibuja igual que antes', ac);
  await B.evaluate(() => { __t.goLearn(); __t.openSong('legato'); });
  ok(!/sensibilidad al toque/.test(await B.textContent('#soDesc')), 'un ejercicio sin matices no menciona la fuerza');
  await B.evaluate(() => { __t.openSong('fuerte-suave'); });
  ok(/La fuerza se mide con un teclado con sensibilidad al toque/.test(await B.textContent('#soDesc')), 'el de matices avisa cómo se mide la fuerza antes de empezar');
  await B.screenshot({path: path.join(SHOTS, '30-inicio-fuerte-suave.png')});
  await B.context().close();
  // celular: lista y un ejercicio
  const C = await open({width: 390, height: 800}, 'cel-v', true);
  await C.evaluate(() => { const t = __t; t.settings.learnTab = 'ejercicios'; t.goLearn(); const el = [...document.querySelectorAll('#songList .ruta-lv')][1]; document.querySelector('#songList').scrollTop = el.offsetTop - 60; });
  await C.screenshot({path: path.join(SHOTS, '31-celular-ruta.png')});
  ok(await C.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'en el celular la lista no se sale de la pantalla');
  await shot(C, 'ligado-picado', '32-celular-ligado-picado.png', 7.2);
  await shot(C, 'crescendo', '33-celular-crescendo.png', 6.2);
  await C.context().close();

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
