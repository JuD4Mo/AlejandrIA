import { ApiError } from "@/api/client";
import type { FieldError } from "@/api/types";
import { es } from "@/i18n/es";

export interface MappedApiError {
  title: string;
  message: string;
  next: string;
  detail?: string;
  fieldErrors: FieldError[];
  status: number;
}

const serverMessages: Record<string, { message: string; next?: string }> = {
  "invalid credentials or inactive user": {
    message: es.auth.invalidCredentials,
    next: "Revisa el correo y la contraseña, o pide que reactiven tu cuenta.",
  },
  "invalid request body": {
    message: "El cuerpo de la solicitud no tiene el formato esperado.",
    next: "Revisa los datos del formulario e inténtalo de nuevo.",
  },
  "expected a single JSON object": {
    message: "Enviamos más de un objeto en la solicitud.",
    next: "Recarga la página e inténtalo de nuevo.",
  },
  "invalid pagination": {
    message: "La página solicitada no es válida.",
    next: "Vuelve al inicio de la lista e inténtalo de nuevo.",
  },
  "invalid filter": {
    message: "Uno de los filtros no es válido.",
    next: "Quita los filtros y vuelve a intentarlo.",
  },
  "invalid identifier": {
    message: "El identificador no es válido.",
    next: "Vuelve a la lista y elige un registro existente.",
  },
  "insufficient role": {
    message: es.errors.forbidden,
    next: "Pide a una persona administradora que revise tus roles.",
  },
  "staff role required": {
    message: "Esta acción requiere un rol del mostrador.",
    next: "Pide a una persona administradora que revise tus roles.",
  },
  "reader role required": {
    message: "Esta acción requiere el rol de lector.",
    next: "Pide a una persona administradora que revise tus roles.",
  },
  "active reader role required": {
    message: "Esta acción requiere una cuenta activa con rol de lector.",
    next: "Pide a una persona administradora que revise tus roles.",
  },
  "reader is inactive": {
    message: "La cuenta de la persona lectora está inactiva.",
    next: "Activa la cuenta antes de continuar.",
  },
  "reader has overdue loans": {
    message: "La persona tiene un préstamo vencido.",
    next: "Debe devolverlo antes de solicitar o recibir otro préstamo.",
  },
  "maximum two active loans": {
    message: "La persona ya tiene dos préstamos activos.",
    next: "Debe devolver uno antes de recibir otro préstamo.",
  },
  "request is not pending": {
    message: "La solicitud ya no está pendiente.",
    next: "Recarga la lista para ver su estado actual.",
  },
  "request belongs to another reader": {
    message: "Esta solicitud pertenece a otra persona.",
    next: "Solo quien la creó puede cancelarla.",
  },
  "rejection reason required": {
    message: "Necesitamos un motivo para rechazar.",
    next: "Escribe un motivo breve e inténtalo de nuevo.",
  },
  "reservation belongs to another reader": {
    message: "Esta reserva pertenece a otra persona.",
    next: "Solo quien la creó puede cancelarla.",
  },
  "reservation is terminal": {
    message: "La reserva ya está cerrada.",
    next: "Recarga la lista para ver su estado actual.",
  },
  "reservation has expired": {
    message: "El plazo de recogida de la reserva venció.",
    next: "La reserva se cerrará y el ejemplar pasará a la siguiente persona.",
  },
  "reservation is not ready or has expired": {
    message: "La reserva no está lista o el plazo de recogida venció.",
    next: "Revisa la fecha límite antes de registrar la recogida.",
  },
  "loan already returned": {
    message: "Este préstamo ya fue devuelto.",
    next: "Recarga la lista para ver el historial actualizado.",
  },
  "loan is returned or overdue": {
    message: "El préstamo ya fue devuelto o está vencido.",
    next: "Un préstamo vencido no se puede renovar; debe devolverse.",
  },
  "reader is inactive or has overdue loans": {
    message: "La cuenta está inactiva o tiene préstamos vencidos.",
    next: "Resuelve esa situación antes de renovar.",
  },
  "other readers have reservations": {
    message: "Otra persona tiene una reserva activa para este libro.",
    next: "El préstamo no se puede renovar mientras haya una reserva en cola.",
  },
  "loan already renewed": {
    message: "Este préstamo ya tiene una renovación aprobada.",
    next: "Solo se permite una renovación por préstamo.",
  },
  "renewal is not pending": {
    message: "La renovación ya no está pendiente.",
    next: "Recarga la lista para ver su estado actual.",
  },
  "renewal is stale": {
    message: "El préstamo cambió desde que se solicitó la renovación.",
    next: "Revisa el vencimiento actual y vuelve a intentarlo.",
  },
  "copy is not eligible": {
    message: "Ese ejemplar no pertenece al libro o no está en circulación.",
    next: "Elige un ejemplar disponible del mismo libro.",
  },
  "copy is already loaned or reserved": {
    message: "Ese ejemplar ya está prestado o reservado.",
    next: "Elige otro ejemplar disponible.",
  },
  "copy has an active loan or ready reservation": {
    message: "El ejemplar tiene un préstamo activo o una reserva lista.",
    next: "No se puede retirar de circulación mientras esté ocupado.",
  },
  "one or more genres do not exist": {
    message: "Uno de los géneros seleccionados ya no existe.",
    next: "Actualiza la lista de géneros y vuelve a guardar.",
  },
  "genre_ids must be an array; use [] to clear preferences": {
    message: "La selección de géneros no llegó en el formato esperado.",
    next: "Recarga la página y vuelve a intentarlo.",
  },
  "at most 100 genres are allowed": {
    message: "Puedes elegir como máximo 100 géneros.",
    next: "Quita algunos géneros antes de guardar.",
  },
  "invalid genre identifier": {
    message: "Uno de los géneros no es válido.",
    next: "Actualiza la lista de géneros y vuelve a intentarlo.",
  },
  "duplicate genre identifier": {
    message: "La selección contiene un género repetido.",
    next: "Quita el duplicado y vuelve a guardar.",
  },
  "rating must be an integer between 1 and 5": {
    message: "La valoración debe ser un entero de 1 a 5.",
    next: "Elige entre una y cinco estrellas.",
  },
  "invalid book identifier": {
    message: "El libro no es válido.",
    next: "Vuelve al catálogo y elige un libro existente.",
  },
  "invalid interaction type": {
    message: "El tipo de interacción no es válido.",
    next: "Recarga la página y vuelve a intentarlo.",
  },
  "Local book has no Goodreads mapping": {
    message: "Este libro no tiene correspondencia con Goodreads.",
    next: "No hay recomendaciones similares disponibles para él.",
  },
  "Goodreads book is absent from recommendation artifacts": {
    message: "El libro no aparece en el catálogo de recomendaciones.",
    next: "No hay recomendaciones similares disponibles para él.",
  },
  "Recommendation engine is not ready": {
    message: es.recommendations.serviceUnavailableBody,
    next: "El motor puede tardar unos tres minutos en arrancar.",
  },
  "Recommendation service is unavailable": {
    message: es.recommendations.serviceUnavailableBody,
    next: "El resto de la aplicación sigue disponible. Inténtalo más tarde.",
  },
  "Recommendation service timed out": {
    message: es.recommendations.timeoutBody,
    next: "Puedes seguir usando el catálogo y reintentar la recomendación.",
  },
  "Recommendation service returned an unsuccessful response": {
    message: es.recommendations.badGatewayBody,
    next: "Inténtalo de nuevo; si persiste, avisa al personal.",
  },
  "invalid administrator input": {
    message: "Los datos de la cuenta administradora no son válidos.",
    next: "Revisa el archivo de alta y vuelve a intentarlo.",
  },
  "administrator already bootstrapped": {
    message: "Ya existe una cuenta administradora inicial.",
    next: "Asigna el rol desde la sección de usuarios.",
  },
};

