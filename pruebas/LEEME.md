# Pruebas

No forman parte de la app: sirven para comprobar la sincronización entre dispositivos y la ruta de ejercicios antes de publicar un cambio.

- `test-sync.js`: abre la app en varios dispositivos simulados (celular, tablet, computador) contra un servidor de mentira
  (`fake-firebase.js`) y comprueba que canciones, estrellas, teoría, sesión de hoy y dificultad pasan de uno a otro,
  también sin conexión, al recargar y al cerrar sesión.
- `test-real.js`: carga el SDK real de Firebase que está en `lib/`, sin red, para comprobar que la app lo llama como el SDK espera.

- `test-ejercicios.js`: revisa que los 48 ejercicios estén bien escritos (compases, dedos, armaduras) y los toca un
  «pianista virtual» con el reloj simulado para comprobar la calificación: notas, staccato, legato, fuerte y suave, y crescendo.
- `test-midi-real.js`: lo mismo en tiempo real y con un teclado MIDI simulado conectado desde Ajustes (tarda unos dos minutos).

Cómo correrlas (Node 18 o más):

    npm install --no-save playwright
    npx playwright install chromium     # o CHROMIUM=/ruta/a/chromium si ya hay uno instalado
    node pruebas/test-sync.js
    node pruebas/test-real.js
    node pruebas/test-ejercicios.js
    node pruebas/test-midi-real.js

Las dos primeras usan una configuración de mentira dentro de la prueba (reemplazan `NUBE_CFG` al servir la página), así que nunca tocan el proyecto real de Firebase.
