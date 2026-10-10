// Prueba en tiempo real, con un teclado MIDI simulado conectado desde Ajustes: la fuerza de las teclas llega
// por el mismo camino que usa un teclado de verdad.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const REPO = path.join(__dirname, '..');
function appHtml(){
  let h = fs.readFileSync(path.join(REPO, 'Piano.html'), 'utf8');
  h = h.replace(/const NUBE_CFG = [^;]*;/, 'const NUBE_CFG = null;');
  return h.replace('Nube.bind();', 'window.__t = {get P(){ return P; }, pendingGroup, Data, openSong, goLearn};\nNube.bind();');
}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/piano/Piano.html'){ res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); return res.end(appHtml()); }
  res.writeHead(404); res.end();
});
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c){ pass++; console.log('  ok   ' + name); } else { failN++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch(process.env.CHROMIUM ? {executablePath: process.env.CHROMIUM} : {});
  const ctx = await browser.newContext({viewport: {width: 1180, height: 820}});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.addInitScript(() => {
    localStorage.setItem('piano:ajustes', JSON.stringify({device: 'tab-h'}));
    const input = {name: 'Teclado de prueba', onmidimessage: null};
    window.__midi = bytes => input.onmidimessage && input.onmidimessage({data: bytes});
    navigator.requestMIDIAccess = () => Promise.resolve({inputs: new Map([['1', input]]), onstatechange: null});
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/piano/Piano.html`);
  await page.waitForFunction(() => window.__t);
  await page.click('#btnSettings'); await page.click('#btnMidi');
  await page.waitForFunction(() => /Conectado: Teclado de prueba/.test(document.querySelector('#midiStatus').textContent));
  await page.click('#dlgClose');
  ok(true, 'el teclado simulado se conecta desde Ajustes');

  const run = (id, o) => page.evaluate(([id, o]) => new Promise(resolve => {
    const t = __t; t.goLearn(); t.openSong(id);
    document.querySelector('#btnStart').click();
    const P = t.P;
    const iv = setInterval(() => {
      if (P.finished){
        clearInterval(iv);
        const card = document.querySelector('#doneCard');
        resolve({stars: card.querySelector('.stars-big').getAttribute('aria-label'), text: card.textContent.replace(/\s+/g, ' ').trim(), best: t.Data.progress[id] || null});
        return;
      }
      if (!P.waiting) return;
      for (const n of t.pendingGroup()){
        const v = o.same ? 78 + (n.midi % 5) * 3 : n.hair ? Math.round(44 + 64 * n.lv) : n.dyn === 'f' ? 108 : n.dyn === 'p' ? 44 : 78;
        window.__midi([0x90, n.midi, v]);
        setTimeout(() => window.__midi([0x80, n.midi, 0]), n.art === 's' ? 90 : Math.max(120, n.dur * 60000 / P.song.bpm * 0.9));
      }
    }, 25);
  }), [id, o]);

  console.log('Tiempo real (cada ejercicio dura unos 25 segundos)');
  let r = await run('eco', {});
  ok(/^3 de 3/.test(r.stars) && /Se nota la diferencia entre fuerte y suave/.test(r.text) && r.best.stars === 3, '«El eco» con matices por MIDI: tres estrellas', r.text.slice(0, 200));
  r = await run('eco', {same: true});
  ok(/^1 de 3/.test(r.stars) && /Casi no hay diferencia/.test(r.text), '«El eco» sin matices: una estrella', r.text.slice(0, 200));
  r = await run('staccato', {});
  ok(/^3 de 3/.test(r.stars) && /Las notas cortas salieron cortas/.test(r.text), 'staccato por MIDI: tres estrellas', r.text.slice(0, 200));
  r = await run('crescendo', {});
  ok(/^3 de 3/.test(r.stars) && /Crescendos y diminuendos: 4 de 4 bien/.test(r.text), 'crescendo y diminuendo por MIDI: tres estrellas', r.text.slice(0, 200));
  r = await run('crescendo', {same: true});
  ok(/^1 de 3/.test(r.stars) && /Crescendos y diminuendos: [01] de 4 bien/.test(r.text), 'sin cambiar la fuerza: una estrella', r.text.slice(0, 200));

  console.log('\nErrores de página:', errors.length ? errors : 'ninguno');
  console.log(`\n${pass} ok, ${failN} fallos`);
  await browser.close(); server.close();
  process.exit(failN || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
