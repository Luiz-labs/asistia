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
