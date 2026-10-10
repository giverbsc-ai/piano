// «Teclas del computador»: el alumno elige la letra o el número que toca cada tecla del piano.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, settings, teclas, down, codeToMidi, hintFor, goFree, goLearn, goHome, openSong, start, pendingGroup, setMode,
    get range(){ return range; }, get kbBase(){ return kbBase; }, get sel(){ return Kbd.sel; }};\nNube.bind();`;
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
  const teclas = page => page.evaluate(() => JSON.parse(JSON.stringify(__t.teclas)));
  const downs = page => page.evaluate(() => [...__t.down.keys()]);
  // Letra que se ve sobre una tecla del piano en pantalla y si es de las elegidas por el alumno.
  const hint = (page, m, box = '#keys') => page.evaluate(([m, box]) => {
    const k = document.querySelector(`${box} .key[data-m="${m}"] .kb`);
    return k ? [k.textContent, k.classList.contains('mine'), getComputedStyle(k).display !== 'none'] : null;
  }, [m, box]);
  // Aprieta una tecla del computador, mira qué notas suenan y la suelta.
  async function tocar(page, code){
    await page.keyboard.down(code); const d = await downs(page); await page.keyboard.up(code);
    return d;
  }
  // El teclado numérico con Bloq Num activado (Playwright lo envía sin Bloq Num, como Fin, Inicio…).
  const numpad = (page, n, type = 'keydown') => page.evaluate(([n, type]) => {
    (document.querySelector('dialog[open]') || window).dispatchEvent(new KeyboardEvent(type, {key: String(n), code: 'Numpad' + n, bubbles: true, cancelable: true}));
  }, [n, type]);
  const abrirEditor = async page => { await page.click('#btnSettings'); await page.click('#btnKbd'); await sleep(80); };

  console.log('1. Sin elegir nada, todo sigue como antes');
  const A = await open({viewport: {width: 1366, height: 768}}, {device: 'pc'});
  await A.evaluate(() => __t.goFree()); await sleep(100);
  ok(/fila Z X C V/.test(await txt(A, '#subName')) && /elegir otras letras/.test(await txt(A, '#subName')), 'Tocar libre avisa que se pueden elegir otras letras', await txt(A, '#subName'));
  const base = await A.evaluate(() => __t.kbBase), r0 = await A.evaluate(() => __t.range);
  ok(base === 36 && r0.lo === 36, 'en el computador Tocar libre empieza en Do2', [base, r0]);
  ok(JSON.stringify(await tocar(A, 'KeyZ')) === '[36]' && JSON.stringify(await tocar(A, 'KeyS')) === '[37]' && JSON.stringify(await tocar(A, 'KeyQ')) === '[48]', 'Z, S y Q tocan lo de siempre');
  ok(JSON.stringify(await hint(A, 36)) === '["Z",false,true]' && JSON.stringify(await hint(A, 47)) === '["M",false,true]', 'las letras de fábrica se ven en gris sobre cada tecla', [await hint(A, 36), await hint(A, 47)]);
  await A.click('#btnSettings');
  ok(await A.isVisible('#kbdField') && /letras de fábrica/.test(await txt(A, '#kbdState')), 'Ajustes tiene «Teclas del computador» y dice que se usan las de fábrica', await txt(A, '#kbdState'));
  await A.screenshot({path: path.join(SHOTS, 'teclas-ajustes.png')});

  console.log('\n2. El editor');
  await A.click('#btnKbd'); await sleep(80);
  ok(await A.isVisible('#kbdDlg') && await A.isHidden('#dlg'), 'se abre el editor y se cierra Ajustes');
  ok((await A.locator('#kbdKeys .key').count()) === 61 && (await A.locator('#kbdKeys .key.white').count()) === 36, 'muestra las 61 teclas, de Do2 a Do7');
  ok((await A.evaluate(() => __t.sel)) === 60 && /^Do4, el Do central$/.test(await txt(A, '#kbdNote')) && (await txt(A, '#kbdCap')) === 'sin letra propia', 'empieza en el Do central, sin letra propia', [await txt(A, '#kbdNote'), await txt(A, '#kbdCap')]);
  ok(await A.isDisabled('#kbdDel') && await A.isDisabled('#kbdReset'), 'sin letras elegidas no hay nada que quitar');
  const fits = await A.evaluate(() => { const s = document.querySelector('#kbdScroll'); return [s.scrollWidth, s.clientWidth]; });
  ok(fits[0] <= fits[1] + 1, 'en un computador el piano del editor cabe entero, sin desplazar', fits);

  await A.keyboard.press('a');
  let t = await teclas(A);
  ok(JSON.stringify(t) === '{"60":["KeyA","A"]}', 'al presionar A, el Do central queda con la A', t);
  ok((await A.evaluate(() => __t.sel)) === 61 && /Listo: Do4 se toca con A\. Ahora presiona la de Do♯4/.test(await txt(A, '#kbdMsg')), 'pasa sola a la tecla siguiente y lo dice', await txt(A, '#kbdMsg'));
  ok(JSON.stringify(await hint(A, 60, '#kbdKeys')) === '["A",true,true]', 'la letra se ve sobre la tecla en el editor');
  await A.click('#kbdStep [data-v="blancas"]');
  await A.locator('#kbdKeys .key[data-m="62"]').dispatchEvent('pointerdown');
  ok((await A.evaluate(() => __t.sel)) === 62 && (await txt(A, '#kbdNote')) === 'Re4', 'al tocar una tecla del piano queda elegida', await txt(A, '#kbdNote'));
  for (const k of ['s', 'd', 'f', 'g']) await A.keyboard.press(k);
  t = await teclas(A);
  ok(JSON.stringify(t) === '{"60":["KeyA","A"],"62":["KeyS","S"],"64":["KeyD","D"],"65":["KeyF","F"],"67":["KeyG","G"]}', 'con «La blanca siguiente» S D F G quedan en Re Mi Fa Sol', t);
  ok((await A.evaluate(() => __t.sel)) === 69, 'y queda lista en La4');
  await A.keyboard.press('7');
  await A.keyboard.press('Numpad1');
  ok(!(await teclas(A))[71] && (await A.evaluate(() => __t.sel)) === 71, 'el teclado numérico sin Bloq Num (Fin, Inicio…) no asigna nada');
  await numpad(A, 1);
  await A.keyboard.press('Period');
  t = await teclas(A);
  ok(JSON.stringify([t[69], t[71], t[72]]) === '[["Digit7","7"],["Numpad1","N1"],["Period","."]]', 'sirven números, el teclado numérico y signos', [t[69], t[71], t[72]]);

  console.log('\n3. Teclas que no sirven y cambios');
  const antes = JSON.stringify(await teclas(A)), selAntes = await A.evaluate(() => __t.sel);
  await A.keyboard.press('F2'); await A.keyboard.press('Shift'); await A.keyboard.press('Home');
  ok(JSON.stringify(await teclas(A)) === antes && (await A.evaluate(() => __t.sel)) === selAntes, 'F2, Mayús o Inicio no asignan nada');
  await A.keyboard.press('Shift+Comma');
  ok(JSON.stringify(await teclas(A)) === antes && /Suelta la tecla de mayúsculas/.test(await txt(A, '#kbdMsg')) && await A.evaluate(() => document.querySelector('#kbdMsg').classList.contains('warn')), 'con Mayús y un signo avisa y no asigna', await txt(A, '#kbdMsg'));
  await A.keyboard.press('Control+a');
  ok(JSON.stringify(await teclas(A)) === antes, 'Ctrl + letra no asigna');
  await A.keyboard.press('Shift+h');
  ok(JSON.stringify((await teclas(A))[selAntes]) === '["KeyH","H"]', 'Mayús + letra sí vale: es la misma tecla', (await teclas(A))[selAntes]);
  // La A pasa del Do central a otra tecla.
  await A.locator('#kbdKeys .key[data-m="48"]').dispatchEvent('pointerdown');
  await A.keyboard.press('a');
  t = await teclas(A);
  ok(!t[60] && JSON.stringify(t[48]) === '["KeyA","A"]' && /La tecla A antes tocaba Do4; ahora toca Do3/.test(await txt(A, '#kbdMsg')), 'una letra repetida se muda a la tecla nueva y lo avisa', await txt(A, '#kbdMsg'));
  await A.keyboard.press('ArrowLeft'); await A.keyboard.press('ArrowLeft');
  ok((await A.evaluate(() => __t.sel)) === 48, 'con las flechas se cambia de tecla del piano', await A.evaluate(() => __t.sel));
  ok(await A.isEnabled('#kbdDel') && (await txt(A, '#kbdDel')) === 'Quitar la letra de Do3', 'el botón de quitar nombra la tecla', await txt(A, '#kbdDel'));
  await A.keyboard.press('Backspace');
  t = await teclas(A);
  ok(!t[48] && /Do3 quedó sin letra propia/.test(await txt(A, '#kbdMsg')), 'Retroceso quita la letra de la tecla elegida', await txt(A, '#kbdMsg'));
  await A.locator('#kbdKeys .key[data-m="60"]').dispatchEvent('pointerdown');
  await A.keyboard.press('a');
  await A.evaluate(() => getSelection().removeAllRanges());
  await A.screenshot({path: path.join(SHOTS, 'teclas-editor.png')});

  console.log('\n4. Al tocar');
  await A.click('#kbdDone'); await sleep(80);
  ok(await A.isHidden('#kbdDlg'), '«Listo» cierra el editor');
  ok(JSON.stringify(await tocar(A, 'KeyA')) === '[60]' && JSON.stringify(await tocar(A, 'KeyS')) === '[62]' && JSON.stringify(await tocar(A, 'Digit7')) === '[69]',
    'A, S y 7 tocan las teclas elegidas');
  await numpad(A, 1); const dn = await downs(A); await numpad(A, 1, 'keyup');
  ok(JSON.stringify(dn) === '[71]' && (await downs(A)).length === 0, 'el 1 del teclado numérico toca y suelta su tecla', dn);
  ok(JSON.stringify(await hint(A, 60)) === '["A",true,true]' && JSON.stringify(await hint(A, 71)) === '["N1",true,true]', 'el piano muestra las letras elegidas, resaltadas', [await hint(A, 60), await hint(A, 71)]);
  // De fábrica (Do2 a la izquierda): S era Do♯2, D era Re♯2 y el 7 era La♯3. Ahora están ocupadas.
  ok(JSON.stringify(await hint(A, 37)) === '["",false,true]' && JSON.stringify(await hint(A, 39)) === '["",false,true]', 'las teclas del piano que usaban esas letras de fábrica ya no las muestran', [await hint(A, 37), await hint(A, 39)]);
  ok(JSON.stringify(await hint(A, 58)) === '["",false,true]', 'ni el 7 de fábrica', await hint(A, 58));
  ok(JSON.stringify(await tocar(A, 'KeyZ')) === '[36]' && JSON.stringify(await hint(A, 36)) === '["Z",false,true]', 'las demás siguen con su letra de fábrica');
  // Do3 a Mi3 tienen dos letras de fábrica (M , . Ñ - abajo y Q 2 W 3 E arriba): si la de abajo está ocupada, queda la de arriba.
  ok(JSON.stringify(await hint(A, 50)) === '["W",false,true]' && JSON.stringify(await tocar(A, 'KeyW')) === '[50]' && JSON.stringify(await tocar(A, 'Period')) === '[72]', 'si la letra de fábrica de abajo está ocupada, vale la de arriba', await hint(A, 50));
  await A.click('#octUp'); await sleep(60);
  ok((await A.evaluate(() => __t.kbBase)) === 48 && JSON.stringify(await tocar(A, 'KeyA')) === '[60]' && JSON.stringify(await hint(A, 60)) === '["A",true,true]', 'al subir una octava, la A sigue en el Do central');
  ok(JSON.stringify(await tocar(A, 'KeyZ')) === '[48]' && JSON.stringify(await tocar(A, 'KeyQ')) === '[]', 'las de fábrica se mueven con el piano, y Q (que caería en el Do central) no toca nada', [await tocar(A, 'KeyQ')]);
  await A.screenshot({path: path.join(SHOTS, 'teclas-libre.png')});
  // Varias a la vez, como un acorde.
  await A.keyboard.down('KeyA'); await A.keyboard.down('KeyD'); await A.keyboard.down('KeyG');
  ok(JSON.stringify((await downs(A)).sort()) === '[60,64,67]' && /Do mayor/.test(await txt(A, '#bigName')), 'tres letras a la vez tocan el acorde', await txt(A, '#bigName'));
  await A.keyboard.up('KeyA'); await A.keyboard.up('KeyD'); await A.keyboard.up('KeyG');
  ok((await downs(A)).length === 0, 'al soltar no queda ninguna nota pegada');

  console.log('\n5. En un ejercicio');
  await A.evaluate(() => { __t.openSong('cinco-do'); }); await sleep(200);
  await A.evaluate(() => { __t.setMode('esperar'); __t.start(); }); await sleep(100);
  ok(JSON.stringify(await hint(A, 60)) === '["A",true,true]', 'el piano del ejercicio muestra la A en el Do central', await hint(A, 60));
  const code = {60: 'KeyA', 62: 'KeyS', 64: 'KeyD', 65: 'KeyF', 67: 'KeyG'};
  let tocadas = 0, falta = null;
  for (let i = 0; i < 80; i++){
    const g = await A.evaluate(() => { const g = __t.pendingGroup(); return g ? g.map(n => n.midi) : null; });
    if (!g || !g.length) break;
    if (g.some(m => !code[m])){ falta = g; break; }
    for (const m of g) await A.keyboard.down(code[m]);
    await sleep(30);
    for (const m of g) await A.keyboard.up(code[m]);
    tocadas++; await sleep(30);
  }
  const fin = await A.evaluate(() => ({hits: __t.P.hits, errors: __t.P.errors, total: __t.P.notes.length}));
  ok(!falta && tocadas > 5 && fin.errors === 0, 'el ejercicio se toca entero con las letras elegidas, sin errores', {tocadas, falta, fin});
  await A.screenshot({path: path.join(SHOTS, 'teclas-ejercicio.png')});

  console.log('\n6. Se guarda en este computador');
  const guardado = await A.evaluate(() => JSON.parse(localStorage.getItem('piano:ajustes')));
  ok(guardado.teclas && JSON.stringify(guardado.teclas[60]) === '["KeyA","A"]' && guardado.teclasPaso === 'blancas', 'queda en los ajustes del navegador', guardado.teclas);
  await A.reload(); await A.waitForFunction(() => window.__t);
  await A.evaluate(() => __t.goFree()); await sleep(100);
  ok(/cada tecla del piano muestra la letra/.test(await txt(A, '#subName')), 'el texto de Tocar libre dice dónde cambiarlas', await txt(A, '#subName'));
  ok(JSON.stringify(await tocar(A, 'KeyA')) === '[60]' && JSON.stringify(await hint(A, 60)) === '["A",true,true]', 'al recargar la página siguen las letras');
  await A.click('#btnSettings');
  ok(/Elegiste la letra de 9 teclas del piano/.test(await txt(A, '#kbdState')), 'Ajustes cuenta las teclas elegidas', await txt(A, '#kbdState'));
  await A.click('#btnKbd'); await sleep(80);
  ok((await A.getAttribute('#kbdStep [data-v="blancas"]', 'aria-pressed')) === 'true', 'recuerda «La blanca siguiente»');
  await A.click('#kbdReset');
  ok((await txt(A, '#kbdReset')) === 'Sí, quitar todas mis letras' && Object.keys(await teclas(A)).length === 9, 'volver a las de fábrica pide confirmar', await txt(A, '#kbdReset'));
  await A.click('#kbdReset');
  ok(Object.keys(await teclas(A)).length === 0 && /volvieron a las letras de fábrica/.test(await txt(A, '#kbdMsg')) && await A.isDisabled('#kbdReset'), 'el segundo toque las quita todas', await txt(A, '#kbdMsg'));
  await A.keyboard.press('Escape'); await sleep(80);
  ok(await A.isHidden('#kbdDlg') && JSON.stringify(await tocar(A, 'KeyA')) === '[]' && JSON.stringify(await tocar(A, 'KeyS')) === '[37]' && JSON.stringify(await hint(A, 37)) === '["S",false,true]', 'y todo vuelve a las letras de fábrica', [await tocar(A, 'KeyA'), await hint(A, 37)]);
  ok(!('60' in (await A.evaluate(() => JSON.parse(localStorage.getItem('piano:ajustes')).teclas))), 'también en lo guardado');

  console.log('\n7. Datos guardados raros y otros dispositivos');
  const B = await open({viewport: {width: 1366, height: 768}}, {device: 'pc', teclas: {60: ['KeyA', 'A'], 62: ['KeyA', 'B'], 200: ['KeyK', 'K'], 64: 'x', abc: ['KeyL', 'L'], 65: ['', 'F'], 67: ['KeyG', 'GGGGGG']}});
  t = await teclas(B);
  ok(JSON.stringify(t) === '{"60":["KeyA","A"],"67":["KeyG","GGG"]}', 'lo guardado que no tiene sentido se ignora', t);
  const C = await open({viewport: {width: 1180, height: 760}, hasTouch: true, isMobile: true}, {device: 'tab-h'});
  await C.evaluate(() => __t.goFree()); await sleep(100);
  await C.click('#btnSettings');
  ok(await C.isHidden('#kbdField') && (await hint(C, 60)) === null, 'en la tablet no aparece «Teclas del computador» ni letras sobre las teclas');
  const D = await open({viewport: {width: 820, height: 600}, colorScheme: 'dark'}, {device: 'pc', teclas: {60: ['KeyA', 'A'], 61: ['KeyW', 'W'], 62: ['KeyS', 'S']}});
  await D.evaluate(() => __t.goFree()); await sleep(100);
  await abrirEditor(D);
  const sc = await D.evaluate(() => { const s = document.querySelector('#kbdScroll'), k = document.querySelector('#kbdKeys .key.sel').getBoundingClientRect(), b = s.getBoundingClientRect(); return [s.scrollWidth > s.clientWidth, k.left >= b.left && k.right <= b.right, document.documentElement.scrollWidth <= window.innerWidth, Math.round(document.querySelector('#kbdKeys').getBoundingClientRect().height)]; });
  ok(sc[0] && sc[1] && sc[2] && sc[3] >= 110, 'en una ventana angosta el piano del editor se desplaza, no se aplasta y la tecla elegida queda a la vista', sc);
  await D.screenshot({path: path.join(SHOTS, 'teclas-editor-oscuro.png')});

  ok(errors.length === 0, 'sin errores de JavaScript', errors);
  console.log(`\n${pass} bien, ${failN} mal. Capturas en ${SHOTS}`);
  await browser.close(); server.close();
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
