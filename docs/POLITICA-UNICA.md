# Política única — aprobás una vez, los agentes siguen solos

Modo opcional (apagado por defecto). Sirve para no revisar correo por correo:
el dueño aprueba **una política** y los agentes trabajan con ella sin pedir
aprobación individual de cada borrador.

## Cómo se usa

1. En **Ajustes → Correo**, configurá el proveedor de envío real (Resend con
   dominio verificado, Gmail con contraseña de aplicación, o webhook). Sin esto los borradores se aprueban solos
   pero nadie los envía.
2. En **Ajustes → Misiones y Correo**, definí mercados, tono, prospectos por
   misión, límite diario y espaciado. Esa es tu política.
3. Entrá a **Ajustes → Política única**, leé las reglas y tocá **Aprobar una
   vez**. Eso guarda una huella (hash) de la configuración aprobada.
4. Desde ahí, las misiones nuevas aprueban solas los avisos de verificación y
   los borradores salen por el piloto de envío, respetando límite diario,
   calentamiento y espaciado.

Botones del panel:

- **Aprobar una vez**: firma la política, aplica sus reglas a los mensajes
  existentes elegibles y los pone en cola. Con Gmail, Resend o webhook
  configurados también activa el piloto de correo.
- **Desactivar**: pausa los envíos pendientes sujetos a esa política.
- La vista previa de cada campaña indica si usa la política vigente.
  Su tono y sus mercados deben estar autorizados y sus prospectos por
  lámpara deben respetar el límite aprobado. La vista previa explica
  las diferencias que requieren actualizar la política.

También hay API: `GET /api/policy`, `POST /api/policy/approve`,
`POST /api/policy/apply`, `POST /api/policy/revoke`.

## Qué se auto-aprueba

Solo los avisos que son verificación de comprador o de nombre:

- `conocimiento` — comprador propuesto por el modelo y verificado en su sitio.
- `directorio` — comprador del directorio semilla verificado.
- `nombre` — el mensaje no menciona el nombre del comprador.

Cada borrador queda trazado con `approvedBy: "política única"`, `approvedAt`,
`autoApproved: true` y la huella de la política que lo aprobó.

El aviso de `redteam` **nunca** se auto-aprueba salvo que el dueño marque
explícitamente esa opción en la política.

## Qué NUNCA se auto-aprueba

- Bloqueos de cumplimiento (`bloqueado`, `cumplimiento`).
- Revisión de cumplimiento o red team incompleta (`revision-faltante`).
- Textos sin mensaje 1:1 (`sin-mensaje`).
- Misiones supervisadas (`operacion-supervisada`).
- Cotizaciones: el precio siempre lo revisa una persona.
- Contactos suprimidos (opt-out) o revisores bloqueados por migración.

## Guardas que no se negocian

La política **no** modifica:

- El consentimiento documentado que exigen el piloto y Resend. Un contacto sin
  `permission.status = opted_in` con evidencia no entra a la cola automática.
  El panel muestra cuántos borradores están en esa situación.
- El límite diario (`dailyLimit`, máximo 200), el calentamiento y los minutos
  entre envíos.
- La lista de no contactar, la baja detectada en respuestas, el dedupe por
  contacto ni la parada ante una respuesta del comprador.

Si cambiás mercados, tono, prospectos, límite, proveedor, espaciado o la lista
de avisos permitidos, la huella deja de coincidir: el modo automático se apaga
solo y hay que reaprobarlo. Un `PUT /api/settings` normal no puede activarlo;
solo lo hace el endpoint de política.

## Límites honestos

Esto automatiza la **decisión**, no la física del correo. Un dominio que envía
miles de correos fríos por día se quema y puede infringir CAN-SPAM, LSSI/GDPR o
la normativa local. Para volúmenes altos hacen falta dominios propios con
SPF/DKIM/DMARC, listas con consentimiento real, calentamiento y proveedores que
permitan ese uso. La política única no salta ninguna de esas condiciones.
