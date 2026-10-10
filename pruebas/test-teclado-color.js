// Teclado en color (azul la mano izquierda, rojo la derecha), tecla equivocada en rojo más intenso y números de dedo sobre las teclas.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, SONGS, settings, aids, press, release, goFree, goLearn, goHome, openSong, openReto, start, step, setMode,
    pendingGroup, handSplit, get range(){ return range; }};\nNube.bind();`;
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
  async function open(opts, ajustes){
    const ctx = await browser.newContext(opts);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(a => { if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify(a)); }, ajustes);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    return page;
  }
  const txt = (page, sel) => page.evaluate(sel => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim(), sel);
  // Clases de mano de cada tecla en pantalla: 'l', 'r' o '' (sin color).
  const manos = page => page.evaluate(() => { const o = {}; document.querySelectorAll('#keys .key').forEach(k => { o[k.dataset.m] = k.classList.contains('hl') ? 'l' : k.classList.contains('hr') ? 'r' : ''; }); return o; });
  const fondo = (page, m) => page.evaluate(m => getComputedStyle(document.querySelector(`#keys .key[data-m="${m}"]`)).backgroundImage, m);
  // Números de dedo sobre las teclas: {nota: 'r1' | 'l5' …}.
  const dedos = page => page.evaluate(() => { const o = {}; document.querySelectorAll('#keys .key .fg').forEach(b => { o[b.parentElement.dataset.m] = (b.classList.contains('l') ? 'l' : 'r') + b.textContent; }); return o; });
  // Lo que deberían mostrar: el dedo de la próxima nota pendiente de cada tecla.
  const debidos = page => page.evaluate(() => {
    const w = {}; for (const n of __t.P.notes){ if (n.state !== 0 || n.auto || !n.finger) continue; if (!w[n.midi] || n.start < w[n.midi].start) w[n.midi] = n; }
    const o = {}; for (const m in w) if (m >= __t.range.lo && m <= __t.range.hi) o[m] = (w[m].hand === 'L' ? 'l' : 'r') + w[m].finger; return o;
  });
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

  console.log('1. Tocar libre: mitad azul, mitad roja');
  const A = await open({viewport: {width: 1180, height: 760}}, {device: 'tab-h'});
  await A.evaluate(() => __t.goFree()); await sleep(100);
  let h = await manos(A);
  const ks = Object.keys(h).map(Number);
  ok(ks.length > 20 && ks.every(m => h[m] === (m < 60 ? 'l' : 'r')), 'las teclas por debajo del Do central son de la izquierda y desde el Do central, de la derecha', h);
  ok(/226, 235, 249/.test(await fondo(A, 57)) && /250, 228, 227/.test(await fondo(A, 62)), 'las blancas se ven azul suave a la izquierda y rojo suave a la derecha', [await fondo(A, 57), await fondo(A, 62)]);
  ok(/24, 34, 56/.test(await fondo(A, 58)) && /51, 24, 30/.test(await fondo(A, 61)), 'las negras llevan el mismo tono, muy oscuro', [await fondo(A, 58), await fondo(A, 61)]);
  // El tono es suave: muy claro y poco saturado.
  const suave = c => { const [r, g, b] = c; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx >= 240 && mx - mn <= 30; };
  ok(suave([226, 235, 249]) && suave([250, 228, 227]), 'los dos tonos son claros y poco saturados');
  await A.evaluate(() => __t.press(57, 'ptr')); const dn = await fondo(A, 57); await A.evaluate(() => __t.release(57));
  ok(/191, 207, 235/.test(dn), 'una tecla apretada se oscurece dentro de su mismo tono', dn);
  await A.screenshot({path: path.join(SHOTS, 'color-libre.png')});

  console.log('\n2. Se puede quitar desde Ajustes');
  await A.click('#btnSettings');
  ok(await A.isChecked('#setManos'), 'Ajustes trae marcada «Teclado en color»');
  await A.uncheck('#setManos');
  h = await manos(A);
  ok(Object.values(h).every(v => v === '') && /251, 248, 242/.test(await fondo(A, 62)), 'al desmarcarla el teclado vuelve al marfil de siempre', await fondo(A, 62));
  ok((await A.evaluate(() => JSON.parse(localStorage.getItem('piano:ajustes')).aids.manos)) === false, 'y queda guardado');
  await A.check('#setManos'); await A.click('#dlgClose');
  ok((await manos(A))[62] === 'r', 'al marcarla vuelve el color');

  console.log('\n3. En un ejercicio: dedos sobre las teclas');
  await A.evaluate(() => { __t.openSong('cinco-do'); }); await sleep(200);
  let d = await dedos(A);
  ok(same(d, {60: 'r1', 62: 'r2', 64: 'r3', 65: 'r4', 67: 'r5'}), 'antes de empezar, las cinco teclas de la posición muestran su dedo: 1 2 3 4 5', d);
  ok(same(d, await debidos(A)), 'cada tecla muestra el dedo de su próxima nota');
  const chipsA = await A.evaluate(() => [...document.querySelectorAll('#aidChips [data-aid]')].map(b => b.dataset.aid + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
  ok(chipsA.includes('manos*') && chipsA.includes('dedos*'), 'entre las ayudas están «Digitación» y «Teclado en color», activas', chipsA);
  await A.screenshot({path: path.join(SHOTS, 'color-ayudas.png')});
  await A.evaluate(() => { __t.setMode('esperar'); __t.start(); }); await sleep(100);
  ok(same(await dedos(A), await debidos(A)) && Object.keys(await dedos(A)).length === 5, 'al empezar siguen ahí');
  // Tecla equivocada: rojo más intenso que el tono suave.
  await A.evaluate(() => __t.press(63, 'ptr')); const bad = await fondo(A, 63); await A.evaluate(() => __t.release(63));
  await A.evaluate(() => __t.press(62, 'ptr')); const badW = await fondo(A, 62);
  await A.screenshot({path: path.join(SHOTS, 'color-error.png')});
  await A.evaluate(() => __t.release(62));
  ok(/217, 96, 111/.test(badW) && /232, 142, 153/.test(badW), 'una tecla blanca equivocada se pone de un rojo más intenso que su tono', badW);
  ok(/124, 25, 41/.test(bad), 'y una negra equivocada también', bad);
  const sat = c => Math.max(...c) - Math.min(...c);
  ok(sat([217, 96, 111]) > 4 * sat([250, 228, 227]) && sat([217, 96, 111]) < sat([184, 57, 75]) + 1 && 217 + 96 + 111 > 184 + 57 + 75, 'es bastante más intenso que el tono suave, pero más claro que el rojo fuerte del tema');
  await sleep(350);
  ok(/250, 228, 227/.test(await fondo(A, 62)), 'después del aviso la tecla vuelve a su tono suave', await fondo(A, 62));
  // Tocar la pieza: los números se van actualizando y al final no queda ninguno.
  // En modo Esperar la pieza se detiene en cada nota: se adelanta el reloj hasta ahí y se toca lo que pide.
  const tocarHasta = max => A.evaluate(max => {
    const P = __t.P; let guard = 0, n = 0;
    while (n < max && P.notes.some(x => x.state === 0) && guard++ < 20000){
      if (!P.waiting){ __t.step(0.05); continue; }
      const g = __t.pendingGroup().map(x => x.midi);
      g.forEach(m => __t.press(m, 'midi', 0.7)); g.forEach(m => __t.release(m)); n++;
    }
    return n;
  }, max);
  let pasos = await tocarHasta(3);
  ok(pasos === 3 && same(await dedos(A), await debidos(A)), 'a media pieza cada tecla sigue mostrando el dedo de su próxima nota', await dedos(A));
  pasos += await tocarHasta(500);
  await sleep(200);
  ok(pasos > 5 && Object.keys(await dedos(A)).length === 0, 'al terminar la pieza ya no queda ningún número', await dedos(A));

  console.log('\n4. Las ayudas se apagan y se encienden antes de empezar');
  await A.evaluate(() => { __t.openSong('cinco-do'); }); await sleep(200);
  await A.click('#aidChips [data-aid="dedos"]');
  ok(Object.keys(await dedos(A)).length === 0, 'sin «Digitación» no hay números sobre las teclas');
  await A.click('#aidChips [data-aid="dedos"]');
  ok(Object.keys(await dedos(A)).length === 5 && /sobre las teclas del piano/.test(await txt(A, '#aidDesc')), 'con «Digitación» vuelven, y la ayuda lo explica', await txt(A, '#aidDesc'));
  await A.click('#aidChips [data-aid="manos"]');
  ok(Object.values(await manos(A)).every(v => v === '') && /Teclado en color desactivado/.test(await txt(A, '#aidDesc')), 'sin «Teclado en color» el teclado queda en marfil', await txt(A, '#aidDesc'));
  await A.click('#btnSettings');
  ok(!(await A.isChecked('#setManos')), 'y Ajustes lo refleja');
  await A.check('#setManos'); await A.click('#dlgClose');
  ok((await manos(A))[62] === 'r' && (await A.getAttribute('#aidChips [data-aid="manos"]', 'aria-pressed')) === 'true', 'al marcarlo en Ajustes vuelve el color y la ayuda queda activa');

  console.log('\n5. Todas las piezas: el color sigue a la mano que toca');
  const rep = await A.evaluate(async () => {
    const out = {n: 0, bad: [], cruzan: [], corridas: [], izq: 0, dosManos: 0, conDedos: 0, fgBad: []};
    for (const s of [...__t.LESSONS, ...__t.SONGS]){
      __t.openSong(s.key);
      const P = __t.P; if (!P) continue;
      out.n++;
      let L = -1, R = 999;
      for (const n of P.notes){ if (n.hand === 'L') L = Math.max(L, n.midi); else R = Math.min(R, n.midi); }
      if (L >= 0) out.izq++; if (L >= 0 && R < 999) out.dosManos++;
      const sp = __t.handSplit();
      if (L >= R){ out.cruzan.push(s.key); if (sp !== 60) out.bad.push(s.key + ': cruzan y no queda en 60'); }
      else {
        if (sp !== 60) out.corridas.push(s.key + '@' + sp);
        for (const n of P.notes){
          const el = document.querySelector(`#keys .key[data-m="${n.midi}"]`); if (!el) continue;
          if (!el.classList.contains(n.hand === 'L' ? 'hl' : 'hr')){ out.bad.push(`${s.key}: ${n.midi} ${n.hand}`); break; }
        }
      }
      // Dedos: lo mostrado coincide con la próxima nota de cada tecla.
      const w = {}; for (const n of P.notes){ if (n.auto || !n.finger) continue; if (!w[n.midi] || n.start < w[n.midi].start) w[n.midi] = n; }
      if (Object.keys(w).length) out.conDedos++;
      for (const m in w){
        const b = document.querySelector(`#keys .key[data-m="${m}"] .fg`);
        if (!b || b.textContent !== String(w[m].finger) || b.classList.contains('l') !== (w[m].hand === 'L')){ out.fgBad.push(`${s.key}: ${m}`); break; }
      }
      if (document.querySelectorAll('#keys .key .fg').length !== Object.keys(w).length) out.fgBad.push(s.key + ': sobran números');
    }
    return out;
  });
  ok(rep.n > 60 && rep.bad.length === 0, `en las ${rep.n} piezas cada nota cae en el color de su mano (${rep.izq} con mano izquierda, ${rep.dosManos} a dos manos)`, rep.bad.slice(0, 5));
  ok(rep.fgBad.length === 0 && rep.conDedos > 40, `en las ${rep.conDedos} piezas con digitación las teclas muestran el dedo correcto y con el color de su mano`, rep.fgBad.slice(0, 5));
  console.log('       frontera corrida en: ' + (rep.corridas.join(', ') || 'ninguna') + ' | manos que se cruzan: ' + (rep.cruzan.join(', ') || 'ninguna'));
  // Una pieza a dos manos, para la captura.
  const dos = await A.evaluate(() => { for (const s of [...__t.LESSONS, ...__t.SONGS]){ __t.openSong(s.key); const P = __t.P; if (P && P.notes.some(n => n.hand === 'L' && n.finger) && P.notes.some(n => n.hand !== 'L' && n.finger)) return s.key; } return ''; });
  d = await dedos(A);
  ok(!!dos && Object.values(d).some(v => v[0] === 'l') && Object.values(d).some(v => v[0] === 'r'), 'en una pieza a dos manos hay números azules (izquierda) y vino (derecha)', [dos, d]);
  const col = await A.evaluate(() => { const g = s => { const b = document.querySelector(s); return b ? getComputedStyle(b).backgroundColor : ''; }; return [g('#keys .fg.l'), g('#keys .fg:not(.l)')]; });
  ok(col[0] === 'rgb(46, 76, 148)' && col[1] === 'rgb(142, 36, 54)', 'los de la izquierda son azules y los de la derecha, vino', col);
  await A.evaluate(() => { __t.setMode('esperar'); __t.start(); }); await sleep(150);
  await A.screenshot({path: path.join(SHOTS, 'color-dos-manos.png')});

  console.log('\n6. Al salir del ejercicio');
  await A.evaluate(() => __t.goFree()); await sleep(100);
  h = await manos(A);
  ok(Object.keys(await dedos(A)).length === 0 && Object.keys(h).every(m => h[m] === (+m < 60 ? 'l' : 'r')), 'en Tocar libre no quedan números y la frontera vuelve al Do central');
  await A.evaluate(() => __t.openReto('nota', 1)); await sleep(150);
  h = await manos(A);
  ok(Object.keys(h).length > 5 && Object.keys(h).every(m => h[m] === (+m < 60 ? 'l' : 'r')), 'en los retos el teclado también va en color');

  console.log('\n7. Otros tamaños de pantalla');
  for (const [name, vp, dev] of [['cel-h', {width: 800, height: 380}, 'cel-h'], ['cel-v', {width: 390, height: 800}, 'cel-v'], ['pc', {width: 1366, height: 768}, 'pc']]){
    const B = await open({viewport: vp}, {device: dev});
    await B.evaluate(() => { __t.openSong('cinco-do'); }); await sleep(200);
    const box = await B.evaluate(() => {
      const r = el => el.getBoundingClientRect(), go = document.querySelector('#btnStart') || [...document.querySelectorAll('#startOv .btn.primary')][0];
      const card = document.querySelector('#startOv .card'), g = go ? r(go) : null;
      return {sw: document.documentElement.scrollWidth, vw: innerWidth, chips: document.querySelectorAll('#aidChips [data-aid]').length,
              goIn: !!g && g.width > 0 && (g.bottom <= innerHeight + 1 || card.scrollHeight > card.clientHeight)};
    });
    ok(box.sw <= box.vw + 1 && box.chips === 8 && box.goIn, `${name}: con ocho ayudas la tarjeta de inicio no se sale de la pantalla`, box);
    await B.screenshot({path: path.join(SHOTS, `color-inicio-${name}.png`)});
    await B.evaluate(() => { __t.setMode('esperar'); __t.start(); }); await sleep(150);
    const fg = await B.evaluate(() => [...document.querySelectorAll('#keys .key .fg')].map(b => { const k = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect(); return r.left >= k.left - 1 && r.right <= k.right + 1 && r.top >= k.top && r.bottom <= k.bottom; }));
    ok(fg.length === 5 && fg.every(Boolean), `${name}: los números caben dentro de sus teclas`, fg);
    await B.screenshot({path: path.join(SHOTS, `color-${name}.png`)});
    await B.context().close();
  }

  ok(errors.length === 0, 'sin errores de JavaScript', errors);
  console.log(`\n${pass} bien, ${failN} mal. Capturas en ${SHOTS}`);
  await browser.close(); server.close();
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
