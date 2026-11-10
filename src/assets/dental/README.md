# Recursos dentales con volumen anatómico (UX-05L / UX-05M)

Base visual UX-05L aprobada e **integrada en `DentalArcades` por UX-05M**. Se conservan
sus proporciones, paleta y volumen, con hombros más definidos en caninos y cúspides menos
regulares en molares. Incisivos y premolar mantienen el diseño aprobado.

## Contenido

- `permanent-{incisor,canine,premolar,molar}.svg`
- `temporary-{incisor,canine,molar}.svg`
- `legacy/*.svg` — siete originales planos UX-05K, conservados sin cambios.
- `legacy-ux05l/*.svg` — solo los cuatro originales UX-05L retocados (caninos y molares),
  sin duplicar los tres recursos que no cambiaron.
- `gallery.html` — siete ampliadas a 176 px, antes/después a 104/44/32 px,
  tamaños reales de 44/32 px, comparación de denticiones y espaciado FDI.
- `index.ts` — inventario tipado con el markup (`?raw`), fuente única del renderer compartido.
- `inlineDentalMarkup.ts` — preparación de ese markup local: elimina el envoltorio y añade
  un prefijo único a `id`, `href` y `url(#…)`. No acepta contenido de pacientes ni del backend.
- `silhouettes.test.ts` — guardas de geometría y ausencia de estados clínicos.

## Galería

Con `npm run dev` en `frontend/`:

```
http://127.0.0.1:5173/src/assets/dental/gallery.html
```

También se abre directamente: `src/assets/dental/gallery.html`.

## Convenciones

- Lienzo `0 0 44 44`; borde incisal/oclusal arriba, cuello abajo.
- Coronas esquemáticas: sin raíces largas, diagnósticos ni estados clínicos.
- Marfil con luz lateral, sombra cervical y reflejos discretos; contorno de 0,8 unidades.
- Cada familia tiene geometría propia; no hay premolares temporales.
- Color por variables, con valores neutros de reserva:
  - `--tooth-fill` → `#f8f3ea`
  - `--tooth-outline` → `#8a7f6e`
  - `--tooth-groove` → `#8a7b66`

## Estructura de cada SVG

1. `defs`: un `path[data-outline="crown"]` define la corona; un `clipPath` y cuatro
   gradientes reutilizan esa geometría. Los identificadores llevan prefijos propios por recurso
   (`pi`, `pc`, `pp`, `pm`, `ti`, `tc`, `tm`). No hay recursos externos ni filtros.
2. `g[data-layer="geometry"]`: relleno base con `use` y `--tooth-fill`.
3. `g[data-layer="volume"]`: iluminación lateral, profundidad, sombra cervical y reflejos,
   recortados a la corona.
4. `g[data-layer="detail"]`: borde incisal, relieves, surcos y línea cervical según familia,
   también recortados.
5. Un `use` final dibuja el contorno con `--tooth-outline`.

Las variables CSS y la selección de capas requieren SVG **inline**. Un `img` —como en esta
galería— mantiene el aislamiento y utiliza los valores de reserva del archivo; no hereda las
variables del documento anfitrión. `DentalArcades` utiliza SVG inline dentro de `ToothSilhouette`:
los colores clínicos existentes reemplazan el relleno neutro y atenúan `volume` a 0,3 y `detail`
a 0,6. Los glifos clínicos se dibujan después, fuera de la anatomía rotada. La selección utiliza
un fondo verde suave y una línea inferior centrados en los límites de la corona visible;
no altera el relleno clínico ni desplaza el FDI. El foco de teclado utiliza un contorno independiente.

Los prefijos por recurso no bastan al repetir dientes: `ToothSilhouette` usa `useId` y
`inlineDentalMarkup` por instancia, incluso con gráficos actuales e históricos simultáneos.
Las imágenes externas de la galería no tienen ese problema.

Para utilizar una pieza en el odontograma, reutilizar el renderer existente:

```tsx
import { ToothSilhouette } from '../../components/odontogram/DentalArcades';

<ToothSilhouette fdi={16} condition="CARIES" />;
```

No modificar los SVG para añadir condiciones: esas capas pertenecen al renderer.
UX-05N/05O: una pieza sin registro conserva el marfil y un contorno continuo fino en gris cálido
(`#8a7f6e`); no equivale a `HEALTHY` (sano confirmado). Los FDI muestran solo números;
«Sin registro» permanece en detalle, leyenda y etiquetas accesibles.
La geometría anatómica se amplía un 12 % alrededor del centro del lienzo en el renderer, sin
alterar los archivos SVG, el tamaño del mapa, los botones ni los glifos clínicos.

## Verificación y evidencias

Desde `frontend/`: `npm run typecheck`, `npm run lint` y
`npm test -- src/assets/dental src/components/odontogram`.

Integración y verificación: `docs/ux/UX-05M-integracion-anatomica.md` (desde la raíz).
Capturas del odontograma real con datos sintéticos: `docs/ux/ux05m-evidence/`.
El documento y las capturas UX-05L anteriores se conservan como referencia histórica.
