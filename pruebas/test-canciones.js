// Prueba de las canciones de la app: revisa que estén bien escritas (compases, acordes, digitación, armadura)
// y un «pianista virtual» toca las nuevas en sus tres niveles, bien y mal, para comprobar la calificación.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const pianist = require('./pianista.js');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, SONGS, LEVELS, LH, Data, settings, aids, songData, songLevels, lvInfo, hasLevels, curLevel, keySig, isBlack, pc, findSong, openSong,
    start, step, press, release, pendingGroup, setMode, setSpeed, goLearn, goHome, getSession, saveSettings,
    paint(){ const grp = new Set(P && P.mode !== 'escuchar' ? pendingGroup() : []); draw(grp); drawScore(grp); }};\nNube.bind();`;
  return h.replace('Nube.bind();', hook);
}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const NEW = ['pollitos', 'susana', 'sorpresa', 'primavera', 'canon', 'sonata545'];

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  async function open(viewport, dev){
    const ctx = await browser.newContext({viewport});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(dev => {
      localStorage.setItem('piano:ajustes', JSON.stringify({device: dev, learnTab: 'canciones'}));
      let now = 1000; performance.now = () => now; window.__tick = ms => { now += ms; };
      window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
    }, dev);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    await page.evaluate(pianist);
    return page;
  }

  console.log('1. Las canciones están bien escritas');
  const A = await open({width: 1180, height: 820}, 'tab-h');
  const st = await A.evaluate(NEW => {
    const t = __t, bad = [], info = {};
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    for (const s of t.SONGS){
      const d = t.songData(s), notes = d.notes, at = s.id + ': ';
      if (!notes.length){ bad.push(at + 'sin notas'); continue; }
      const mlen = (s.pulse || 1) * (s.meter || 4), pick = s.pickup || 0;
      const melEnd = Math.max(...notes.filter(n => n.hand !== 'L').map(n => n.start + n.dur));
      if (!near((d.length - pick) / mlen, Math.round((d.length - pick) / mlen))) bad.push(at + `no termina en barra de compás (${d.length})`);
      // Acordes: suman lo mismo que la melodía y todos existen en la posición de la mano izquierda.
      const V = t.LH[s.pos || 'C']; let sum = 0;
      if (!V) bad.push(at + 'posición desconocida ' + s.pos);
      for (const tok of s.chords.trim().split(/\s+/)){
        const [nm, dur] = tok.split(':'); sum += parseFloat(dur);
        if (nm !== 'R' && V && !(V.ch[nm] && Object.assign({}, V.bass, s.bass || {})[nm])) bad.push(at + 'acorde sin tabla: ' + nm);
      }
      if (!near(sum, d.length)) bad.push(at + `los acordes suman ${sum} y la pieza dura ${d.length}`);
      if (s.left && !near(melEnd, Math.max(...notes.filter(n => n.hand === 'L').map(n => n.start + n.dur)))) bad.push(at + 'las dos manos no terminan juntas');
      for (const n of notes){
        if (n.midi < 43 || n.midi > 91) bad.push(at + 'nota fuera del teclado de 61 teclas: ' + n.midi);
        if (!(n.finger >= 1 && n.finger <= 5)) bad.push(at + 'nota sin dedo en ' + n.start);
      }
      // Armadura: ninguna nota la contradice (salvo que la canción antigua lo pida) y sirve para algo.
      const ks = t.keySig(s), blacks = notes.filter(n => t.isBlack(n.midi));
      const off = notes.filter(n => t.isBlack(n.midi) ? !ks.alt.has(t.pc(n.midi)) : ks.nat.has(t.pc(n.midi))).length;
      if (NEW.includes(s.id) && s.id !== 'sorpresa' && off) bad.push(at + off + ' notas contradicen la armadura');
      if (ks.n && !blacks.some(n => ks.alt.has(t.pc(n.midi)))) bad.push(at + 'la armadura no se usa');
      // Marcas de matiz y articulación dentro de la pieza
      for (const k of String(s.dyn || '').split(/\s+/).concat(String(s.art || '').split(/\s+/)).filter(Boolean)){ const tt = parseFloat(k); if (!(tt >= 0 && tt < d.length)) bad.push(at + 'marca fuera de la pieza: ' + k); }
      // Niveles: la izquierda siempre por debajo de la derecha, y cada nivel añade notas.
      const lv = t.songLevels(s);
      const L = [1, 2, 3].map(n => lv.notes[n]);
      if (!(L[0].length && L[1].length > L[0].length && L[2].length > L[1].length)) bad.push(at + 'los niveles no crecen: ' + L.map(x => x.length));
      for (const arr of L.slice(1)) for (const l of arr.filter(n => n.hand === 'L')){
        for (const r of arr) if (r.hand !== 'L' && r.start < l.start + l.dur - 1e-6 && r.start + r.dur > l.start + 1e-6 && r.midi <= l.midi){ bad.push(at + `la izquierda se cruza con la derecha en ${l.start}`); break; }
      }
      if (!s.title || !s.origin || !t.LEVELS[s.level]) bad.push(at + 'faltan datos');
      if (s.level === 4 && !(s.skills && s.goal && s.goal.length < 330)) bad.push(at + 'falta decir qué se practica');
      info[s.id] = {len: d.length, n: notes.length, lv: L.map(x => x.length), sig: ks.k, hasL3Left: L[2].filter(n => n.hand === 'L').length};
    }
    return {bad, n: t.SONGS.length, byLevel: [1, 2, 3, 4].map(l => t.SONGS.filter(s => s.level === l).length), info, ids: new Set(t.SONGS.map(s => s.id)).size,
      orig: t.lvInfo(t.findSong('sonata545'), 3).name, acordes: t.lvInfo(t.findSong('canon'), 3).name};
  }, NEW);
  ok(st.bad.length === 0, 'compases, acordes, dedos, armaduras, marcas y niveles de todas las canciones', st.bad);
  ok(st.n === 21 && st.ids === 21 && st.byLevel.join() === '4,7,4,6', 'son 21 canciones: las 15 de antes y 6 nuevas', st.byLevel);
  ok(st.info.pollitos.sig === -1 && st.info.primavera.sig === -1 && st.info.susana.sig === 2 && st.info.canon.sig === 2 && st.info.minueto.sig === 1, 'hay canciones en Fa mayor, Re mayor y Sol mayor con su armadura');
  ok(st.info.susana.len === 65 && st.info.sorpresa.len === 32 && st.info.primavera.len === 24.5 && st.info.canon.len === 52 && st.info.sonata545.len === 20 && st.info.pollitos.len === 32, 'cada canción nueva dura lo que debe', NEW.map(id => st.info[id].len));
  ok(st.orig === 'Original' && st.acordes === 'Con acordes' && st.info.sonata545.hasL3Left === 35, 'en la sonata el tercer nivel es el bajo Alberti escrito, no acordes en bloque', [st.orig, st.info.sonata545]);

  console.log('2. El pianista virtual toca las canciones nuevas');
  const play = (id, level, o) => A.evaluate(([id, level, o]) => { __t.settings.niveles = Object.assign({}, __t.settings.niveles, {[id]: level}); return __play(id, o); }, [id, level, o || {}]);
  for (const id of NEW){
    const out = [];
    for (const lv of [1, 2, 3]){
      const r = await play(id, lv, {mode: 'esperar'}), q = await play(id, lv, {mode: 'ritmo'});
      if (!/^3 de 3/.test(r.stars) || !/^3 de 3/.test(q.stars) || r.hits !== st.info[id].lv[lv - 1]) out.push([lv, r.stars, q.stars, r.hits, r.text.slice(0, 120)]);
    }
    ok(out.length === 0, `${id}: tres estrellas en los tres niveles, en Esperar y en Ritmo`, out);
  }
  let r = await play('pollitos', 1, {});
  ok(/Se nota la diferencia entre fuerte y suave/.test(r.text), 'pollitos: reconoce el fuerte y el suave', r.text.slice(0, 200));
  r = await play('pollitos', 3, {flat: 80});
  ok(/^1 de 3/.test(r.stars) && r.title === 'Falta la expresión', 'pollitos todo igual de fuerte: una estrella', [r.stars, r.title]);
  r = await play('pollitos', 1, {src: 'touch'});
  ok(/^3 de 3/.test(r.stars), 'en pantalla táctil no se pide la fuerza', r.text.slice(0, 200));
  r = await play('sorpresa', 3, {});
  ok(/Las notas cortas salieron cortas/.test(r.text) && /Se nota la diferencia entre fuerte y suave/.test(r.text), 'sorpresa: staccato y el acorde fuerte del final', r.text.slice(0, 240));
  r = await play('sorpresa', 1, {hold: 'full'});
  ok(/^1 de 3/.test(r.stars) && r.title === 'Falta la expresión', 'sorpresa con las corcheas largas: una estrella', [r.stars, r.title, r.text.slice(0, 160)]);
  r = await play('sorpresa', 1, {flat: 50});
  ok(/^1 de 3/.test(r.stars), 'sorpresa sin la sorpresa: una estrella', [r.stars, r.text.slice(0, 200)]);
  r = await play('canon', 3, {});
  ok(/Las notas ligadas salieron unidas/.test(r.text) && /Crescendos y diminuendos: 1 de 1 bien|crescendo/i.test(r.text), 'canon: legato y crescendo reconocidos', r.text.slice(0, 260));
  r = await play('canon', 1, {hold: 'tap'});
  ok(/^1 de 3/.test(r.stars), 'canon tocado picado: una estrella', [r.stars, r.text.slice(0, 160)]);
  r = await play('canon', 1, {hair: 'flat'});
  ok(/^1 de 3/.test(r.stars), 'canon sin crecer: una estrella', [r.stars, r.text.slice(0, 220)]);
  r = await play('susana', 2, {flat: 76});
  ok(/^1 de 3/.test(r.stars), 'Susana sin diferencia entre estrofa y estribillo: una estrella', [r.stars, r.text.slice(0, 200)]);
  const best = await A.evaluate(() => Object.keys(__t.Data.progress).filter(k => /^(pollitos|canon|sonata545)/.test(k)).sort());
  ok(best.join() === 'canon,canon~2,canon~3,pollitos,pollitos~2,pollitos~3,sonata545,sonata545~2,sonata545~3', 'las estrellas de cada nivel se guardan aparte', best);

  console.log('3. Las canciones de antes siguen igual');
  const old = await A.evaluate(() => { __t.Data.progress = {}; return __t.SONGS.filter(s => s.level < 4).map(s => s.id); });
  const fails = [];
  for (const id of old){ const x = await play(id, 3, {mode: 'esperar'}); if (!/^3 de 3/.test(x.stars)) fails.push([id, x.stars, x.text.slice(0, 80)]); }
  ok(fails.length === 0 && old.length === 15, 'las 15 canciones anteriores se tocan completas con acordes', fails);

  console.log('4. Lista y partituras');
  await A.evaluate(() => { __t.Data.progress = {}; __t.settings.niveles = {}; __t.settings.learnTab = 'canciones'; __t.goLearn(); });
  const txt = (await A.textContent('#songList')).replace(/\s+/g, ' ');
  ok(/Con lo aprendido en el Nivel 2/.test(txt) && /Los pollitos dicen\s*Canción infantil tradicional\. Fa mayor, fuerte y suave\./.test(txt) && /Sonata en Do, K\. 545/.test(txt), 'la lista tiene el grupo nuevo y dice qué se practica en cada canción', txt.slice(-600, -200));
  await A.evaluate(() => { const el = [...document.querySelectorAll('#songList .lvl h2')].find(h => /Nivel 2/.test(h.textContent)); document.querySelector('#songList').scrollTop = el.offsetTop - 70; });
  await A.screenshot({path: path.join(SHOTS, 'canciones-lista.png')});
  const shot = async (id, level, advance, name) => {
    const res = await A.evaluate(([id, level, advance]) => {
      const t = __t; t.settings.niveles = {[id]: level}; t.aids.score = true; t.goLearn(); t.openSong(id);
      const card = {goal: document.querySelector('#soGoal').textContent, lv: document.querySelector('#levelSeg').textContent};
      t.setMode('esperar'); t.start();
      const P = t.P; let g = 0;
      while (P.t < advance && g++ < 100000){ t.step(1 / 120); if (P.waiting){ for (const n of t.pendingGroup()){ t.press(n.midi, 'midi', 0.7); t.release(n.midi); } } }
      t.paint();
      return Object.assign(card, {h: P.scoreH, sig: P.sig.k, dyn: P.dynMarks.length, hairs: P.hairs.length, slurs: P.sheet.slurs.length, staves: P.sheet.staves.length, hint: document.querySelector('#hint').textContent});
    }, [id, level, advance]);
    await A.screenshot({path: path.join(SHOTS, name)});
    return res;
  };
  let v = await shot('pollitos', 3, 1.2, 'cancion-pollitos.png');
  ok(v.sig === -1 && v.dyn === 2 && v.staves === 2 && /Si♭/.test(v.goal) && /Con acordes/.test(v.lv), 'pollitos con acordes: un bemol en la armadura, f y p en la partitura', v);
  v = await shot('canon', 3, 17, 'cancion-canon.png');
  ok(v.sig === 2 && v.hairs === 1 && v.slurs >= 1 && v.dyn === 2, 'canon: dos sostenidos, ligaduras, p, regulador y f', v);
  v = await shot('sorpresa', 1, 28.2, 'cancion-sorpresa.png');
  ok(v.dyn === 2 && v.staves === 1, 'sorpresa: p al principio y f en el último acorde', v);
  v = await shot('primavera', 2, 0.6, 'cancion-primavera.png');
  ok(v.sig === -1 && v.dyn === 2 && /Con bajo/.test(v.lv), 'primavera con bajo: armadura y eco', v);
  v = await shot('sonata545', 3, 4.2, 'cancion-sonata.png');
  ok(v.staves === 2 && /Original/.test(v.lv) && /Mozart/.test(v.goal), 'sonata: dos pentagramas y el nivel «Original»', v);
  v = await shot('minueto', 1, 1.2, 'cancion-minueto.png');
  ok(v.sig === 1, 'el Minueto en Sol ahora muestra su armadura', v);
  await A.context().close();

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
