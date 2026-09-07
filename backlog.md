# Backlog de AsistIA - Pendientes Operativos y de UX

A continuación se detallan los requerimientos prioritarios para las próximas fases de desarrollo, recopilados a partir de las lecciones aprendidas de la primera marcha blanca.

---

## A. Gestión Completa de Secciones
Módulo administrativo para la administración autónoma de grupos y secciones de aspirantes.
- **Creación**: Permitir el registro de nuevas secciones asociadas a un curso.
- **Edición**: Modificar nombres, límites y metadatos de las secciones.
- **Desactivación y Eliminación**: Deshabilitar temporalmente o eliminar secciones vacías sin registros de asistencia históricos.
- **Duplicación**: Clonar la configuración de una sección para agilizar el inicio de nuevos ciclos.
- **Validación de Aspirantes**: Validar en tiempo real los aspirantes asignados a cada sección antes de confirmar cambios o eliminaciones.

---

## B. Calendario Recurrente
Planificación avanzada de jornadas y clases periódicas para evitar la programación manual diaria.
- **Repetición Semanal**: Configurar eventos que se repitan automáticamente ciertos días de la semana.
- **Selección de Días**: Permitir seleccionar días específicos de la semana (por ejemplo, Lunes, Miércoles, Viernes).
- **Definición de Fecha Final**: Establecer el límite de recurrencia en el calendario.
- **Edición por Ocurrencia**: Modificar de forma independiente los datos (horario, sede, tolerancia) de una única fecha de la serie.
- **Edición de la Serie Completa**: Aplicar cambios a todas las ocurrencias futuras de manera simultánea.
- **Cancelación y Excepciones**: Cancelar fechas específicas (feriados) o cambiar sedes/GPS/horas de tolerancia por excepción para días específicos.

---

## C. Perfil del Aspirante
Portal de autogestión de datos para los aspirantes.
- **Avatar / Foto**: Permitir cargar y recortar foto de perfil para la credencial digital de asistencia.
- **Datos Personales**: Formulario para editar Nombres, Apellidos, UBO, Correo y Teléfono.
- **Sección**: Permitir la autoselección de sección controlada (con límites de capacidad).
- **Flujo de Aprobación**: Mecanismo para que los administradores aprueben o bloqueen cambios posteriores en el perfil.
- **Auditoría de Cambios**: Registro log histórico detallado de todas las modificaciones realizadas por el aspirante en su perfil.

---

## D. Bug del Universo en la Rama "Calendario Global" del Dashboard (KPI Inasistencias/Cobertura) — RESUELTO PARCIALMENTE (caso TODOS_ASPIRANTES)

Encontrado durante la implementación del drill-down de Inasistencias (Fase 1). **Estado actual: el caso `TODOS_ASPIRANTES` — el único que usa el curso actual, por finalizar — ya está corregido.** Los casos `SECCION`/`TODAS` quedan pendientes de diseño: se resolverán cuando se construya el "Flujo Secciones + Calendario" del próximo curso; mientras tanto, el código detecta ese escenario y emite un `console.warn` en vez de intentar resolverlo.

