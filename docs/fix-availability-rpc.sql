-- =========================================================
-- Correção: cliente logado via RLS só enxerga os PRÓPRIOS
-- agendamentos, então a tela de marcar horário mostrava todos
-- os horários como livres. Esta função devolve apenas os
-- INTERVALOS OCUPADOS (sem nome, telefone ou e-mail de quem
-- quer que seja), permitindo calcular a disponibilidade real.
-- Rode este bloco no SQL Editor do Supabase.
--
-- Atualização: agora também ignora atendimentos avulsos (is_walk_in=true,
-- ver docs/add-walk-in-appointments.sql) — eles não devem bloquear a
-- agenda de ninguém. Rode add-walk-in-appointments.sql ANTES deste.
--
-- Atualização: agora usa duration_minutes_snapshot (soma travada da
-- duração de todos os serviços do agendamento, ver
-- docs/add-multi-service-appointments.sql) quando disponível, caindo de
-- volta pro serviço único em agendamentos antigos. Rode
-- add-multi-service-appointments.sql ANTES deste.
-- =========================================================

CREATE OR REPLACE FUNCTION public.barber_busy_intervals(
  p_barber_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (start_time timestamptz, end_time timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT a.id,
           a.appointment_time,
           a.status,
           coalesce(a.customer_name, '') AS customer_name,
           coalesce(a.duration_minutes_snapshot, s.duration_minutes, 30) AS duration_minutes,
           coalesce(a.is_walk_in, false) AS is_walk_in
    FROM public.appointments a
    LEFT JOIN public.services s ON s.id = a.service_id
    WHERE a.barber_id = p_barber_id
      AND a.appointment_time >= p_from
      AND a.appointment_time < p_to
  ),
  cancelled AS (
    -- marcadores de cancelamento: status 'cancelado:<id>' ou nome 'CANCELADO:<id>:...'
    SELECT split_part(status, ':', 2) AS target_id FROM raw WHERE lower(status) LIKE 'cancelado:%'
    UNION ALL
    SELECT split_part(customer_name, ':', 2) FROM raw WHERE upper(customer_name) LIKE 'CANCELADO:%'
  )
  SELECT
    r.appointment_time AS start_time,
    CASE
      WHEN upper(r.customer_name) LIKE 'BLOQUEIO:%'
        THEN nullif(substring(r.customer_name from 'BLOQUEIO:([^Z]*Z)'), '')::timestamptz
      ELSE r.appointment_time + make_interval(mins => r.duration_minutes)
    END AS end_time
  FROM raw r
  WHERE lower(coalesce(r.status, 'confirmado')) NOT IN
        ('cancelado','cancelada','cancelled','remarcado','remarcando')
    AND lower(coalesce(r.status, '')) NOT LIKE 'cancelado:%'
    AND upper(r.customer_name) NOT LIKE 'CANCELADO:%'
    AND r.id::text NOT IN (SELECT target_id FROM cancelled WHERE target_id <> '')
    AND r.is_walk_in = false

  UNION ALL

  SELECT b.start_time, b.end_time
  FROM public.schedule_blocks b
  WHERE b.barber_id = p_barber_id
    AND b.start_time >= p_from
    AND b.start_time < p_to;
$$;

REVOKE ALL ON FUNCTION public.barber_busy_intervals(uuid, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.barber_busy_intervals(uuid, timestamptz, timestamptz)
  TO anon, authenticated, service_role;
