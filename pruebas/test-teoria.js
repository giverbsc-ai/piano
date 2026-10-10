// Prueba de la teoría: revisa que las lecciones estén bien armadas y recorre la segunda parte completa
// como lo haría un alumno: lee, contesta las pruebas con el teclado y toca cada ejercicio hasta aprobarlo.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const pianist = require('./pianista.js');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, get TL(){ return TL; }, LESSONS, UNITS, SONGS, TSONGS, TEO, TEO_PARTS, Data, settings, aids, findSong, teoSongKey, figOf, openSong, openLesson,
    start, step, press, release, pendingGroup, setMode, setSpeed, goLearn, goHome, goTheory, teoStore};\nNube.bind();`;
  return h.replace('Nube.bind();', hook);
}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = `http://localhost:${server.address().port}/piano/Piano.html`;
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const errors = [];
  async function open(viewport, dev, done){
    const ctx = await browser.newContext({viewport});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(([dev, done]) => {
      if (!localStorage.getItem('piano:ajustes')){
        localStorage.setItem('piano:ajustes', JSON.stringify({device: dev}));
        const best = {}; for (let i = 1; i <= done; i++) best['teoria:d' + i] = {stars: 3, pct: 100};
        localStorage.setItem('piano:mejores', JSON.stringify(best));
      }
      let now = 1000; performance.now = () => now; window.__tick = ms => { now += ms; };
      window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
    }, [dev, done]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    await page.evaluate(pianist);
    return page;
  }

  console.log('1. Las lecciones están bien armadas');
  const A = await open({width: 390, height: 800}, 'cel-v', 16);
  const st = await A.evaluate(() => {
    const t = __t, bad = [], used = [];
    for (const l of t.TEO){
      if (!l.title || !l.sum || !l.fin || !l.steps.length) bad.push(l.id + ': falta texto');
      if (!l.steps.some(s => s.k !== 'text')) bad.push(l.id + ': no tiene nada que tocar');
      if (l.steps[l.steps.length - 1].k === 'text') bad.push(l.id + ': termina leyendo');
      l.steps.forEach((s, i) => {
        const at = `${l.id} paso ${i + 1}`;
        if (!s.h || !s.p || (Array.isArray(s.p) && !s.p.length)) bad.push(at + ': sin texto');
        if (s.k === 'text'){
          const svg = t.figOf(s.fig);
          if (s.fig && (!/^<svg/.test(svg) || /NaN|undefined|null/.test(svg) || !/aria-label="[^"]{8,}"/.test(svg))) bad.push(at + ': dibujo dañado');
        } else if (s.k === 'play'){
          const song = t.findSong(t.teoSongKey(s));
          if (!song) bad.push(at + ': no existe ' + s.song);
          else if (l.part === 2) used.push(song.id);
        } else {
          const r = s.range || [48, 84];
          for (const it of s.items || (s.pool || []).map(v => s.k === 'staff' ? {midi: v} : {pc: v})){
            if (it.midi != null && (it.midi < r[0] || it.midi > r[1])) bad.push(at + ': tecla fuera del teclado ' + it.midi);
            if (it.midi == null && !(it.pc >= 0 && it.pc < 12)) bad.push(at + ': nota inválida');
          }
          if (!s.items && !(s.n > 0 && s.pool.length > 1)) bad.push(at + ': prueba vacía');
        }
      });
    }
    const lvl2 = t.UNITS.filter(u => u.lvl === 2).flatMap(u => u.ids);
    return {bad, n: t.TEO.length, p2: t.TEO.filter(l => l.part === 2).length, used, lvl2,
      ids: new Set(t.TEO.map(l => l.id)).size, long: t.TEO.flatMap(l => l.steps.flatMap(s => [].concat(s.p))).filter(p => p.length > 330)};
  });
  ok(st.bad.length === 0, 'todas las lecciones tienen textos, dibujos válidos, pruebas posibles y ejercicios que existen', st.bad);
  ok(st.n === 28 && st.p2 === 12 && st.ids === 28, 'son 28 lecciones: 16 de la primera parte y 12 de la segunda', [st.n, st.p2]);
  ok(JSON.stringify(st.used.slice().sort()) === JSON.stringify(st.lvl2.slice().sort()), 'la segunda parte usa los 24 ejercicios del Nivel 2, cada uno una vez', st.lvl2.filter(x => !st.used.includes(x)).concat(st.used.filter((x, i) => st.used.indexOf(x) !== i)));
  ok(st.used.every((id, i) => i === 0 || st.lvl2.indexOf(id) > -1), 'y solo ejercicios del Nivel 2');
  ok(st.long.length === 0, 'ningún párrafo es demasiado largo para leerlo en el celular', st.long.map(p => p.slice(0, 50)));

  console.log('2. La lista de lecciones');
  await A.evaluate(() => __t.goTheory());
  let txt = (await A.textContent('#teoList')).replace(/\s+/g, ' ');
  ok(/Primera parte · Desde cero\s*16 de 16/.test(txt) && /Segunda parte · Tocar con soltura\s*0 de 12/.test(txt), 'la lista separa las dos partes y cuenta cada una', txt.slice(0, 300));
  ok(/16 de 28 lecciones/.test(txt) && /Hoy te toca el día 17/.test(txt), 'quien terminó la primera parte sigue en el día 17');
  ok(await A.evaluate(() => !document.querySelector('[data-teo="16"]').disabled && document.querySelector('[data-teo="17"]').disabled), 'el día 17 está abierto y el 18 espera');
  await A.evaluate(() => { document.querySelector('#teoList').scrollTop = document.querySelector('[data-teo="16"]').offsetTop - 160; });
  await A.screenshot({path: path.join(SHOTS, 'teoria-lista.png')});

  console.log('3. Un alumno recorre la segunda parte');
  let shots = 0;
  for (let i = 16; i < 28; i++){
    await A.evaluate(i => { __t.goTheory(); document.querySelector(`[data-teo="${i}"]`).click(); }, i);
    const info = await A.evaluate(() => ({id: __t.TL.l.id, n: __t.TL.l.steps.length, title: document.querySelector('#tTitle').textContent}));
    const log = [];
    for (let k = 0; k < info.n; k++){
      const s = await A.evaluate(() => { const s = __t.TL.l.steps[__t.TL.idx]; return {k: s.k, fig: !!s.fig, idx: __t.TL.idx, song: s.song, mode: s.mode}; });
      if (s.idx !== k){ log.push(`paso ${k + 1}: la lección no avanzó`); break; }
      if (s.k === 'text'){
        if (s.fig){
          const box = await A.evaluate(() => { const f = document.querySelector('#tBody .tfig').getBoundingClientRect(), b = document.querySelector('#tBody').getBoundingClientRect(); return {w: f.width, h: f.height, fits: f.right <= b.right + 1 && f.left >= b.left - 1}; });
          if (!(box.w > 150 && box.h > 50 && box.fits)) log.push(`paso ${k + 1}: el dibujo no cabe ${JSON.stringify(box)}`);
          await A.screenshot({path: path.join(SHOTS, `teoria-${info.id}-${k + 1}.png`)}); shots++;
        }
      } else if (s.k === 'play'){
        await A.click('#tBody [data-tq="play"]');
        const r = await A.evaluate(() => __play(null, {keep: true}));
        if (!/¡Aprobado!/.test(r.text)) log.push(`paso ${k + 1} (${s.song}): no aprobó: ${r.text.slice(0, 140)}`);
        if (s.mode && !new RegExp('modo ' + (s.mode === 'ritmo' ? 'Ritmo' : 'Esperar'), 'i').test(await A.evaluate(() => document.querySelector('#soDesc').textContent))) log.push(`paso ${k + 1}: no avisa el modo`);
        await A.click('#doneCard [data-act="teo-next"]');
        continue;   // «Continuar la lección» ya pasa al paso siguiente
      } else {
        if (i === 16 && s.k === 'staff'){
          // Con la armadura de Fa, tocar Si natural en lugar de Si bemol explica el error.
          await A.waitForFunction(() => __t.TL.q && __t.TL.q.phase === 'input');
          const msg = await A.evaluate(() => { const q = __t.TL.q; q.items[q.i] = {midi: 70}; __t.press(71, 'midi', 0.8); __t.release(71); const m = document.querySelector('#tqFb').textContent; q.errors = 0; q.miss = 0; return m; });
          ok(/Esa es Si\. Mira la armadura: en esta tonalidad esa nota lleva bemol\./.test(msg), 'leer Si natural con un bemol en la armadura explica el error', msg);
          const fig = await A.evaluate(() => document.querySelector('#tqQ svg').outerHTML);
          ok((fig.match(/<path/g) || []).length === 3, 'la nota de la prueba se dibuja con la clave y la armadura, sin signo al lado', (fig.match(/<path/g) || []).length);
          await A.screenshot({path: path.join(SHOTS, 'teoria-prueba-armadura.png')});
        }
        for (let g = 0; g < 150; g++){
          const phase = await A.evaluate(() => __t.TL.q ? __t.TL.q.phase : 'none');
          if (phase === 'done' || phase === 'none') break;
          if (phase === 'input') await A.evaluate(() => { const q = __t.TL.q, it = q.items[q.i], m = it.midi != null ? it.midi : 60 + it.pc; __t.press(m, 'midi', 0.8); __t.release(m); });
          await sleep(120);
        }
        if (!/¡Aprobado!/.test(await A.textContent('#tq'))) log.push(`paso ${k + 1}: la prueba no se aprobó: ${(await A.textContent('#tq')).slice(0, 100)}`);
      }
      if (await A.isDisabled('#tNext')){ log.push(`paso ${k + 1}: «Siguiente» sigue bloqueado`); break; }
      await A.click('#tNext');
    }
    const end = (await A.textContent('#tBody')).replace(/\s+/g, ' ');
    ok(log.length === 0 && /¡Lección aprobada!/.test(end) && await A.evaluate(id => !!__t.Data.progress['teoria:' + id], info.id), `${info.title}: se lee, se contesta, se toca y se aprueba`, log.length ? log : end.slice(0, 120));
  }
  ok(shots >= 20, 'cada dibujo nuevo cabe en la pantalla del celular', shots);
  const fin = await A.evaluate(() => ({teo: __t.TEO.filter(l => __t.Data.progress[l.key]).length, ex: __t.UNITS.filter(u => u.lvl === 2).flatMap(u => u.ids).filter(id => (__t.Data.progress[id] || {}).stars >= 2).length}));
  ok(fin.teo === 28 && fin.ex === 24, 'al terminar, las 28 lecciones quedan aprobadas y los 24 ejercicios del Nivel 2 con estrellas', fin);
  await A.evaluate(() => __t.goTheory());
  txt = (await A.textContent('#teoList')).replace(/\s+/g, ' ');
  ok(/Segunda parte · Tocar con soltura\s*12 de 12/.test(txt) && /Terminaste todas las lecciones/.test(txt), 'la lista lo refleja', txt.slice(0, 200));
  await A.context().close();

  console.log('4. Alumno nuevo y tablet');
  const B = await open({width: 1180, height: 760}, 'tab-h', 0);
  await B.evaluate(() => __t.goTheory());
  txt = (await B.textContent('#teoList')).replace(/\s+/g, ' ');
  ok(/0 de 28 lecciones/.test(txt) && /Hoy te toca el día 1\./.test(txt) && await B.evaluate(() => document.querySelector('[data-teo="16"]').disabled), 'un alumno nuevo empieza en el día 1 y la segunda parte está cerrada');
  await B.screenshot({path: path.join(SHOTS, 'teoria-lista-tablet.png')});
  await B.context().close();

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