- **Hallazgo principal**: en `cargarDashboard()` (`app.js`), cuando el rango consultado cae en `contextoEfectivo === "global"`, el universo (`padronTotal`/`univFiltrados`) no se construye a partir del padrón de aspirantes activos — se construye a partir de **quién tiene al menos una fila histórica en `asistencias` con `tipo_jornada = 'CALENDARIO_GLOBAL'`**. Esto usa la asistencia (el resultado) como proxy de la elegibilidad (quién debería estar en el padrón), y por lo tanto excluye sistemáticamente a cualquier aspirante activo que nunca haya marcado ni una sola asistencia en toda su historia — caso real confirmado: FERNANDEZ GUERRA, DNI 76896127 (0 registros históricos), queda fuera tanto del denominador de `kpiCobertura` como del universo usado para calcular `kpiInasistencia`. Para el 23/08/2026 esto hace que el universo real usado sea 108 en vez de 109 aspirantes activos.
- **Los 4 valores de `aplica_a` encontrados en `calendario_sedes_gps`** (histórico completo; toda la tabla vive únicamente en el tenant `esbas-24` — ningún otro tenant tiene filas ahí):
  - `TODOS_ASPIRANTES`: 14 eventos totales (10 activos hoy, 4 inactivos/reemplazados).
  - `TODAS`: 7 eventos, todos inactivos hoy (fechas 2026-07-07 a 2026-08-09).
  - `SECCION`: 3 eventos, todos inactivos hoy (fechas 2026-07-08 a 2026-07-09).
  - Hoy, el 100% de los eventos *activos* son `TODOS_ASPIRANTES`, pero no siempre fue así — hubo eventos `TODAS`/`SECCION` en el pasado que luego se desactivaron. Cualquier fix que asuma "siempre fue `TODOS_ASPIRANTES`" estaría construido sobre un supuesto que la propia historia de la tabla contradice.
  - **Matiz de `TODAS`**: no equivale a "Calendario Global" real. `TODAS` significa "todas las secciones tienen clase ese día", pero cada sección sigue bajo su propia regla de jornada (`curso_jornada_reglas`) — es el esquema normal por sección aplicado a todas las secciones a la vez, no un evento sin distinción de sección como sí lo es `TODOS_ASPIRANTES`.
- **Propuesta de reconstrucción evento-por-evento (no implementada)**: en vez de inferir el universo desde el historial de asistencias, leer `calendario_sedes_gps.aplica_a` para cada fecha dentro del rango consultado (`scope.from`..`scope.to`):
  1. Si existe una fecha `TODOS_ASPIRANTES` con `hay_clase=true` en el rango → el universo de esa fecha es el padrón completo de aspirantes activos (filtrado por UBO si aplica), sin cruce con asistencias históricas.
  2. Si existe una fecha `SECCION` → el universo de esa fecha se restringe a los aspirantes de esa sección específica.
  3. `TODAS` probablemente no debería entrar en esta rama en absoluto — corresponde al flujo normal por sección, no al de "Calendario Global".
- **Impacto medido si se corrige**: para el 23/08/2026, `kpiCobertura` bajaría de ~92% (99/108) a ~91% (99/109). Es un cambio real de comportamiento en un KPI que ya ve el usuario en producción, no solo un ajuste interno.
- **Fix aplicado (curso actual)**: en la rama "global" de `cargarDashboard()`, antes de construir el universo desde el histórico de asistencias, se consulta `cacheCalendarioGlobal` (ya filtrado por `activo=true`/`hay_clase=true` para el rango consultado). Si **todos** los eventos activos del rango son `aplica_a='TODOS_ASPIRANTES'`, el universo pasa a ser `aspirantesActivos` (filtrado por UBO si aplica) — el mismo padrón que ya usa la rama regular — sin depender de asistencia histórica. Confirmado: para el 23/08/2026 el universo sube de 108 a 109 e incluye correctamente a FERNANDEZ GUERRA (DNI 76896127, "Nunca asistió") en el drill-down y en `kpiCobertura`.
- **Pendiente (no resuelto hoy)**: si algún evento activo del rango tiene `aplica_a` distinto de `TODOS_ASPIRANTES` (`SECCION` o `TODAS` — flujo del próximo curso), el código mantiene el comportamiento histórico anterior (con las limitaciones ya documentadas arriba) y emite `console.warn("Rango con aplica_a mixto, universo no recalculado - revisar cuando se implemente el flujo de secciones")`. La reconstrucción evento-por-evento completa sigue pendiente de diseño para cuando se implemente el flujo de secciones.

---

## E. Decisión pendiente: ¿justificación aprobada debe sacar a alguien de "Inasistencia"?

Encontrado probando Fase 2 en vivo: DNI 72785611 (ROJAS BENAVENTE, Fabricio Máximo) tiene justificación APROBADA para 2026-08-23, pero sigue apareciendo en la lista de Inasistencia (con "Aprobada" en la columna de contexto) porque el criterio de inclusión es solo asistencia física, no justificación.

