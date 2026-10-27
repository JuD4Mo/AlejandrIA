-- Sin deduplicar ni borrar solicitudes existentes: si hubiera duplicados pending,
-- la creación falla atómicamente para que se resuelvan explícitamente.
CREATE UNIQUE INDEX loan_requests_pending_user_book_uq
    ON loan_requests(user_id, book_id) WHERE status = 'pending';

-- Revisados y conservados sin duplicar:
-- loans_active_copy_uq, reservations_ready_copy_uq,
-- reservations_active_user_book_uq, loan_renewals_approved_uq,
-- loan_renewals_pending_uq. Las reglas entre tablas pertenecen al servicio Go.

---- create above / drop below ----
DROP INDEX loan_requests_pending_user_book_uq;
