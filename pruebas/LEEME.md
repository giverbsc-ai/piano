# Pruebas

No forman parte de la app: sirven para comprobar la sincronización entre dispositivos, la ruta de ejercicios, la teoría, las canciones y el historial antes de publicar un cambio.

- `test-sync.js`: abre la app en varios dispositivos simulados (celular, tablet, computador) contra un servidor de mentira
  (`fake-firebase.js`) y comprueba que canciones, estrellas, teoría, sesión de hoy, dificultad e historial de práctica pasan de uno a otro,
  también sin conexión, al recargar y al cerrar sesión.
- `test-real.js`: carga el SDK real de Firebase que está en `lib/`, sin red, para comprobar que la app lo llama como el SDK espera.

- `test-ejercicios.js`: revisa que los 48 ejercicios estén bien escritos (compases, dedos, armaduras) y los toca un
  «pianista virtual» con el reloj simulado para comprobar la calificación: notas, staccato, legato, fuerte y suave, y crescendo.
- `test-midi-real.js`: lo mismo en tiempo real y con un teclado MIDI simulado conectado desde Ajustes (tarda unos dos minutos).
- `test-teoria.js`: revisa las 28 lecciones de teoría (textos, dibujos, pruebas) y recorre la segunda parte completa como un alumno:
  lee, contesta con el teclado y toca cada ejercicio hasta aprobarlo.
- `test-canciones.js`: revisa las 21 canciones (compases, acordes, dedos, armaduras, niveles) y toca las nuevas en sus tres niveles,
  bien y mal, para comprobar los matices y la articulación.
- `test-varios.js`: pantalla encendida, historial de práctica y la pantalla «Tu progreso» en varios tamaños.
- `test-grabar.js`: «Crear canción» en Tocar libre: graba tramos con un teclado simulado (acordes, pausas largas, teclas que quedan
  apretadas), los corrige, los escucha, guarda la canción en «Tus canciones», la reemplaza y comprueba que el borrador no se pierde.
- `test-teclas.js`: «Teclas del computador» en Ajustes: elegir la letra o el número de cada tecla del piano, tocar con ellas en
  Tocar libre y en un ejercicio, mudar o quitar una letra, volver a las de fábrica y que todo quede guardado al recargar.
- `pianista.js`: el «pianista virtual» que comparten las pruebas.

Cómo correrlas (Node 18 o más):

    npm install --no-save playwright
    npx playwright install chromium     # o CHROMIUM=/ruta/a/chromium si ya hay uno instalado
    node pruebas/test-sync.js
    node pruebas/test-real.js
    node pruebas/test-ejercicios.js
    node pruebas/test-midi-real.js
    node pruebas/test-teoria.js
    node pruebas/test-canciones.js
    node pruebas/test-varios.js
    node pruebas/test-grabar.js
    node pruebas/test-teclas.js

Las dos primeras usan una configuración de mentira dentro de la prueba (reemplazan `NUBE_CFG` al servir la página), así que nunca tocan el proyecto real de Firebase.