Confirmado 25/08/2026: si se exportan Asistencia e Inasistencia para la misma fecha y se combinan externamente (ej. tabla dinámica en Excel), un aspirante con justificación (cualquier estado) aparece en AMBOS exports con datos distintos para el mismo DNI+fecha - riesgo real de doble conteo si alguien no lo sabe. Se evaluaron 3 opciones (excluir 'Aprobada' de Inasistencia / agregar aviso sin cambiar lógica / esperar rediseño completo); se optó por agregar un aviso visible (UI + Excel) como solución puente, dejando el rediseño del 'estado único' (ya propuesto arriba) como la solución de fondo pendiente.

Pregunta de producto sin resolver: ¿una justificación aprobada debería sacar a la persona de la lista de "Inasistencia" por completo (tratarla como asistencia justificada, similar a como ya funciona la pestaña Asistencia con las filas virtuales), o alcanza con mostrarla igual con el contexto visible como está hoy?

**IMPORTANTE**: si se decide que sí debe sacarla, hay que aplicar el cambio en LOS DOS LADOS a la vez:
- `kpiInasistencia`/`kpiCobertura` del Dashboard (hoy NO cuenta ninguna justificación como presente, decisión tomada esta misma sesión al arreglar el bug del universo de Calendario Global).
- El toggle Inasistencia de Reportes (hoy tampoco la cuenta).

Cambiar solo uno de los dos lados reintroduce el mismo tipo de divergencia Dashboard-vs-Reportes que ya se resolvió hoy para el caso del universo de aspirantes activos (ver sección D). No hacerlo a medias.
- **Pendiente relacionado (ya identificado, no estaba escrito en ningún lado del código hasta ahora)**: `calendario_sedes_gps` (interfaz visual del calendario) y `curso_jornada_reglas` (lo que lee el trigger de push) no están sincronizadas. Las jornadas reales dependen de que exista una regla recurrente que cubra el día, o de crear una fila espejo manual.

---

## F. Feature propuesta: alerta "nadie del staff marcó" (sin implementar)

Origen: prueba real del domingo 23/08/2026. El staff no tiene control de horario propio, y ese día el primer QR de staff recién se escaneó a las 11:10am (jornada iniciaba ~8:15am según regla DOMINICAL_GRUPAL) - 3 horas tarde. El sistema de push existente solo reacciona DESPUÉS de que alguien del staff escanea (ese escaneo dispara el timer), así que no existe hoy ninguna alerta si el staff simplemente no marca a tiempo.

Diseño acordado con el usuario:
- Nuevo cron independiente (pg_cron), NO una extensión del sistema existente (`fn_iniciar_push_jornada`) - ese depende de un evento que acá justamente no ocurrió.
- Se dispara 10 minutos después de `jornada_inicio_at`, SI Y SOLO SI no existe ningún registro en `staff_asistencias` para ese día a esa hora.
- Se refiere ÚNICAMENTE a la ausencia del PRIMER escaneo de staff del día (no aplica a escaneos posteriores ni a otros eventos).
- Una sola notificación, no repetida.
- Destinatarios: AMBOS canales - Staff y Backoffice/Superusuario.

Dependencias que deben resolverse ANTES de implementar esto (no implementar hasta que estén resueltas):
1. El canal de notificaciones Backoffice/Superusuario sigue sin funcionar (pendiente ya documentado en la lista de seguimiento general - "Push a Superusuario nunca llegó").
2. `calendario_sedes_gps` y `curso_jornada_reglas` no están sincronizados (pendiente ya documentado en la sección D) - esta alerta nueva necesita `jornada_inicio_at` confiable para CADA día real, y hoy esa fuente depende de que exista una regla recurrente que "por casualidad" cubra el día. Construir esta alerta sobre esa base floja arriesga falsos silencios (no avisa cuando debería) o falsos disparos.

---

## G. RESUELTO EN PRODUCCIÓN (05/09/2026, modo seguro) - login de staff_root nunca obtenía sesión real de Supabase Auth

