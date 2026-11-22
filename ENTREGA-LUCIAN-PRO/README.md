# Lucian · Entrega limpia

Sistema local de ventas para un maker de lámparas y objetos impresos en 3D.
Esta carpeta contiene **únicamente el sistema vigente**: servidor, agentes,
interfaz, pruebas y documentación. No incluye respaldos, blueprints de
Airtable/Make ni versiones reparadas anteriores.

## Arrancar

1. Instalar Node.js 20 o superior desde https://nodejs.org.
2. Doble click en `INICIAR-LUCIAN.cmd`.
3. Abrir `http://localhost:4321`.
4. Si es la primera vez, cargar los datos de ejemplo desde el asistente.

No hace falta `npm install`: el proyecto no tiene dependencias externas.

## Qué incluye

- **Interfaz** (`public/`): panel, productos, misiones, ventas, conversaciones,
  contenido, equipo, mercados, conexiones y ajustes. Sistema visual v2:
  paleta papel cálido / tinta carbón / acento cobre, tipografía y superficies
  consistentes, foco visible y diseño responsive.
- **Equipo de 12 agentes** (`lib/prompts.mjs`): los 11 especialistas originales
  más el **Asistente de Configuración**, que responde preguntas de ajustes,
  conexiones, correo, límites y política única. Se puede consultar desde
  Equipo → "Preguntale al equipo" y desde Telegram (enrutamiento automático
  según el tema de la pregunta).
- **Política única** (`lib/policy.mjs`): aprobás una vez las reglas y los
  agentes aprueban solos los avisos de verificación. Ver
  `docs/POLITICA-UNICA.md`.
- **Agente de Telegram** (`lib/notify.mjs` + `lib/telegram-dialogue.mjs`):
  memoria comprimida de 24 turnos, comandos globales (`/start`, `/help`) como
  atajos, teclados inline con botones de acceso rápido y confirmación por
  token. Todo texto libre —saludos, aclaraciones, pedidos incompletos— lo
  responde el modelo; la memoria aprendida también la extrae el modelo.
- **Motor comercial** (`lib/agents.mjs`): investigación, compradores
  verificados, precios, redacción, cumplimiento, red team, seguimientos y
  postventa.
- **Pruebas** (`tools/`, `npm test`): sintaxis, búsqueda, núcleo, guardas,
  flujo, escala, API, política única y diálogo de Telegram.

## Catálogo incluido

La entrega incluye los **33 productos reales de GALAPA** importados desde
`https://galapa.com.ar/productos` (`data/products.json` y sus fotos en
`data/media/products/`), junto con las misiones, conversaciones, contenido,
aprendizajes y la configuración de Telegram del resguardo del dueño. El
importador `tools/import-galapa.mjs` permite actualizar el catálogo cuando la
página cambie; sin `--apply` solo muestra la vista previa.

## Verificación

```powershell
npm test
```

Debe terminar con `EXIT=0`. Los datos de prueba se crean en directorios
temporales; nunca se usa la carpeta `data/` real.

## Límites honestos

- El envío respeta un tope de **200 correos por día por dominio**, con
  espaciado por dominio y consentimiento documentado. Se pueden cargar varios
  dominios verificados; la capacidad teórica es 200 × dominios activos, pero
  el plan gratuito de Resend limita la cuenta a 100 correos/día. No es una
  herramienta de correo masivo. Ver `docs/MULTI-DOMINIO.md`.
- El modo automático no salta bloqueos de cumplimiento, cotizaciones ni la
  lista de no contactar.
- Los 12 agentes requieren un modelo real: no hay respuestas prefabricadas.
  Sin IA solo funciona la simulación explícita en modo Demo; sin proveedor de
  correo no se envía nada.
- Todo vive en la computadora (`data/`, creado al primer arranque). No hay
  cuentas ni servicios obligatorios.

## Documentación

- `LEEME.md` —Manual completo de uso.
- `docs/POLITICA-UNICA.md` — aprobación única y guardas.
- `docs/ESTUDIO-CATALOGO-VENTA-MASIVA.md` — límites reales de escala.
- `docs/INVESTIGACION-CORRECCIONES.md` — razones técnicas de las guardas.
