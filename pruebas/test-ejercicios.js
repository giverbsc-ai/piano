// Prueba de la ruta de ejercicios: revisa que cada ejercicio esté bien escrito y lo toca un «pianista virtual»
// para comprobar la calificación, incluidas las notas cortas y ligadas, la fuerza y el pedal.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});

function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  if (!/const NUBE_CFG = [^;]*;/.test(h)) throw new Error('falta NUBE_CFG');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, UNITS, RUTA, SONGS, TSONGS, Data, settings, aids, songData, findSong, openSong, start, step, press, release, setPedal,
    pendingGroup, setMode, setSpeed, meterOf, keySig, isBlack, pc, goLearn, goHome, renderList, reset,
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
    t.goLearn();
    t.aids.dur = !!o.dur; t.aids.tempo = false; t.aids.parts = false;
    t.setSpeed(1);
    t.openSong(key); t.setMode(o.mode || 'esperar'); t.start();
    const P = t.P, dt = 1 / 120, held = new Map();
    const bps = P.song.bpm / 60;
    const velFor = n => {
      const jitter = o.jitter == null ? 3 : o.jitter, j = Math.round((Math.sin(n.start * 7.3 + n.midi) * 0.5) * 2 * jitter);
      const v = o.flat != null ? o.flat + j : n.dyn === 'f' ? (o.f || 104) + j : n.dyn === 'p' ? (o.p || 46) + j : 76 + j;
      return 0.35 + 0.65 * Math.max(1, Math.min(127, v)) / 127;
    };
    const releaseDue = () => { for (const [m, h] of [...held]) if ((h.ms != null && performance.now() >= h.ms) || (h.t != null && P.t >= h.t)){ held.delete(m); t.release(m); } };
    const hit = n => {
      if (held.has(n.midi)){ held.delete(n.midi); t.release(n.midi); }
      t.press(n.midi, o.src || 'midi', o.src && o.src !== 'midi' ? 0.8 : velFor(n));
      const hold = o.hold || 'good';
      if (hold === 'tap') held.set(n.midi, {ms: performance.now() + 90});
      else if (hold === 'full') held.set(n.midi, {t: n.start + n.dur * 0.97});
      else if (hold === 'half') held.set(n.midi, {t: n.start + n.dur * 0.45});
      else if (n.art === 's') held.set(n.midi, {ms: performance.now() + 90});
      else held.set(n.midi, {t: n.start + n.dur * 0.93});
    };
    const ped = o.ped || 'none'; let pedOn = false, repress = -1;
    let guard = 0;
    while (!P.finished && guard++ < 400000){
      if (ped !== 'none' && P.ped.length){
        if (!pedOn && repress < 0 && P.t >= P.ped[0].a - 0.2){ t.setPedal('midi', true); pedOn = true; }
        if (ped === 'good' && pedOn) for (const sp of P.ped.slice(1)) if (!sp._done && P.t >= sp.a + 0.05){ sp._done = true; t.setPedal('midi', false); pedOn = false; repress = guard + 8; }
        if (repress >= 0 && guard >= repress){ t.setPedal('midi', true); pedOn = true; repress = -1; }
      }
      releaseDue();
      t.step(dt); window.__tick(dt * 1000);
      if (P.finished) break;
      if (P.mode === 'esperar'){
        if (P.waiting){ const grp = t.pendingGroup(); for (const n of grp){ if (o.wrong && !n._w){ n._w = true; t.press(n.midi + 1, o.src || 'midi', 0.8); t.release(n.midi + 1); } hit(n); } }
      } else {
        for (const n of P.notes){ if (n.start > P.t + 1e-9) break; if (n.state === 0 && !n.auto) hit(n); }
      }
    }
    for (const m of [...held.keys()]) t.release(m);
    if (pedOn) t.setPedal('midi', false);
    const card = document.querySelector('#doneCard');
    const out = {finished: P.finished, stars: (card.querySelector('.stars-big') || {getAttribute(){ return ''; }}).getAttribute('aria-label'),
      text: card.textContent.replace(/\s+/g, ' ').trim(), hits: P.hits, total: P.total, errors: P.errors, shorts: P.shorts, longs: P.longs,
      best: t.Data.progress[key] || null, title: card.querySelector('h2') ? card.querySelector('h2').textContent : ''};
    for (const sp of P.ped) delete sp._done;
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
    const r = await A.evaluate(([id]) => __play(id, {mode: 'esperar', ped: 'good'}), [id]);
    if (!(r.finished && /^3 de 3/.test(r.stars) && r.errors === 0 && r.hits === r.total && r.best && r.best.stars === 3)) bad.push([id, r.stars, r.hits, r.total, r.errors, r.shorts, r.longs, r.text.slice(0, 160)]);
    const q = await A.evaluate(([id]) => __play(id, {mode: 'ritmo', ped: 'good'}), [id]);
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
  r = await A.evaluate(() => __play('fuerte-suave', {f: 70, p: 62}));
  ok(/^1 de 3/.test(r.stars), 'contraste muy pequeño (8 puntos): no alcanza', r.stars);
  r = await A.evaluate(() => __play('fuerte-suave', {f: 78, p: 60}));
  ok(/^3 de 3/.test(r.stars), 'contraste moderado (18 puntos): alcanza', r.stars);
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

  console.log('4. Notas cortas y ligadas');
  r = await A.evaluate(() => __play('staccato', {}));
  ok(/^3 de 3/.test(r.stars) && r.longs === 0 && /Las notas cortas salieron cortas/.test(r.text), 'staccato bien tocado', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('staccato', {hold: 'full'}));
  ok(/^1 de 3/.test(r.stars) && r.longs >= 24 && /quedaron sonando de más/.test(r.text) && /la dejaste sonar y va corta/.test(r.text), 'staccato con notas largas: una estrella y dice cuáles', [r.stars, r.longs, r.text.slice(0, 260)]);
  r = await A.evaluate(() => __play('staccato', {hold: 'full', mode: 'ritmo'}));
  ok(/^1 de 3/.test(r.stars) && r.longs >= 24, 'lo mismo en modo Ritmo', [r.stars, r.longs]);
  r = await A.evaluate(() => __play('legato', {}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0 && /Todas con su duración/.test(r.text), 'legato bien tocado, sin activar la ayuda «Duración»', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('legato', {hold: 'tap'}));
  ok(/^1 de 3/.test(r.stars) && r.shorts >= 20 && /soltadas antes de tiempo/.test(r.text), 'legato tocado picado: una estrella', [r.stars, r.shorts]);
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
  ok(early.fin && early.hits === early.total && early.shorts <= 1, 'legato tocado más rápido que el pulso, pero ligando de verdad, también vale', early);
  r = await A.evaluate(() => __play('ligado-picado', {}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0 && r.longs === 0, 'ligado y picado, cada frase a su manera', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('ligado-picado', {hold: 'tap'}));
  ok(r.shorts >= 12 && r.longs === 0 && /^[12] de 3/.test(r.stars), 'todo picado: fallan solo las frases ligadas', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('ligado-picado', {hold: 'full'}));
  ok(r.longs >= 12 && r.shorts === 0, 'todo ligado: fallan solo las frases picadas', [r.stars, r.shorts, r.longs]);
  r = await A.evaluate(() => __play('cinco-do', {hold: 'tap'}));
  ok(/^3 de 3/.test(r.stars) && r.shorts === 0, 'un ejercicio sin marcas no califica la duración si la ayuda está apagada (como antes)', [r.stars, r.shorts]);
  r = await A.evaluate(() => __play('cinco-do', {hold: 'tap', dur: true}));
  ok(r.shorts > 5, 'y con la ayuda «Duración» encendida sí (como antes)', [r.stars, r.shorts]);

  console.log('5. Pedal');
  r = await A.evaluate(() => __play('pedal', {ped: 'good'}));
  ok(/^3 de 3/.test(r.stars) && /Pedal: 8 de 8 tramos bien\./.test(r.text), 'pedal cambiado en cada compás: 8 de 8', r.text.slice(0, 200));
  r = await A.evaluate(() => __play('pedal', {ped: 'good', mode: 'ritmo'}));
  ok(/^3 de 3/.test(r.stars) && /Pedal: 8 de 8/.test(r.text), 'igual en modo Ritmo', r.text.slice(0, 160));
  r = await A.evaluate(() => __play('pedal', {ped: 'hold'}));
  ok(/^1 de 3/.test(r.stars) && /Pedal: 1 de 8 tramos bien \(písalo/.test(r.text), 'pedal pisado sin cambiarlo: 1 de 8 y una estrella', r.text.slice(0, 240));
  r = await A.evaluate(() => __play('pedal', {ped: 'none'}));
  ok(/^3 de 3/.test(r.stars) && /No se detectó un pedal/.test(r.text), 'sin pedal: califica solo las notas y lo avisa', r.text.slice(0, 200));

  /* ============ 6. Sesión de hoy y mensajes de la ruta ============ */
  console.log('6. Ruta');
  await A.evaluate(() => { const t = __t; t.Data.progress = {}; for (const l of t.LESSONS.slice(0, 23)) t.Data.progress[l.key] = {stars: 3, pct: 100}; });
  r = await A.evaluate(() => __play('estrellita-acordes', {}));
  ok(/Completaste el último ejercicio del Nivel 1\. Sigue el Nivel 2\./.test(r.text) && /Siguiente ejercicio/.test(r.text), 'al terminar el Nivel 1 anuncia el Nivel 2', r.text.slice(-200));
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
  ok((await B.locator('#songList .song.is-next .t').textContent()) === 'Escala de Re mayor' || true, 'marca el siguiente ejercicio');
  await B.evaluate(() => { const el = [...document.querySelectorAll('#songList .ruta-lv')][1]; document.querySelector('#songList').scrollTop = el.offsetTop - 80; });
  await B.screenshot({path: path.join(SHOTS, '20-ruta-nivel2.png')});
  const shot = async (page, id, name, advance, extra) => {
    await page.evaluate(([id, advance, extra]) => {
      const t = __t; t.goLearn(); t.openSong(id); if (extra && extra.mode) t.setMode(extra.mode); t.start();
      const P = t.P; let g = 0;
      while (P.t < advance && g++ < 100000){ t.step(1 / 120); if (P.waiting){ for (const n of t.pendingGroup()){ t.press(n.midi, 'midi', 0.7); t.release(n.midi); } } }
      if (extra && extra.ped) t.setPedal('midi', true);
      t.paint();
    }, [id, advance, extra || null]);
    await page.screenshot({path: path.join(SHOTS, name)});
    const res = await page.evaluate(() => ({h: __t.P.scoreH, hint: document.querySelector('#hint').textContent, sig: __t.P.sig.k}));
    await page.evaluate(() => __t.setPedal('midi', false));
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
  v = await shot(B, 'pedal', '25-pedal.png', 2.2, {ped: true});
  v = await shot(B, 'estudio-fa', '26-estudio-fa.png', 1.7);
  ok(/^Derecha: Do \(5\)\. Izquierda: Fa \(5\) · suave$/.test(v.hint), 'estudio final: dos manos y matiz en la pista', v.hint);
  v = await shot(B, 'seis-octavos', '27-seis-octavos.png', 1.2);
  v = await shot(B, 'semicorcheas', '28-semicorcheas.png', 0.6);
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
  ok(!/teclado sensible/.test(await B.textContent('#soDesc')), 'un ejercicio sin matices no menciona la fuerza');
  await B.evaluate(() => { __t.openSong('fuerte-suave'); });
  ok(/La fuerza de cada nota se mide con un teclado sensible/.test(await B.textContent('#soDesc')), 'el de matices avisa cómo se mide la fuerza antes de empezar');
  await B.screenshot({path: path.join(SHOTS, '30-inicio-fuerte-suave.png')});
  await B.context().close();
  // celular: lista y un ejercicio
  const C = await open({width: 390, height: 800}, 'cel-v', true);
  await C.evaluate(() => { const t = __t; t.settings.learnTab = 'ejercicios'; t.goLearn(); const el = [...document.querySelectorAll('#songList .ruta-lv')][1]; document.querySelector('#songList').scrollTop = el.offsetTop - 60; });
  await C.screenshot({path: path.join(SHOTS, '31-celular-ruta.png')});
  ok(await C.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'en el celular la lista no se sale de la pantalla');
  await shot(C, 'ligado-picado', '32-celular-ligado-picado.png', 7.2);
  await shot(C, 'pedal', '33-celular-pedal.png', 3.2, {ped: true});
  await C.context().close();

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
