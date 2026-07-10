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