**Estado actual: resuelto en modo seguro, en producción desde el commit `9be8990` (main), build10051.** `resolverCredencialesAdmin()` ahora, después de que `resolverCredencialesAdminViaRPC()` confirma `valido: true` para el camino `staff_root`, intenta además `autenticarAdminConSupabaseAuth()` (reusando tal cual la lógica de candidatos de email ya usada por `tenant_route`) para que el navegador obtenga un JWT real. Diseño deliberado: **nunca bloquea el login** - si `autenticarAdminConSupabaseAuth()` falla limpiamente o lanza una excepción inesperada (atrapada con try/catch local dentro de `resolverCredencialesAdmin()`, sin depender del try/catch externo de `login()`), `resultadoRpc.valido` no se toca y el superusuario entra igual que antes, sin JWT real. El resultado (éxito/fallo) queda logueado con `console.warn()` explícito y como `jwt_real: true/false` en el `registrarActividad("login_admin", ...)` de cada login, específicamente para poder auditar después cuántos logins de superusuario consiguen JWT real vs. cuántos no.

Verificado en producción tras el deploy: `curl https://asistia.pages.dev/app.js` contiene el string `"obtuvo JWT real de Supabase Auth"`, `app-version.json` reporta `build10051`, y la única cuenta superusuario activa (`llecarosd`) confirmó en prueba real un login normal que sí obtuvo JWT real ("[staff_root] Login de 'llecarosd' obtuvo JWT real de Supabase Auth").

**Pendiente, decisión NO tomada todavía:** pasar a modo estricto (bloquear el login si `autenticarAdminConSupabaseAuth()` falla, en vez de dejarlo pasar sin JWT) queda pospuesto a propósito para después de unos días observando los logs de `jwt_real` en `actividad_logs` - se descartó hacerlo ya porque solo existe una cuenta superusuario activa (la de `llecarosd`) y no hay forma de confirmar hoy que su contraseña en Supabase Auth esté sincronizada con `usuarios_admin.clave`; bloquear sin esa certeza arriesgaba un lockout total del panel de administración. Recién con varios días de logins reales mostrando `jwt_real: true` de forma consistente (o tras resincronizar y confirmar la contraseña manualmente desde el dashboard de Supabase) tiene sentido reevaluar el modo estricto y retomar la Etapa 3 (cierre de `allow_all_inst/allow_all_perf/allow_all_usrperf/allow_all_usuarios`).

**Hallazgo adicional de esta investigación:** la RPC `resolver_login_admin` (la que valida usuario/clave en texto plano contra `usuarios_admin.clave`) no está versionada en ningún script de `sql/` - existe en Supabase pero no en el repo. Sigue pendiente crear una migración que la documente; no se tocó su definición en este cambio.

**Confirmado (lectura, sin cambios):** `resolver_login_admin` (comparación de clave en texto plano contra `usuarios_admin.clave`) no tiene ninguna protección propia contra fuerza bruta - ni contador de intentos, ni bloqueo temporal, ni en la función ni en la tabla. `signInWithPassword()` de Supabase Auth sí tiene protección de plataforma por defecto. Esto es un argumento más a favor de completar la migración de este camino legacy a Supabase Auth real (ya en curso desde la sección G), en vez de agregar un mecanismo de rate-limiting separado y nuevo para un camino que de todos modos se quiere reemplazar.

---

### Diagnóstico original (para referencia histórica)

El login de superusuario (origen="staff_root", vía resolver_login_admin RPC) valida credenciales server-side pero NUNCA llama a supabaseClient.auth.signInWithPassword() - a diferencia de tenant_route, que sí lo requiere explícitamente ("En ruta institucional NO aceptamos autenticación solo por RPC, porque RLS necesita un JWT real en el navegador"). Como resultado, el cliente de Supabase en el navegador queda en estado anónimo durante toda la sesión del superusuario, aunque sessionStorage/sesionAdminActiva crean que está logueado.

Esto estuvo invisible durante meses porque instituciones_luiz, perfiles_luiz, usuarios_perfiles_luiz y usuarios_admin tenían políticas allow_all_* abiertas - el cliente anónimo igual podía leer/escribir todo. Recién se hizo visible hoy porque:
1. La Etapa 2 (fix de app_role()) hizo que el superusuario real empezara a depender de tener una sesión auténtica para las policies "buenas" - exponiendo que nunca la tuvo.
2. usuarios_admin específicamente ya tenía revocado el SELECT de anon en una sesión de seguridad anterior (por las contraseñas en texto plano) - el superusuario, atrapado en rol anon, ahora rebota con "permission denied" contra ESE arreglo previo y correcto.

