# Lucian ”” equipo de venta para lámparas de diseño impresas en 3D

Lucian es un sistema **local-first** (todo vive en tu computadora) para un maker solo.
No necesita Airtable ni Make. Sin clave de IA podés recorrer una **simulación marcada como Demo**; los 12 agentes son modelos de lenguaje reales y nunca devuelven respuestas prefabricadas.

## Cómo arrancar

1. Doble click en `INICIAR-LUCIAN.cmd` (o en la raíz del proyecto).
2. Se abre el navegador en `http://localhost:PORT`.
3. La consola imprime **«Listo para funcionar»**: IA, búsqueda, correo y piloto, Telegram, seguimientos y postventa, cuántos borradores esperan tu decisión y qué conversaciones están abiertas. De un vistazo sabés qué falta antes de vender.
4. Si es la primera vez, aparece un asistente de bienvenida. Podés cargar datos de ejemplo con un click.

Requisito: Node.js 20 o superior (https://nodejs.org). No hace falta `npm install`.

## Dónde viven tus datos

- `lucian/data/` ”” productos, misiones, conversaciones, contenido, aprendizajes, ajustes, fotos.
- `lucian/data/media/` ”” las fotos que subís.
- `lucian/data/settings.json` ”” toda la configuración, incluidas las claves (guardadas en texto plano en tu máquina).

Backups: desde Ajustes → Datos y respaldo, o `GET /api/backup` (ZIP).

## Qué podés hacer sin claves

- Cargar productos con foto, precio, código y notas.
- Lanzar misiones en modo demo (datos simulados, marcados como ejemplo). La simulación se elige explícitamente: el modo automático ya no cae en demo.
- Revisar borradores, editarlos, marcarlos como enviados manualmente.
- Descargar `.eml` para enviar desde tu correo.
- Recorrer la interfaz y la ayuda. Las consultas al equipo requieren IA.

## Qué necesitás para que sea real

Configurá en **Ajustes**:

- **Inteligencia artificial**: clave de OpenAI / OpenRouter / Anthropic / Gemini / Groq / DeepSeek / Mistral, o una URL local de Ollama. Sin esto no hay agentes ni misiones reales: solo se puede simular en modo Demo. Las respuestas nunca se inventan ni se leen de un texto fijo.
- **Búsqueda**: sin clave, Lucian consulta instancias públicas de SearXNG (y DuckDuckGo como último recurso). Esas instancias limitan consultas y pueden fallar: la app lo informa y no inventa resultados. Para misiones que tienen que vender en serio, configurá **Tavily / Brave / Serper** (tienen capa gratuita) o una **instancia SearXNG propia**.
- **Hunter** (opcional): para enriquecer emails de compradores.
- **Correo**: remitente. Para envío automático real, clave de Resend. Si no, podés descargar `.eml` o confirmar "ya lo envié".
- **Notificaciones**: token de Telegram (recomendado, fácil) y/o WhatsApp Cloud API (requiere webhook público).
- **Misiones**: mercados, tono, profundidad por defecto.

## Flujo real

1. Cargás una lámpara (foto, precio, código, notas).
2. Lanzás una misión (producto + objetivo + mercados + profundidad).
3. El equipo investiga, calcula aduanas/precios, busca compradores reales, verifica cada sitio y escribe mensajes.
4. Revisás todo en la **Bandeja** y en **Contenido**.
5. Confirmás lo que se envía. Nada sale solo.

## Compradores verificados (sin fantasmas)

- Un nombre en el JSON del modelo **no** es un comprador. Antes de crear una conversación, Lucian abre el sitio del comprador, comprueba que exista y que mencione esa tienda.
- Si el sitio no responde, solo se acepta cuando la fuente citada menciona la tienda; se marca **Sin sitio propio verificado**.
- Se descartan los nombres genéricos ("tienda de diseño independiente", "hotel boutique"), los agregadores y marketplaces (idealo, Amazon, eBay), los fabricantes (Vibia, Marset, Santa & Cole”¦) y los sitios que anuncian su cierre.
- Los emails **solo** se usan si están publicados en el sitio. Un email que propone el modelo y no aparece publicado se descarta: parecía válido y iba a rebotar.
- Si la búsqueda web falla, la misión usa un **directorio semilla** de tiendas reales de los mercados elegidos. Igual se verifica cada sitio en el momento: si no responde, no entra.
- Una misión sin compradores verificados termina **con aviso** y lo dice: no hay a quién venderle todavía, no se creó ninguna conversación y no se envió nada. No se presenta como un éxito.
- Las conversaciones viejas creadas antes de esta regla se marcan **Sin verificar** al abrir la app; si eran nombres genéricos, sus borradores se descartan y salen de la bandeja activa. No se borra nada.

## Profundidades

- **Rápida** (8 pasos): lo esencial para salir a vender esta semana. Sin contenido ni red team.
- **Estándar** (12 pasos): equipo completo.
- **Profunda** (13 pasos): todo lo anterior + revisión y corrección obligatoria tras el red team.

## Cotizaciones y cierre de ventas

- Cada conversación puede tener una o varias cotizaciones formales con precio, cantidad, envío, descuento, impuestos, validez y link de pago.
- La cotización se arma sin IA: los números salen de la ficha y de lo que cargás. El texto se genera en el idioma del comprador.
- Una cotización aceptada cierra la venta, reinicia la postventa (día 3/30/90) y descarta seguimientos fríos pendientes.
- El link de pago puede venir del producto, de la cotización o del ajuste global en Ajustes → Correo → Cobros y cotizaciones.

## Claves por variables de entorno (opcional)

Si preferís no dejar claves en `settings.json`, podés definirlas al arrancar:
`LUCIAN_AI_API_KEY`, `LUCIAN_AI_BASE_URL`, `LUCIAN_AI_MODEL`, `LUCIAN_AI_PROVIDER`,
`LUCIAN_SEARCH_API_KEY`, `LUCIAN_SEARX_URL`, `LUCIAN_RESEND_KEY`, `LUCIAN_EMAIL_FROM`,
`LUCIAN_EMAIL_REPLY_TO`, `LUCIAN_WEBHOOK_TOKEN`, `LUCIAN_HUNTER_API_KEY`, `LUCIAN_BRAND_NAME`.
Las variables tienen prioridad sobre lo guardado en disco.

- `manual`: marcás "ya lo envié" y Lucian registra el mensaje.
- `resend`: envío real, bloqueado para emails `example.com` y si no hay clave.
- `webhook`: tu propio endpoint.
- `.eml`: descargás el correo y lo enviás desde tu cliente.

## Seguridad

- Todo es local. No hay cuentas ni servidores externos obligatorios.
- Las claves se guardan en `settings.json` en tu máquina.
- El envío real siempre requiere confirmación explícita y respeta límites diarios y warm-up, salvo que actives el piloto automático (opt-in), que solo envía lo que pasó las guardas, respetando los mismos límites y un espaciado fijo entre envíos.
- En modo demo, los emails `example.com` no se envían.
- **Búsqueda sin clave**: las consultas se envían a instancias públicas de SearXNG (o a la instancia que configures). No incluyas datos privados en las consultas. Para uso profesional conviene una instancia propia o un proveedor con clave.
- **Verificación de compradores**: Lucian abre los sitios públicos de los compradores para comprobar nombre y buscar emails publicados. No accede a áreas privadas ni usa credenciales.

## Borradores y aprobación

- Cada borrador tiene un estado: `listo`, `por aprobar` (`revisar`), `bloqueado`, `enviado`, `descartado`.
- Solo los `listo` se pueden enviar o descargar como `.eml`. El texto de un borrador en revisión se puede copiar para revisarlo, pero no enviar desde Lucian hasta aprobarlo.
- Los `por aprobar` necesitan que los apruebes (botón **Aprobar**) antes de enviarlos. Se generan cuando falta la revisión de cumplimiento o red team, cuando una corrección de cumplimiento no coincide con el texto, o cuando el mensaje no menciona al comprador.
- Si el **red team** pide **detener**, los borradores quedan **Por aprobar** con su advertencia (no se bloquean para siempre): podés corregir el plan y reintentar, o revisar la objeción, asumir el riesgo y aprobar. Revalidar no borra esa aprobación explícita mientras el texto no cambie.
- Las correcciones de cumplimiento se aplican solas cuando citan literalmente un fragmento del mensaje. Si no coinciden, el borrador queda en revisión y se avisa en la misión.
- Los `bloqueados` (rechazo de cumplimiento o supresión) no se pueden aprobar ni enviar. El motivo se muestra en el borrador.
- Si un borrador queda sin mensaje 1:1 para un comprador, no hereda el de otra tienda: queda para que lo escribas a mano.
- Al abrir una versión nueva, Lucian revisa los borradores históricos: si dos hilos repiten el mismo contacto o falta la revisión de la misión, los deja **Por aprobar**. No borra nada.
- Un contacto sin email también se puede trabajar: enviás por el formulario o LinkedIn y usás **Ya lo envié** para registrar el contacto. Lucian no inventa direcciones.

## Lista de no contactar (opt-out)

- En **Ajustes → No contactar** podés agregar emails, dominios o empresas.
- Si alguien responde “BAJA”, “no me escribas más”, “unsubscribe” o similar, Lucian lo detecta, lo agrega a la lista y marca la conversación como perdida.
- La detección es conservadora: ignora el texto citado del correo anterior (tu propio pie dice “respondé BAJA” y no debe disparar la baja) y exige una frase de intención. “Baja California” o “temporada baja” no cuentan.
- Al agregar un email se bloquea solo esa dirección. Para bloquear toda la empresa marcá **Bloquear todo el dominio** o cargá el dominio en su campo.
- Quitar una supresión no envía nada: los borradores que habían quedado bloqueados vuelven a **Por aprobar**.
- No se pueden bloquear dominios compartidos (Gmail, Outlook, etc.): agregá el email exacto.

## Webhook de correo entrante

- Para recibir respuestas desde internet, configurá un token en **Ajustes → Correo** o en la variable `LUCIAN_WEBHOOK_TOKEN`.
- Sin token, Lucian solo acepta correos entrantes desde la misma computadora y sin cabeceras de proxy. Si usás ngrok, Cloudflare Tunnel o un proxy, configurá token: esas conexiones también parecen locales.

## Qué hace el equipo por vos (todo el ciclo)

- **Venta**: cada misión investiga, calcula precios y aduanas, busca compradores reales verificados y escribe los mensajes 1:1. La campaña de catálogo (`Campaña de catálogo`) encola una misión por producto, rotando mercados para no saturar a los mismos compradores.
- **Promoción**: el paso de contenido de cada misión deja calendario, ganchos, guiones y captions en **Contenido**. Revisiones y publicaciones a tu ritmo.
- **Contactos con clientes**: la **Bandeja** recibe las respuestas; el Analista lee la intención real y propone el siguiente paso. Las respuestas los bajan/suben/cierran etapa.
- **Fidelización**: marcar una conversación como **ganado** arranca el reloj de postventa ”” día 3 agradecimiento, día 30 feedback (reseña/referido), día 90 reorden ”” siempre con tu aprobación salvo piloto.
- **Persuasión**: secuencias del Redactor Comercial, manejo de objeciones y tono configurable por mercados (Ajustes → Misión).
- **Advertencias para vos**: Telegram (o WhatsApp) te avisa de misiones con error, red team en contra, bajas, bloqueos de envío, y cada mañana un digest con lo pendiente. Vos decidís siempre.
- **Preguntas**: en **Equipo → Preguntale al equipo** (o por Telegram), los doce especialistas —incluido el Asistente de Configuración— responden con tus datos reales: productos, precios, misiones, conversaciones y aprendizajes. Ninguno lee una respuesta escrita de antemano: todos consultan al modelo.
- **Memoria**: el equipo guarda lo que cada misión enseña (`Aprendizajes`) para no repetir errores.
- **Nada sale sin tu revisión** salvo que actives el **piloto automático** (opt-in, solo Resend/webhook, respeto total del cupo por dominio, calentamiento y espaciado).
- **Política única**: aprobás UNA vez las reglas en Ajustes → Política única y los agentes aprueban solos los avisos de verificación, sin pedirte revisar cada correo. Los bloqueos legales, las cotizaciones y el consentimiento documentado siguen intactos. Si cambiás una regla, se desactiva sola. Ver `docs/POLITICA-UNICA.md`.

## El agente de Telegram

Telegram es un **segundo canal para hablar con el mismo equipo de 12 agentes**, no un botón de comandos. Configurá el token y tu chat en **Ajustes → Notificaciones**.

- Escribile en lenguaje natural: “¿qué lámpara conviene empujar este mes?”, “prepará una respuesta para Avanluce”, “¿por qué se frenó la misión de España?”. El director (o el especialista que corresponda) responde con un modelo real y con tus datos.
- Los comandos con `/` (`/estado`, `/misiones`, `/resumen`, `/perfil`, `/olvidar`, …) son **atajos deterministas** para consultas rápidas. No sustituyen a la conversación.
- El agente mantiene el hilo de la charla, recuerda tus preferencias y reglas, y adopta correcciones (“no, prefiero distribuidores, no hoteles”). Esa memoria la extrae el modelo con JSON estricto; el respaldo por patrones solo se usa si no hay IA.
- Si una acción es irreversible (enviar, lanzar misión, cobrar), pedí confirmación con un botón o escribiendo “confirmar”. Sin confirmación no se ejecuta nada.
- Los ajustes de estilo (`serio`, `directo`, `estratégico`) están en Ajustes → Notificaciones.

## Catálogo completo de GALAPA

La tienda pública es [galapa.com.ar/productos](https://galapa.com.ar/productos). Cada artículo disponible lleva a su ficha de Tiendanube para comprar y elegir el medio de pago y el envío.

Lucian carga el catálogo de GALAPA al iniciar por primera vez con el catálogo local vacío. Para actualizar precios y disponibilidad, usá **Productos → Sincronizar GALAPA**. También podés sincronizar por terminal con:

```powershell
node tools/import-galapa.mjs --apply
```

La sincronización marca como **En venta** los artículos con disponibilidad en la tienda. Conserva los identificadores, códigos, costos, notas y fotos existentes, junto con las demás fichas y el historial comercial. Sin `--apply` muestra únicamente el conteo de la tienda. Si usás `LUCIAN_DATA_DIR`, la carga se hace desde el botón o el comando.

**Productos → Exportar catálogo** permite descargar un sitio con enlaces de compra y los precios de la última sincronización. Si lo publicás en otro hosting, volvé a exportarlo al cambiar precios o disponibilidad en GALAPA.

## Enviar 200 por día por dominio

Podés cargar varios dominios o subdominios verificados en **Ajustes → Correo → Dominios de envío**, uno por línea: `dominio | remitente | límite diario | activo`. Cada dominio tiene cupo propio de hasta 200 correos/día; Lucian reparte los envíos entre los activos y aplica el espaciado por dominio. Con 10 dominios la capacidad teórica es 2.000/día y con 15, 3.000/día.

Esto **no salta** las guardas: siguen siendo obligatorios el consentimiento documentado, la lista de no contactar, el dedupe y los límites reales del proveedor. En el plan gratuito de Resend el cupo total es de 100 correos/día (incluye los recibidos) y 3 dominios: para pasar de ahí necesitás un plan paid. Ver `docs/MULTI-DOMINIO.md`.

## Misiones con avisos

- Si un paso falla pero el plan final existe, la misión termina como **“con avisos”** (no como perfecta).
- Una misión **sin compradores verificados** termina con aviso, sin hilos y lo dice explícitamente: no hay a quién venderle todavía.
- Un **red team que pide detener** también deja la misión con aviso: los borradores quedan Por aprobar con la objeción visible.
- Los avisos se muestran en la pantalla de la misión y en las notificaciones.
- **Reintentar** completa los pasos fallidos y reconcilia los borradores existentes con la última revisión. Si la misión quedó sin compradores, Reintentar vuelve a prospectar y reconstruye los pasos que dependían de la lista vacía. El botón **Revalidar borradores** hace lo mismo sin volver a ejecutar la misión.
- Si el contenido de un borrador cambia después de que lo aprobaste, vuelve a **Por aprobar** (también si lo editás a mano y ya estaba aprobado).
- **Reintentar** vuelve a prospectar cuando no hay compradores, así una búsqueda arreglada puede cambiar el resultado sin crear una misión nueva.

## Verificación

- `npm run check` ”” valida la sintaxis de todos los archivos.
- `npm run test:search` ”” prueba el parser de búsqueda, el filtro de relevancia, el detector de bloqueo de DuckDuckGo y los errores honestos de proveedores.
- `npm run test:core` ”” prueba demo, ZIP, email y pasos.
- `npm run test:guards` ”” prueba 1:1, revisión, correcciones, dedupe, opt-out (incluidos falsos positivos), supresiones, migración y reconciliación.
- `npm run test:flow` ”” prueba la verificación de compradores, el directorio semilla, la migración de hilos inventados y los avisos de "sin compradores".
- `npm run test:scale` ”” prueba la caché de proveedores, el piloto (agenda, espaciado, no duplica, no envía a supresiones ni a hilos respondidos), la postventa y el pie de cumplimiento.
- `npm run test:api` ”” prueba la API completa contra un servidor temporal en el puerto 4399.
- `npm test` ”” corre todo lo anterior en orden.

Para saber si vale la pena cargar todo el catálogo y qué hace falta, leé `docs/ESTUDIO-CATALOGO-VENTA-MASIVA.md`.

## Envío

- El envío por defecto es manual (no se va nada). Opcionalmente activás el **piloto automático** en Ajustes → Correo: solo envía borradores que pasaron las guardas, con cupo por dominio, calentamiento y minutos de espacio entre envíos.
- Los envíos manuales ("ya lo envié") no consumen el cupo de calentamiento.
- Los emails de ejemplo (`example.com`) no se envían por Resend ni webhook; sí se pueden marcar como enviados manualmente para simular el flujo en demo.

## Decisiones técnicas

- Las fuentes y el razonamiento de estas guardas están en `docs/INVESTIGACION-CORRECCIONES.md`.
