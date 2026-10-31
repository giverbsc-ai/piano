// «Números y colores» en Tocar libre: el adulto pone números en las teclas y divide el piano en dos colores, uno por mano.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get view(){ return view; }, get range(){ return range; }, settings, NC, Mk, goFree, goLearn, goHome, openSong, LESSONS};\nNube.bind();`;
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
  async function open(ctxOpts, ajustes, ctx){
    ctx = ctx || await browser.newContext(ctxOpts);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.addInitScript(a => { if (!localStorage.getItem('piano:ajustes')) localStorage.setItem('piano:ajustes', JSON.stringify(a)); }, ajustes);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__t);
    await page.evaluate(() => __t.goFree()); await sleep(120);
    return page;
  }
  const txt = (page, sel) => page.evaluate(sel => document.querySelector(sel).textContent.replace(/\s+/g, ' ').trim(), sel);
  const key = (page, m) => page.evaluate(m => {
    const el = document.querySelector(`#keys .key[data-m="${m}"]`); if (!el) return null;
    const n = el.querySelector('.mn');
    return {num: n ? n.textContent : '', numVis: !!n && getComputedStyle(n).display !== 'none', side: el.classList.contains('ml') ? 'L' : el.classList.contains('mr') ? 'R' : '',
      bg: getComputedStyle(el).backgroundImage};
  }, m);
  const shown = page => page.evaluate(() => document.querySelector('#keys').classList.contains('ncol'));
  const tap = async (page, m) => { await page.locator(`#keys .key[data-m="${m}"]`).click(); await sleep(40); };
  const nums = page => page.evaluate(() => JSON.parse(JSON.stringify(__t.NC.nums)));

  console.log('1. Sin activar nada, Tocar libre sigue como antes');
  const T = await open({viewport: {width: 1280, height: 800}}, {device: 'tab-h'});
  ok(await T.isVisible('#btnNcol') && await T.isHidden('#ncPanel'), 'está el botón «Números y colores» y el panel está cerrado');
  ok(!(await shown(T)) && await T.isHidden('#ncLegend'), 'el piano no tiene números ni colores');
  const plain = await key(T, 60);
  ok(plain && !plain.numVis && !/198, 214, 246|243, 198, 205/.test(plain.bg), 'las teclas se ven blancas como siempre', plain);

  console.log('\n2. Poner números');
  await T.click('#btnNcol'); await sleep(60);
  ok(await T.isVisible('#ncPanel') && (await T.getAttribute('#btnNcol', 'aria-pressed')) === 'true', 'se abre el panel');
  ok((await T.getAttribute('#ncMode [data-v="num"]', 'aria-pressed')) === 'true' && (await txt(T, '#ncCur')) === '1', 'empieza en «Poner números» con el 1');
  ok(/Toca una tecla para ponerle el 1/.test(await txt(T, '#ncStatus')), 'dice qué hacer', await txt(T, '#ncStatus'));
  await tap(T, 60);
  ok(JSON.stringify(await nums(T)) === '{"60":1}' && (await txt(T, '#ncCur')) === '2', 'el Do central queda con el 1 y pasa solo al 2', await nums(T));
  ok(/Do4 tiene el 1\. Ahora toca la tecla del 2/.test(await txt(T, '#ncStatus')), 'lo confirma', await txt(T, '#ncStatus'));
  ok(await shown(T), 'al poner el primer número se activa la vista');
  let k = await key(T, 60);
  ok(k.num === '1' && k.numVis && k.side === 'R' && /243, 198, 205/.test(k.bg), 'la tecla muestra el 1 y el color de la mano derecha', k);
  k = await key(T, 59);
  ok(k.side === 'L' && /198, 214, 246/.test(k.bg) && !k.numVis, 'Si3 queda del color de la mano izquierda, sin número', k);
  await tap(T, 62); await tap(T, 64); await tap(T, 61);
  ok(JSON.stringify(await nums(T)) === '{"60":1,"61":4,"62":2,"64":3}', 'se pueden numerar varias, también una negra', await nums(T));
  k = await key(T, 61);
  ok(k.num === '4' && k.numVis && /90, 24, 37/.test(k.bg), 'la tecla negra muestra su número y un rojo oscuro', k);
  await T.click('#ncMinus'); await T.click('#ncMinus'); await T.click('#ncMinus'); await T.click('#ncMinus');
  ok((await txt(T, '#ncCur')) === '1' && await T.isDisabled('#ncMinus'), 'con «−» se baja el número, hasta el 1');
  await tap(T, 48);
  ok((await nums(T))[48] === 1, 'el mismo número puede ir en otra tecla (por ejemplo, el 1 de cada mano)', await nums(T));
  await T.click('#ncPlus'); await T.click('#ncPlus');
  await tap(T, 60);
  ok((await nums(T))[60] === 4, 'tocar una tecla con número lo cambia por el número elegido', await nums(T));

  console.log('\n3. Dividir manos');
  await T.click('#ncMode [data-v="div"]');
  ok(await T.isHidden('#ncNum') && /la izquierda llega hasta Si3 y la derecha empieza en Do4/.test(await txt(T, '#ncStatus')), 'por defecto la derecha empieza en el Do central', await txt(T, '#ncStatus'));
  await tap(T, 55);
  ok((await T.evaluate(() => __t.NC.div)) === 55 && (await key(T, 55)).side === 'R' && (await key(T, 54)).side === 'L', 'tocar Sol3 lo vuelve la primera tecla de la derecha');
  ok(/llega hasta Fa♯3 y la derecha empieza en Sol3/.test(await txt(T, '#ncStatus')), 'lo dice con los nombres de las teclas', await txt(T, '#ncStatus'));
  ok(JSON.stringify(await nums(T)) === '{"48":1,"60":4,"61":4,"62":2,"64":3}', 'mover la división no cambia los números');

  console.log('\n4. Quitar números');
  await T.click('#ncMode [data-v="del"]');
  await tap(T, 61);
  ok(!(61 in await nums(T)) && !(await key(T, 61)).numVis && /Quitaste el 4 de Do♯4/.test(await txt(T, '#ncStatus')), 'tocar la tecla le quita el número', await txt(T, '#ncStatus'));
  await tap(T, 63);
  ok(/Re♯4 no tenía número/.test(await txt(T, '#ncStatus')), 'una tecla sin número lo avisa', await txt(T, '#ncStatus'));

  console.log('\n5. Activar y desactivar');
  await T.click('#ncShow [data-v="0"]');
  ok(!(await shown(T)) && Object.keys(await nums(T)).length === 4, '«No» oculta números y colores sin borrarlos');
  ok(/Están ocultos/.test(await txt(T, '#ncStatus')), 'el panel avisa que están ocultos');
  await T.click('#ncShow [data-v="1"]');
  ok(await shown(T) && (await key(T, 62)).numVis, '«Sí» los vuelve a mostrar');
  await T.click('#ncDone'); await sleep(40);
  ok(await T.isHidden('#ncPanel') && await shown(T) && await T.isVisible('#ncLegend'), 'con «Listo» se cierra el panel; quedan los números, los colores y la leyenda');
  const before = JSON.stringify(await nums(T));
  await tap(T, 65);
  ok(JSON.stringify(await nums(T)) === before && /Fa/.test(await txt(T, '#bigName')), 'con el panel cerrado tocar una tecla solo suena', await txt(T, '#bigName'));
  await T.screenshot({path: path.join(SHOTS, 'numeros-tablet.png')});

  console.log('\n6. Solo en Tocar libre');
  const L = await T.evaluate(() => __t.LESSONS[0].key);
  await T.evaluate(L => { __t.goLearn(); __t.openSong(L); }, L); await sleep(150);
  ok(await T.evaluate(() => __t.view) === 'player' && !(await shown(T)), 'en un ejercicio no aparecen números ni colores');
  ok(await T.evaluate(() => !document.querySelector('#keys .key.ml .mn') || getComputedStyle(document.querySelector('#keys .mn')).display === 'none'), 'ni siquiera ocultos a medias');
  await T.evaluate(() => __t.goFree()); await sleep(120);
  ok(await shown(T) && (await key(T, 62)).num === '2', 'al volver a Tocar libre están otra vez');

  console.log('\n7. Las flechas de octava y el guardado');
  await T.click('#octUp'); await sleep(60);
  const r = await T.evaluate(() => __t.range);
  ok((await key(T, 62)) ? (await key(T, 62)).num === '2' : true, 'al mover la octava cada número sigue en su nota', r);
  await T.click('#octDown'); await sleep(60);
  const T2 = await open(null, {}, T.context());
  ok(await shown(T2) && (await key(T2, 62)).num === '2' && (await key(T2, 54)).side === 'L' && (await key(T2, 55)).side === 'R', 'al recargar todo sigue igual');
  await T2.click('#btnNcol'); await sleep(40);
  ok((await txt(T2, '#ncCur')) === '5', 'el número siguiente sigue al más alto que hay', await txt(T2, '#ncCur'));

  console.log('\n8. Con «Crear canción»');
  await T2.click('#btnMaker'); await sleep(40);
  ok(await T2.isHidden('#ncPanel') && await T2.isVisible('#maker'), 'abrir «Crear canción» cierra este panel');
  await T2.click('#btnNcol'); await sleep(40);
  ok(await T2.isVisible('#ncPanel') && await T2.isHidden('#maker'), 'y al revés');

  console.log('\n9. Borrar todo');
  await T2.click('#ncClear');
  ok(/¿Borrar los 4 números\?/.test(await txt(T2, '#ncClear')) && Object.keys(await nums(T2)).length === 4, 'el primer toque pregunta');
  await T2.click('#ncClear');
  ok(Object.keys(await nums(T2)).length === 0 && (await txt(T2, '#ncCur')) === '1' && await T2.isDisabled('#ncClear'), 'el segundo borra y el número vuelve al 1');
  ok(await shown(T2) && (await key(T2, 54)).side === 'L', 'los colores de cada mano se quedan');
  await T2.context().close();

  console.log('\n10. Celular y computador');
  const C = await open({viewport: {width: 412, height: 860}, hasTouch: true, isMobile: true}, {device: 'cel-v'});
  await C.click('#btnNcol'); await sleep(60);
  await tap(C, 60);
  const fit = await C.evaluate(() => { const p = document.querySelector('#ncPanel'), b = document.querySelector('.board').getBoundingClientRect(); return [document.documentElement.scrollWidth <= innerWidth + 1, p.getBoundingClientRect().bottom <= b.top + 1]; });
  ok(fit[0] && fit[1], 'en un celular vertical el panel cabe sin tapar el piano', fit);
  ok((await key(C, 60)).numVis, 'y el número se ve en la tecla');
  await C.screenshot({path: path.join(SHOTS, 'numeros-celular.png')});
  const H = await open({viewport: {width: 860, height: 412}, hasTouch: true, isMobile: true}, {device: 'cel-h'});
  await H.click('#btnNcol'); await sleep(60);
  const fitH = await H.evaluate(() => { const b = document.querySelector('.board').getBoundingClientRect(); return [document.documentElement.scrollWidth <= innerWidth + 1, b.height > 120]; });
  ok(fitH[0] && fitH[1], 'en un celular acostado el piano sigue con alto suficiente', fitH);
  await H.screenshot({path: path.join(SHOTS, 'numeros-celular-h.png')});
  const P = await open({viewport: {width: 1366, height: 768}}, {device: 'pc'});
  await P.click('#btnNcol'); await sleep(40);
  await P.keyboard.down('KeyZ'); await P.keyboard.up('KeyZ'); await sleep(40);
  ok((await nums(P))[36] === 1, 'en el computador también se numera con las letras del teclado', await nums(P));

  ok(!errors.length, 'sin errores en la página', errors);
  console.log(`\n${pass} ok, ${failN} fallan. Capturas en ${SHOTS}`);
  await browser.close(); server.close();
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