IMPACTO: si se cierran allow_all_inst/allow_all_perf/allow_all_usrperf/allow_all_usuarios (Etapa 3 original) sin arreglar esto primero, el superusuario pierde acceso COMPLETO a su propio panel de administración - peor que el estado actual.

BLOQUEA: Etapa 3 completa (instituciones_luiz, perfiles_luiz, usuarios_perfiles_luiz, usuarios_admin) queda pausada hasta resolver esto.

Fix propuesto (implementado el 05/09/2026, ver "Estado actual" arriba): agregar supabaseClient.auth.signInWithPassword() (o el mecanismo equivalente) también en el camino de staff_root después de validar con resolver_login_admin, para que el navegador obtenga un JWT real de Supabase Auth.

**Incidente real relacionado - RESUELTO (25/08/2026)**: login de esbas2026-xxivcdls falló tras reset de contraseña porque entró por URL raíz (/backoffice/) en vez de institucional (/esbas-24/backoffice/), cayendo en el mismo camino RPC-only de staff_root (sin JWT real) documentado en esta sección. Causa secundaria: usuarios_admin.clave no se había sincronizado con el reset de Supabase Auth. Ambos resueltos: clave sincronizada, usuaria ahora usa la URL correcta.

**Sugerencia de UX (no implementar hoy)**: la URL raíz /backoffice/ quizás debería redirigir automáticamente a pedir el slug de institución en vez de caer silenciosamente en el modo staff_root - hoy es fácil confundirse y terminar en un camino de login más débil (sin JWT real) sin darse cuenta, como pasó en el incidente de arriba.

**Pendiente de revisar (reportado 07/09/2026, NO urgente - después de resolver el acceso de la jefa institucional)**: el usuario reporta que el panel "Usuarios globales"/"Usuarios institucionales" de LuizLabs sigue apareciendo vacío después de loguearse como `llecarosd`, incluso después de las correcciones de hoy (JWT real + migración/revert de correo). Hipótesis sin confirmar todavía: (a) caché del navegador sirviendo JS viejo (`app.js`) sin el build actualizado, o (b) el intento puntual de login no llegó a obtener JWT real (`autenticarAdminConSupabaseAuth()` falló silenciosamente en ese login específico, dejando la sesión anónima) y por eso RLS no devuelve filas en esos paneles. Falta diagnosticar antes de tocar nada - no asumir causa sin verificar `jwt_real` en `actividad_logs` para ese login puntual.

---

## I. Plan de login robusto (pendiente, no implementar aún completo)

**INCIDENTE REAL 07/09/2026:** se intentó migrar el correo real de `llecarosd` y `esbas2026-xxivcdls` (`auth.users.email` + `usuarios_admin.correo`). Consecuencia no prevista: el login de `esbas2026-xxivcdls` (`tenant_route`) quedó BLOQUEADO por completo en producción, porque `autenticarAdminConSupabaseAuth()` depende de un candidato de correo `usuario@asistia.local` que dejó de coincidir con el nuevo correo real. A diferencia de `staff_root` (que tiene fallback seguro, nunca bloquea), `tenant_route` SÍ requiere JWT real para completar el login - sin fallback. Se revirtió el correo al valor ficticio y se reseteó la contraseña para restaurar el acceso.

**BLOQUEANTE para la Etapa 1:** no migrar ningún correo real de cuentas que usan `tenant_route` hasta que se arregle el mecanismo de resolución de candidatos de correo, para que no dependa únicamente del patrón `usuario@asistia.local`. Alternativas a evaluar en sesión dedicada: (a) que el candidato se resuelva contra `usuarios_admin.correo` actualizado ANTES de intentar `signInWithPassword` - pero eso requiere que `anon` pueda leer esa columna pre-login, hoy bloqueado por RLS; (b) agregar un fallback seguro a `tenant_route` similar al de `staff_root` (no bloquear el login si falla la obtención de JWT) - cambio de diseño mayor, requiere evaluar si RLS de otras tablas ya depende de que `tenant_route` SIEMPRE tenga JWT real.

