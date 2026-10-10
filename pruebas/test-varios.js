// Pruebas sueltas de la app sin cuenta: pantalla encendida, pantalla completa e historial de progreso.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
const SHOTS = path.join(require('os').tmpdir(), 'piano-pruebas'); fs.mkdirSync(SHOTS, {recursive: true});
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  const hook = `window.__t = {get P(){ return P; }, get view(){ return view; }, LESSONS, SONGS, Data, settings, aids, openSong, start, step, press, release, pendingGroup, setMode, setSpeed,
    goLearn, goHome, goFree, goTheory, syncWake, get wake(){ return wake; }, ...(typeof Hist === 'undefined' ? {} : {Hist})};\nNube.bind();`;
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

  // (aquí siguen las pruebas del historial)

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
