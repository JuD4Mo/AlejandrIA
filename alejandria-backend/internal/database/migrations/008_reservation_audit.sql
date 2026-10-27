ALTER TABLE reservations ADD COLUMN assignment_origin TEXT;

-- El esquema previo no permite demostrar si assigned_by fue actor o sustituto.
-- Se conserva el identificador histórico sin atribuir retrospectivamente un origen.
UPDATE reservations SET assignment_origin = 'unknown' WHERE copy_id IS NOT NULL;

ALTER TABLE reservations DROP CONSTRAINT reservations_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_assignment_origin_check
    CHECK (assignment_origin IN ('manual', 'system', 'unknown'));
ALTER TABLE reservations ADD CONSTRAINT reservations_assignment_check CHECK (
    (copy_id IS NULL AND assigned_at IS NULL AND assigned_by IS NULL
        AND pickup_expires_at IS NULL AND assignment_origin IS NULL)
    OR
    (copy_id IS NOT NULL AND assigned_at IS NOT NULL AND pickup_expires_at IS NOT NULL
        AND assigned_at >= created_at
        AND pickup_expires_at = assigned_at + interval '72 hours'
        AND assignment_origin IS NOT NULL
        AND ((assignment_origin = 'manual' AND assigned_by IS NOT NULL)
            OR (assignment_origin = 'system' AND assigned_by IS NULL)
            OR assignment_origin = 'unknown'))
);
-- Se conservan los demás CHECK, FK e índices de estado, FIFO y unicidad.

---- create above / drop below ----

-- No fabricar actores para cumplir un esquema antiguo que no representa al sistema.
-- Tern revierte esta migración transaccionalmente si el retorno no es representable.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM reservations WHERE copy_id IS NOT NULL AND assigned_by IS NULL) THEN
        RAISE EXCEPTION 'Cannot revert reservation audit: assignments without a user cannot be represented in schema 7';
    END IF;
END $$;
ALTER TABLE reservations DROP CONSTRAINT reservations_assignment_check;
ALTER TABLE reservations DROP CONSTRAINT reservations_assignment_origin_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_check CHECK (
    (copy_id IS NULL AND assigned_at IS NULL AND assigned_by IS NULL AND pickup_expires_at IS NULL)
    OR (copy_id IS NOT NULL AND assigned_at IS NOT NULL AND assigned_by IS NOT NULL
        AND pickup_expires_at IS NOT NULL AND assigned_at >= created_at
        AND pickup_expires_at = assigned_at + interval '72 hours')
);
ALTER TABLE reservations DROP COLUMN assignment_origin;
