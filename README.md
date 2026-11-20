# Núremberg 1561 — Anomalía

> **Combate aéreo cinematográfico en primera persona en el navegador (WebGL 2 HDR · sin bundler · 100% offline).**

Ambientado al amanecer del **14 de abril de 1561** sobre la ciudad imperial de Núremberg, inspirado libremente en el célebre fenómeno celeste ilustrado por Hans Glaser. Piloteá un **F-35A (`ARG-061`)** a través de una anomalía temporal para interceptar esferas metálicas, cazas interceptores, cruces celestes y naves nodriza colosales antes de que arrasen la ciudad.

---

## Características principales

- **Pipeline cinematográfico WebGL 2 HDR (`Three.js`)**:
  - Nubes volumétricas *raymarched* con viento, *silver-lining* solar y sombras proyectadas sobre el valle.
  - Rayos crepusculares volumétricos (*god-rays*), destellos anamórficos horizontales, ondas de choque refractivas en explosiones, aberración cromática dinámica en poscombustión, *color grading* fílmico y grano 35mm fino.
  - Escenario tridimensional de Núremberg con barrios medievales instanciados, catedrales, murallas, bosques de Franconia y río Pegnitz con reflejos especulares animados.
- **Cabina 3D PBR y HUD holográfico HMDS**:
  - Cabina tridimensional del F-35A con cúpula de vidrio Fresnel, reflejos solares dinámicos y rebote interior de luz de disparo/explosión.
  - Pantalla panorámica 3D animada (horizonte artificial, altitud, velocidad, rumbo, carga G, potencia, radar táctico y estado de armamento).
  - Mira óptica con predicción balística **LCOS** y diamante progresivo de adquisición infrarroja **AIM-9X**.
- **Combate aéreo visceral y destrucción urbana**:
  - Cañón rotativo **GAU-22/A** con balística física, **6 misiles guiados AIM-9X** con navegación proporcional y **12 bengalas/contramedidas** defensivas.
  - Naves abatidas que caen en llamas y destruyen edificios en tiempo real, levantando columnas persistentes de humo y fuego.
  - Radio táctica VHF del ala (`ARG-062`) y micro cámara lenta dramática en derribos.
- **Audio procedural 100% offline (Web Audio API)**:
  - Turbina, flujo de aire, golpe de poscombustión, cañón GAU-22/A, *Sidewinder IR growl/lock*, lanzamiento de misiles, bengalas, *flyby* Doppler, alertas RWR, tensión estructural por altas G y ambiente urbano.

---

## Cómo jugar

No requiere instalación, servidor ni dependencias externas:

1. Cloná o descargá este repositorio.
2. Abrí `index.html` directamente en un navegador moderno con soporte WebGL 2 (Chrome, Edge, Firefox).
3. Elegí el perfil de calidad gráfica (**Automática**, **Alta**, **Media** o **Baja**) y hacé clic en **INICIAR MISIÓN**.

> También se puede publicar directamente con **GitHub Pages** sirviendo la raíz del repositorio.

---

## Controles

| Acción | Control |
| :--- | :--- |
| Dirigir, alabear y apuntar | **Ratón** |
| Cañón GAU-22/A | **Clic izquierdo** |
| Lanzar misil guiado AIM-9X | **Clic derecho** / **E** / **Espacio** |
| Desplegar bengalas (contramedidas) | **F** / **Q** |
| Aumentar / reducir velocidad | **W** / **S** |
| Maniobrar lateralmente | **A** / **D** |
| Postcombustión | **Shift** |
| Recargar cañón | **R** |
| Activar / silenciar sonido | **M** |
| Pausar y liberar cursor | **Esc** |

---

## Arquitectura del proyecto

```text
├── index.html          # Entrada principal, HUD HMDS y Content-Security-Policy estricta
├── style.css           # Estilos de interfaz, intro cinematográfica y HUD holográfico
├── game.js             # Bucle principal, física de vuelo 6-DOF, armas, IA y estado
├── renderer.js         # Capa 2D del visor HMD, LCOS, bloqueo IR y fallback sin WebGL
├── world3d.js          # Orquestador WebGL 2 / Three.js, iluminación y entidades 3D
├── atmosphere3d.js     # Nubes volumétricas raymarched y perspectiva aérea física
├── postfx.js           # Pipeline HDR, bloom anamórfico, god-rays, shockwave y grading
├── cockpit3d.js        # Cabina 3D PBR, cúpula de vidrio y MFD panorámico animado
├── models3d.js         # Modelos 3D procedurales PBR (nodrizas, cazas, anomalías)
├── city3d.js           # Generación instanciada de Núremberg, murallas y destrucción
├── woodland3d.js       # Vegetación y masas boscosas del valle de Franconia
├── vfx3d.js            # Explosiones, humo, misiles, bengalas, brasas y agua del Pegnitz
├── audio.js            # Motor de síntesis de audio cinematográfico (Web Audio API)
├── textures.js         # Generador de texturas procedurales para respaldo 2D
├── assets/             # Atlas de texturas, relieve, cielo HDR y referencias
├── vendor/             # Copia local de Three.js y su licencia MIT
└── tests/              # Pruebas automatizadas en Node y benchmark GPU en navegador
```

---

## Pruebas y benchmark

Con [Node.js](https://nodejs.org/) instalado podés ejecutar la batería de pruebas de regresión:

```bash
node tests/smoke.cjs
node tests/audio.cjs
node tests/camera.cjs
node tests/renderer.cjs
```

Para medir rendimiento GPU en tu navegador, abrí `tests/gpu.html` (acepta `?quality=auto|high|medium|low`) y dejá la pestaña visible durante los 330 cuadros de prueba.

---

## Licencias y atribuciones

- **Three.js** (`vendor/three.min.js`): licencia MIT ([vendor/THREE-LICENSE.txt](vendor/THREE-LICENSE.txt)).
- **Relieve de Franconia** (`assets/franconia-relief.js`): derivado de NASA JPL (2013), SRTMGL3 v003 vía OpenTopography.
- **Campos de Franconia** (`assets/franconia-fields.js`): Geobasisdaten Bayerische Vermessungsverwaltung (CC BY 4.0, datos modificados).
- **Cielo HDR** (`assets/franconia-sky.js`): *Overcast Soil (Pure Sky)* por Sergej Majboroda & Jarod Guest, Poly Haven (CC0).
- **Ficción histórica**: la presencia de aeronaves modernas es una licencia narrativa inspirada en la hoja volante de Hans Glaser (1561).
