// Pruebas sueltas de la app sin cuenta: pantalla encendida, pantalla completa e historial de progreso.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, SONGS, Data, settings, aids, openSong, start, step, press, release, pendingGroup, setMode, setSpeed,
    goLearn, goHome, goFree, goTheory, syncWake, get wake(){ return wake; }, Hist, histTick, goProgress, renderProgress, dayStr};\nNube.bind();`;
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
  async function open(viewport, dev, extra){
    const ctx = await browser.newContext({viewport});
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(([dev, extra]) => {
      if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify({device: dev}));
      // Reloj que la prueba puede adelantar, y un bloqueo de pantalla de mentira para contar pedidos y liberaciones.
      window.__skew = 0; const dn = Date.now.bind(Date); Date.now = () => dn() + window.__skew;
      window.__wl = {req: 0, rel: 0, held: 0};
      Object.defineProperty(navigator, 'wakeLock', {configurable: true, value: {request: async () => {
        window.__wl.req++; window.__wl.held++;
        const ls = []; let done = false;
        return {addEventListener: (t, f) => ls.push(f), release: async () => { if (done) return; done = true; window.__wl.rel++; window.__wl.held--; ls.forEach(f => f()); }};
      }}});
      if (extra && extra.fake){ let now = 1000; performance.now = () => now; window.__tick = ms => { now += ms; }; window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {}; }
    }, [dev, extra || null]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    return page;
  }

  console.log('1. Pantalla encendida');
  const A = await open({width: 1180, height: 760}, 'tab-h');
  await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 0, 'en el inicio la pantalla se puede apagar');
  await A.evaluate(() => { __t.goLearn(); }); await sleep(100);
  ok((await A.evaluate(() => __wl.held)) === 0, 'en las listas también');
  await A.evaluate(() => { __t.openSong('cinco-do'); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 1, 'al abrir un ejercicio se pide que la pantalla no se apague', await A.evaluate(() => __wl));
  await A.evaluate(() => { __t.goHome(); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 0, 'al volver al inicio se suelta');
  await A.evaluate(() => { __t.goFree(); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 1, 'tocando libre también se mantiene encendida');
  await A.evaluate(() => { window.__skew = 6 * 60 * 1000; return __t.syncWake(); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 0, 'tras más de cinco minutos sin tocar nada, se suelta');
  await A.evaluate(() => { __t.press(60, 'midi', 0.7); __t.release(60); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 1, 'al volver a tocar una tecla del teclado, se vuelve a pedir');
  await A.evaluate(() => { __t.goTheory(); }); await sleep(150);
  ok((await A.evaluate(() => __wl.held)) === 0, 'en la lista de teoría se suelta');
  const wl = await A.evaluate(() => __wl);
  ok(wl.req === wl.rel && wl.req === 3, 'cada pedido tiene su liberación', wl);
  await A.context().close();

  console.log('\n2. Historial de práctica');
  const B = await open({width: 1180, height: 760}, 'tab-h', {fake: true});
  const today = () => B.evaluate(() => __t.Hist.total(__t.dayStr(new Date())));
  ok((await B.textContent('#homeProg')) === 'Minutos de práctica, precisión y racha', 'la portada tiene la tarjeta «Tu progreso»');
  await B.click('#goProgress');
  ok(/Todavía no hay nada que mostrar/.test(await B.textContent('#progBody')), 'sin práctica, la pantalla lo dice y no dibuja gráficos vacíos');
  ok(await B.evaluate(() => !document.querySelector('#areaLbl').hidden && document.querySelector('#areaLbl').textContent === 'Tu progreso' && document.querySelector('.board').hidden), 'la cabecera dice «Tu progreso» y no hay teclado');
  await B.screenshot({path: path.join(SHOTS, 'progreso-vacio.png')});
  // El reloj
  await B.evaluate(() => { __t.goFree(); __t.histTick(); __t.press(60, 'midi', 0.7); __t.release(60); window.__skew += 5000; __t.histTick(); });
  ok((await today()).s === 5, 'tocando libre, cinco segundos cuentan como cinco', await today());
  await B.evaluate(() => { window.__skew += 70000; __t.histTick(); });
  ok((await today()).s === 5, 'más de un minuto sin tocar nada no cuenta');
  await B.evaluate(() => { __t.press(62, 'midi', 0.7); __t.release(62); window.__skew += 4000; __t.histTick(); });
  ok((await today()).s === 9, 'al volver a tocar, sigue contando', await today());
  await B.evaluate(() => { __t.goHome(); window.__skew += 5000; __t.histTick(); __t.goLearn(); window.__skew += 5000; __t.histTick(); });
  ok((await today()).s === 9, 'en el inicio y en las listas no se cuenta tiempo');
  // Piezas terminadas, precisión y estrellas
  const play = (id, o) => B.evaluate(([id, o]) => {
    const t = __t; t.goLearn(); t.openSong(id); t.setMode(o.mode || 'esperar'); t.start();
    const P = t.P; let guard = 0;
    while (!P.finished && guard++ < 200000){
      t.step(1 / 120); window.__tick(1000 / 120);
      if (P.finished) break;
      if (P.waiting) for (const n of t.pendingGroup()){ if (o.wrong && !n._w){ n._w = true; t.press(n.midi + 1, 'midi', 0.8); t.release(n.midi + 1); } t.press(n.midi, 'midi', 0.8); t.release(n.midi); }
    }
    return document.querySelector('#doneCard').textContent.replace(/\s+/g, ' ');
  }, [id, o || {}]);
  await play('cinco-do');
  let t1 = await today();
  ok(t1.n === 1 && t1.p === 100 && t1.e === 3, 'un ejercicio perfecto: una pieza, 100% y tres estrellas nuevas', t1);
  await play('cinco-do');
  t1 = await today();
  ok(t1.n === 2 && t1.p === 200 && t1.e === 3, 'repetirlo suma otra pieza, pero las estrellas no se cuentan dos veces', t1);
  await play('saltos', {wrong: true});
  t1 = await today();
  ok(t1.n === 3 && t1.p < 300 && t1.p > 200, 'una pieza con errores baja la precisión media', t1);
  await B.evaluate(() => { const t = __t; t.goLearn(); t.openSong('cinco-do'); t.setMode('escuchar'); t.start(); const P = t.P; let g = 0; while (!P.finished && g++ < 200000){ t.step(1 / 120); window.__tick(1000 / 120); } });
  ok((await today()).n === 3, 'escuchar una pieza no cuenta como tocarla');
  await B.evaluate(() => { const t = __t; t.goLearn(); t.openSong('cinco-do'); t.setMode('ritmo'); t.start(); const P = t.P; let g = 0; while (!P.finished && g++ < 200000){ t.step(1 / 120); window.__tick(1000 / 120); } });
  ok((await today()).n === 3, 'una pieza que pasa sola, sin tocar ninguna tecla, tampoco cuenta');
  let s0 = (await today()).s;
  await B.evaluate(() => { const t = __t; t.goFree(); t.histTick(); t.press(60, 'midi', 0.7); t.release(60); window.__skew += 3000; t.goHome(); });
  ok((await today()).s === s0 + 3, 'al salir de la práctica se cuenta el último tramo', [(await today()).s, s0]);
  // Una pieza sonando sin que nadie toque: cuenta mientras hubo actividad hace poco, no para siempre.
  s0 = (await today()).s;
  const idle = await B.evaluate(() => {
    const t = __t; t.goLearn(); t.openSong('cinco-do'); t.setMode('escuchar'); t.start(); t.histTick();
    window.__skew += 5000; t.histTick(); const a = t.Hist.total(t.dayStr(new Date())).s;
    window.__skew += 6 * 60 * 1000; t.histTick(); window.__skew += 5000; t.histTick();
    return [a, t.Hist.total(t.dayStr(new Date())).s];
  });
  ok(idle[0] === s0 + 5 && idle[1] === s0 + 5, 'una pieza que suena cuenta al principio, pero no si pasan minutos sin que nadie toque nada', [s0, idle]);
  const tabs = await B.evaluate(() => { const t = __t, d = t.dayStr(new Date()), before = t.Hist.total(d).s;
    window.dispatchEvent(new StorageEvent('storage', {key: 'piano:historial', newValue: JSON.stringify({[d]: {otrapest: {s: 600, n: 2, p: 180}}})}));
    return t.Hist.total(d).s - before; });
  ok(tabs === 600, 'lo que guarda otra pestaña del mismo navegador se incorpora en vez de pisarse', tabs);
  // La pantalla
  await B.evaluate(() => __t.goProgress());
  let txt = (await B.textContent('#progBody')).replace(/\s+/g, ' ');
  ok(/Hoy\s*10 min\s*5 piezas terminadas/.test(txt) && /Racha\s*1 día/.test(txt), 'las tarjetas muestran lo de hoy y la racha', txt.slice(0, 400));
  ok(await B.evaluate(() => document.querySelectorAll('#progBody .pg-chart svg').length === 2 && document.querySelectorAll('#progBody .pg-chart svg')[0].querySelectorAll('.pg-col').length === 14), 'hay dos gráficos de 14 días');
  ok(/^Hoy, /.test(await B.textContent('#progDet')) && /5 piezas terminadas · precisión media \d+% · 4 estrellas nuevas\./.test(await B.textContent('#progDet')), 'el detalle empieza en hoy', await B.textContent('#progDet'));
  await B.click('#progBody .pg-chart svg .pg-col[data-i="11"]');
  ok(/Sin práctica\./.test(await B.textContent('#progDet')) && await B.evaluate(() => document.querySelectorAll('#progBody .pg-col.sel').length === 2), 'al tocar otro día, el detalle y los dos gráficos cambian juntos', await B.textContent('#progDet'));
  await B.click('#progBody [data-span="semanas"]');
  ok(await B.evaluate(() => document.querySelectorAll('#progBody .pg-chart svg')[0].querySelectorAll('.pg-col').length === 12) && /^Esta semana: del /.test(await B.textContent('#progDet')), 'el botón «12 semanas» agrupa por semana', await B.textContent('#progDet'));
  ok(await B.evaluate(() => document.querySelectorAll('#progBody .pg-table tbody tr').length === 1), 'la tabla repite los datos del gráfico');
  ok(/Ejercicios\s*1 de 48/.test((await B.textContent('#progBody')).replace(/\s+/g, ' ')), 'abajo está lo que ya se aprobó', (await B.textContent('.pg-ruta')).replace(/\s+/g, ' '));
  // Datos de varias semanas y de dos dispositivos, como los deja la cuenta
  await B.evaluate(() => {
    const t = __t, d = new Date(), H = {}; d.setHours(12, 0, 0, 0);
    const mins = [22, 0, 31, 18, 25, 12, 40, 0, 0, 15, 28, 9, 35, 20, 0, 26, 14, 30, 0, 19, 24, 33, 0, 12, 27, 16, 0, 21];
    mins.forEach((m, i) => {
      const x = new Date(d); x.setDate(x.getDate() - i);
      if (!m) return;
      const n = Math.max(1, Math.round(m / 3)), pct = 92 - i * 0.9;
      H[t.dayStr(x)] = {[t.Hist.dev]: {s: m * 40, n, p: Math.round(n * pct), e: i % 3}, otro0001: {s: m * 20, n: 1, p: Math.round(pct), e: 1}};
    });
    H.basura = {x: 1}; H['2026-01-01'] = {'no vale': {s: 5}, okokok12: {s: -4, n: 'x', zz: 9}};
    localStorage.setItem('piano:historial', JSON.stringify(H));
  });
  await B.reload(); await B.waitForFunction(() => window.__t);
  const st = await B.evaluate(() => ({days: __t.Hist.days().length, streak: __t.Hist.streak(), today: __t.Hist.total(__t.dayStr(new Date())), raw: JSON.stringify(__t.Hist.raw())}));
  ok(st.days === 21 && !/basura|no vale|okokok12|zz/.test(st.raw), 'al abrir, los datos dañados se descartan', st.days);
  ok(st.streak === 1 && st.today.s === 22 * 60, 'se suman los dispositivos y la racha se corta en el día sin práctica', st);
  ok(/Hoy: 22 min\. Últimos 7 días: 2 h 28 min\./.test(await B.textContent('#homeProg')), 'la portada resume hoy y la semana', await B.textContent('#homeProg'));
  await B.click('#goProgress');
  txt = (await B.textContent('#progBody')).replace(/\s+/g, ' ');
  ok(/Practicaste 6 de 7 días/.test(txt) && /puntos más que los 7 días anteriores/.test(txt), 'compara la precisión con la semana anterior', txt.slice(0, 500));
  ok(await B.evaluate(() => { const s = document.querySelector('#progBody .list-inner'); return s.scrollWidth <= s.clientWidth + 1 && [...document.querySelectorAll('#progBody .pg-chart svg')].every(v => v.getBoundingClientRect().width <= s.clientWidth); }), 'los gráficos caben en la pantalla');
  await B.screenshot({path: path.join(SHOTS, 'progreso-tablet.png')});
  await B.evaluate(() => { document.querySelector('#progBody').scrollTop = 600; });
  await B.screenshot({path: path.join(SHOTS, 'progreso-tablet-2.png')});
  await B.click('#progBody [data-span="semanas"]');
  await B.evaluate(() => { document.querySelector('#progBody').scrollTop = 0; });
  await B.screenshot({path: path.join(SHOTS, 'progreso-semanas.png')});
  ok(await B.evaluate(() => { const a = __t.Hist.merge({'2026-10-01': {aaaaaa11: {s: 50, n: 2, p: 150}}}, {'2026-10-01': {aaaaaa11: {s: 80, n: 1, p: 90}, bbbbbb22: {s: 10}}});
    return JSON.stringify(a) === JSON.stringify({'2026-10-01': {aaaaaa11: {s: 80, n: 2, p: 150}, bbbbbb22: {s: 10}}}); }), 'al juntar dos copias queda el número más alto de cada casilla');
  const hist = await B.evaluate(() => localStorage.getItem('piano:historial'));
  await B.context().close();
  for (const [name, vp, dev, theme] of [['celular', {width: 390, height: 800}, 'cel-v', 'auto'], ['celular-oscuro', {width: 390, height: 800}, 'cel-v', 'dark'], ['celular-angosto', {width: 360, height: 740}, 'cel-v', 'auto'], ['celular-mini', {width: 320, height: 640}, 'cel-v', 'auto'], ['celular-horizontal', {width: 740, height: 360}, 'cel-h', 'auto'], ['pc-oscuro', {width: 1366, height: 768}, 'pc', 'dark']]){
    const C = await open(vp, dev);
    await C.evaluate(([h, dev, theme]) => { localStorage.setItem('piano:historial', h); localStorage.setItem('piano:ajustes', JSON.stringify({device: dev, theme})); }, [hist, dev, theme]);
    await C.reload(); await C.waitForFunction(() => window.__t);
    await C.screenshot({path: path.join(SHOTS, `inicio-${name}.png`)});
    await C.evaluate(() => __t.goProgress());
    ok(await C.evaluate(() => { const s = document.querySelector('#progBody'); return s.scrollWidth <= s.clientWidth + 1; }), `en ${name} nada se sale de la pantalla`);
    await C.screenshot({path: path.join(SHOTS, `progreso-${name}.png`)});
    await C.evaluate(() => { document.querySelector('#progBody').scrollTop = 520; });
    await C.screenshot({path: path.join(SHOTS, `progreso-${name}-2.png`)});
    // En cada período: las etiquetas del eje no se pisan, el dibujo se hizo al ancho real y la tabla cabe.
    for (const span of ['dias', 'semanas']){
      await C.click(`#progBody [data-span="${span}"]`);
      const lay = await C.evaluate(() => {
        const body = document.querySelector('#progBody'), svg = body.querySelector('.pg-chart svg');
        const xs = [...svg.querySelectorAll('.pg-x')].map(t => t.getBoundingClientRect()); let clash = 0;
        for (let i = 1; i < xs.length; i++) if (xs[i].left < xs[i - 1].right + 1) clash++;
        const card = body.querySelector('.pg-table').closest('.pg-card').getBoundingClientRect(), tb = body.querySelector('.pg-table').getBoundingClientRect();
        return {clash, scroll: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, ratio: svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, table: tb.right <= card.right - 8};
      });
      ok(lay.clash === 0 && lay.scroll <= 0 && lay.doc <= 0 && Math.abs(lay.ratio - 1) < 0.03 && lay.table, `en ${name}, por ${span === 'dias' ? 'días' : 'semanas'}: etiquetas sin pisarse, sin desplazamiento lateral y tabla dentro de su tarjeta`, lay);
    }
    if (name === 'celular-angosto') await C.screenshot({path: path.join(SHOTS, 'progreso-angosto-semanas.png')});
    await C.context().close();
  }

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
