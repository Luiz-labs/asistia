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

## D. Bug del Universo en la Rama "Calendario Global" del Dashboard (KPI Inasistencias/Cobertura)

Encontrado durante la implementación del drill-down de Inasistencias (Fase 1). Requiere sesión dedicada aparte porque el fix correcto toca `kpiCobertura`, un KPI ya visible en producción, y es un cambio de diseño más grande que un simple swap de variable.

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
- **Pendiente relacionado (ya identificado, no estaba escrito en ningún lado del código hasta ahora)**: `calendario_sedes_gps` (interfaz visual del calendario) y `curso_jornada_reglas` (lo que lee el trigger de push) no están sincronizadas. Las jornadas reales dependen de que exista una regla recurrente que cubra el día, o de crear una fila espejo manual.