Objetivo: subir el nivel de seguridad/comodidad del login a algo comparable con sistemas grandes, usando solo herramientas gratuitas de Supabase. 3 etapas, en este orden:

1. **"Olvidé mi clave" real por correo** - requiere (a) migrar cada cuenta de su correo ficticio (`@asistia.local`) a su correo real, y (b) conectar un proveedor de email externo con capa gratuita generosa (ej. Resend, 3000 correos/mes gratis) en vez del límite muy bajo del servicio de correo por defecto de Supabase. Con esas 2 cosas, se activa `resetPasswordForEmail()` nativo de Supabase, sin costo.

2. **Login con Google (OAuth social)** - gratis con Supabase Auth. Elimina la necesidad de recordar/resetear contraseña. Requiere diseño cuidadoso de cómo conectar cada cuenta EXISTENTE (con su correo ficticio actual) a la cuenta de Google real de esa persona, sin duplicar ni perder al usuario.

3. **Verificación en dos pasos (2FA/MFA)** - gratis con Supabase Auth. Refuerzo de seguridad, no reemplaza el login - se agrega al final, una vez que lo básico (etapas 1 y 2) esté sólido.

No implementar nada de código todavía - solo el plan guardado.

### Punto de partida de la Etapa 1 - 2 cuentas reales a migrar

- Cuenta `esbas2026-xxivcdls` (jefa, Vanina Lorena Baca Etchezahar, código CBP A02006): correo ficticio actual `esbas2026-xxivcdls@asistia.local`, correo real a migrar `PIBANINA@HOTMAIL.COM`.
- Cuenta `llecarosd` (superusuario, el propio usuario): correo ficticio actual `llecaros@asistia.local`, correo real a migrar `luis.lecaros.d@gmail.com`.

### Diagnóstico confirmado por Supabase MCP (solo lectura, 07/09/2026) - estado ACTUAL antes de cualquier cambio

| Cuenta | `auth.users.email` | `usuarios_admin.correo` |
|---|---|---|
| `llecarosd` | `llecarosd@asistia.local` (sigue ficticio) | `llecarosd@asistia.local` (igual al ficticio, no vacío ni distinto) |
| `esbas2026-xxivcdls` | `esbas2026-xxivcdls@asistia.local` (sigue ficticio) | `esbas2026-xxivcdls@asistia.local` (igual al ficticio, no vacío ni distinto) |

Ambas cuentas están hoy 100% en correo ficticio en las dos tablas - ninguna tiene todavía el correo real cargado en ningún lado. La migración de la Etapa 1 parte de cero para las dos.

### Actualización (07/09/2026) - correo real migrado para ambas cuentas

Se actualizó `auth.users.email` (vía Admin API, `email_confirm: true`) y `usuarios_admin.correo` (vía `supabase db query --linked`) para ambas cuentas:

| Cuenta | `auth.users.email` | `usuarios_admin.correo` |
|---|---|---|
| `llecarosd` | `luis.lecaros.d@gmail.com` (confirmado) | `luis.lecaros.d@gmail.com` |
| `esbas2026-xxivcdls` | `pibanina@hotmail.com` (confirmado) | `pibanina@hotmail.com` |

Nota técnica: en ambas cuentas, `identities[].identity_data.email` (subregistro interno de Supabase Auth) quedó con el correo ficticio viejo - el endpoint admin de `email` no lo sincroniza automáticamente. No afecta el login (que valida contra `auth.users.email` de nivel superior), pero queda anotado por si genera alguna inconsistencia visible más adelante.

**Pendiente para completar la Etapa 1 (todavía no hecho):** conectar un proveedor de email externo (ej. Resend) y activar `resetPasswordForEmail()`. La migración de correos de estas 2 cuentas era el paso previo necesario, ya resuelto.

**Nota de seguridad:** esta migración se hizo pegando la secret key de Supabase (`service_role`, formato `sb_secret_...`) en texto plano en la conversación para usarla en `curl` contra la Admin API de Auth. Esa clave debe considerarse expuesta - rotarla desde el dashboard de Supabase (Project Settings → API) en cuanto sea posible.
