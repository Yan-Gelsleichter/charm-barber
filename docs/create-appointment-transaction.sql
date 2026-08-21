-- Criação atômica de agendamento + cliente.
-- Execute uma vez no SQL Editor do projeto antes de publicar esta versão.

create or replace function public.create_appointment_with_client(
  p_barber_id uuid,
  p_service_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_email text,
  p_appointment_time timestamptz,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barbershop_id uuid;
  v_service_barber_id uuid;
  v_service_barbershop_id uuid;
  v_appointment_id uuid;
  v_client_id uuid;
begin
  select b.barbershop_id
    into v_barbershop_id
    from public.barbers b
   where b.id = p_barber_id;

  select s.barber_id, s.barbershop_id
    into v_service_barber_id, v_service_barbershop_id
    from public.services s
   where s.id = p_service_id;

  if not found or v_barbershop_id is null then
    raise exception 'Barbeiro, serviço ou barbearia inválido.';
  end if;

  if v_service_barber_id is not null and v_service_barber_id <> p_barber_id then
    raise exception 'Este serviço não pertence ao barbeiro selecionado.';
  end if;

  if v_service_barbershop_id is not null and v_service_barbershop_id <> v_barbershop_id then
    raise exception 'Este serviço não pertence à barbearia selecionada.';
  end if;

  insert into public.appointments (
    barber_id,
    service_id,
    customer_name,
    customer_phone,
    email,
    appointment_time,
    status,
    payment_status,
    barbershop_id
  ) values (
    p_barber_id,
    p_service_id,
    trim(p_customer_name),
    p_customer_phone,
    nullif(lower(trim(p_email)), ''),
    p_appointment_time,
    'confirmado',
    'pendente',
    v_barbershop_id
  )
  returning id into v_appointment_id;

  select c.id
    into v_client_id
    from public.clients c
   where c.barber_id = p_barber_id
     and (
       (p_user_id is not null and c.user_id = p_user_id)
       or c.whatsapp = p_customer_phone
       or (
         nullif(lower(trim(p_email)), '') is not null
         and lower(c.email) = lower(trim(p_email))
       )
     )
   order by c.created_at asc
   limit 1;

  if v_client_id is null then
    insert into public.clients (
      barber_id,
      name,
      email,
      whatsapp,
      user_id,
      barbershop_id
    ) values (
      p_barber_id,
      trim(p_customer_name),
      nullif(lower(trim(p_email)), ''),
      p_customer_phone,
      p_user_id,
      v_barbershop_id
    );
  else
    update public.clients
       set name = trim(p_customer_name),
           email = nullif(lower(trim(p_email)), ''),
           whatsapp = p_customer_phone,
           user_id = coalesce(p_user_id, user_id),
           barbershop_id = v_barbershop_id
     where id = v_client_id;
  end if;

  return v_appointment_id;
end;
$$;

revoke all on function public.create_appointment_with_client(uuid, uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.create_appointment_with_client(uuid, uuid, text, text, text, timestamptz, uuid) to service_role;
