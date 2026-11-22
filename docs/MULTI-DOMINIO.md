# Envío multi-dominio (200 correos/día por dominio)

## Objetivo

Repartir los envíos automáticos entre varios dominios o subdominios verificados,
con un tope estricto de **200 correos por día y por dominio**, sin relajar el
consentimiento documentado, la lista de no contactar, el dedupe ni el espaciado.

## Decisión técnica

Lucian guarda en `settings.email.sendDomains` una lista de dominios:

```json
[
  { "domain": "lucian.com", "from": "Lucian <hola@lucian.com>", "dailyLimit": 200, "enabled": true },
  { "domain": "ventas.lucian.com", "from": "Ventas <hola@ventas.lucian.com>", "dailyLimit": 200, "enabled": true }
]
```

- Si la lista está vacía, se usa el remitente único clásico (`email.from`), con
  su límite y calentamiento históricos. Las instalaciones existentes no cambian
  su comportamiento sin una decisión explícita.
- El remitente debe pertenecer al dominio declarado. La API rechaza dominios
  inválidos, repetidos, remitentes de otro dominio y límites fuera de 1–200.
- Cada mensaje guarda `from`, `sendDomain` y `sendDomainId`. El `Message-ID`
  usa el mismo dominio que el `From`: mezclarlos delata spam a los filtros.
- `chooseSendDomain` elige el dominio con menos envíos hoy; en empate reparte
  con un hash determinista del día y de la misión. Los dominios en pausa de
  espaciado se excluyen. Es O(D log D) con D ≤ 100.
- La cola aplica el espaciado **por dominio**, no global: varios dominios
  pueden avanzar en paralelo, pero ninguno supera su ritmo configurado.
- El cupo se cuenta con envíos reales del día local. Los marcados como
  "enviados a mano" no consumen cupo.

## Capacidad

Capacidad diaria = `suma(dailyLimit de dominios activos)`.

| Dominios activos | Capacidad/día |
| --- | --- |
| 1 | 200 |
| 3 | 600 |
| 10 | 2.000 |
| 15 | 3.000 |

Esa capacidad es **teórica**: el proveedor y la reputación mandan.

## Evidencia consultada

- Resend, *Verified Domains*: se pueden verificar varios dominios y
  subdominios; recomienda subdominios para separar la reputación de distintos
  propósitos y advierte que dominios "parecidos a la marca" pero ajenos pueden
  interpretarse como phishing.
  https://resend.com/docs/dashboard/domains/introduction
- Resend, *Domain and/or IP Warm-up Guide*: dominio nuevo, hasta 150 correos
  el día 1, 250 el 2, 400 el 3, 700 el 4, 1.000 el 5, 1.500 el 6 y 2.000 el 7.
  Mantener rebotes < 4 % y quejas < 0,08 %.
  https://resend.com/docs/knowledge-base/warming-up.md
- Resend, *Account quotas and limits*: cuenta gratuita = 100 correos/día
  (incluye recibidos), 3 dominios; Pro = 10 dominios y sin cupo diario.
  https://resend.com/docs/knowledge-base/account-quotas-and-limits.md
- Resend, *Usage Limits*: límite de 10 peticiones/segundo por equipo. La cola
  de Lucian opera muy por debajo (un envío por dominio cada `autopilotSpacingMin`).
  https://resend.com/docs/api-reference/rate-limit.md

## Límites que NO se pueden saltar

1. **Cupo del proveedor.** En el plan gratuito de Resend el total es 100
   correos/día aunque tengas 3 dominios. Varios dominios solo ayudan si el plan
   permite ese volumen.
2. **Consentimiento.** El piloto automático sigue exigiendo
   `hasDocumentedOptIn(contact)`. Un email público no es permiso.
3. **Lista de no contactar, dedupe y etapa.** Un contacto suprimido o que ya
   respondió nunca entra en la cola.
4. **Rebotes y quejas.** Si superás 4 % / 0,08 %, Resend pausa el envío. Hay
   que bajar el ritmo y revisar la lista, no agregar dominios.
5. **Dominios verificados.** Cada dominio debe estar verificado (SPF, DKIM y
   DMARC) en el proveedor antes de cargarlo en Lucian.

## Cómo configurarlo

1. Verificá los dominios o subdominios en tu proveedor de correo.
2. Ajustes → Correo → **Dominios de envío**. Una línea por dominio:
   `dominio | remitente | límite diario | activo`.
   Ejemplo: `ventas.tumarca.com | Lucian <hola@ventas.tumarca.com> | 200 | 1`.
3. Guardá. La tarjeta "Uso de hoy por dominio" muestra cupo consumido y restante.
4. Activá el piloto automático solo cuando quieras enviar sin revisar cada
   borrador. La política única sigue siendo el mecanismo de aprobación.

## Verificación

```powershell
npm run test:send-domains
npm test
```