function statusFallback(status: number): Pick<MappedApiError, "title" | "message" | "next"> {
  switch (status) {
    case 0:
      return {
        title: es.errors.title,
        message: es.errors.network,
        next: es.errors.nextStep,
      };
    case 400:
      return {
        title: es.errors.title,
        message: es.errors.validation,
        next: "Revisa los campos marcados e inténtalo de nuevo.",
      };
    case 401:
      return {
        title: es.errors.title,
        message: es.auth.sessionExpired,
        next: "Vuelve a iniciar sesión para continuar.",
      };
    case 403:
      return {
        title: es.errors.forbiddenTitle,
        message: es.errors.forbidden,
        next: "Pide a una persona administradora que revise tus roles.",
      };
    case 404:
      return {
        title: es.errors.notFoundTitle,
        message: es.errors.notFound,
        next: es.errors.notFoundHint,
      };
    case 409:
      return {
        title: es.errors.title,
        message: es.errors.conflict,
        next: "Recarga la lista para ver el estado actual y vuelve a intentarlo.",
      };
    case 502:
      return {
        title: es.recommendations.badGatewayTitle,
        message: es.recommendations.badGatewayBody,
        next: es.errors.nextStep,
      };
    case 503:
      return {
        title: es.recommendations.serviceUnavailableTitle,
        message: es.recommendations.serviceUnavailableBody,
        next: "El motor puede tardar unos tres minutos en arrancar.",
      };
    case 504:
      return {
        title: es.recommendations.timeoutTitle,
        message: es.recommendations.timeoutBody,
        next: es.errors.nextStep,
      };
    default:
      return {
        title: es.errors.title,
        message: es.errors.server,
        next: es.errors.nextStep,
      };
  }
}

export function mapApiError(error: unknown): MappedApiError {
  if (!(error instanceof ApiError)) {
    return {
      ...statusFallback(500),
      fieldErrors: [],
      status: 500,
    };
  }

  const fallback = statusFallback(error.status);
  const known = error.body ? serverMessages[error.body.message] : undefined;
  const fieldErrors = error.fieldErrors;

  if (error.status === 401) {
    return {
      title: fallback.title,
      message: es.auth.sessionExpired,
      next: "Vuelve a iniciar sesión para continuar.",
      fieldErrors,
      status: error.status,
    };
  }

  if (known) {
    return {
      title: fallback.title,
      message: known.message,
      next: known.next ?? fallback.next,
      detail: known ? undefined : error.body?.message,
      fieldErrors,
      status: error.status,
    };
  }

  return {
    ...fallback,
    detail: error.body?.message,
    fieldErrors,
    status: error.status,
  };
}
