// Tipos espelhando o schema real (tabelas e colunas em inglês).

export type Barber = {
  id: string;
  name: string;
  avatar_url: string | null;
  user_id: string | null;
  is_admin: boolean;
  business_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  barbershop_id?: string | null;
  mp_user_id?: string | null;
  commission_percent?: number | null;
};
export type BarberInsert = {
  id?: string;
  name: string;
  avatar_url?: string | null;
  user_id?: string | null;
  is_admin?: boolean;
  business_name?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  barbershop_id?: string | null;
};

export type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string | null;
  barbershop_id?: string | null;
};
export type ServiceInsert = {
  id?: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id?: string | null;
  barbershop_id?: string | null;
};

export type WorkingHour = {
  id: string;
  barber_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  barbershop_id?: string | null;
};
export type WorkingHourInsert = {
  id?: string;
  barber_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  barbershop_id?: string | null;
};

export type Appointment = {
  id: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  email: string | null;
  appointment_time: string;
  status: string;
  barbershop_id?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  mp_payment_id?: string | null;
  paid_at?: string | null;
};
export type AppointmentInsert = {
  id?: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  email?: string | null;
  appointment_time: string;
  status?: string;
  barbershop_id?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  mp_payment_id?: string | null;
  paid_at?: string | null;
};


export type Client = {
  id: string;
  barber_id: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  user_id: string | null;
  created_at?: string;
  barbershop_id?: string | null;
};
export type ClientInsert = {
  id?: string;
  barber_id: string;
  name: string;
  email?: string | null;
  whatsapp?: string | null;
  user_id?: string | null;
  barbershop_id?: string | null;
};

export type ScheduleBlock = {
  id: string;
  barber_id: string;
  barbershop_id: string | null;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_at?: string;
};
export type ScheduleBlockInsert = {
  id?: string;
  barber_id: string;
  barbershop_id?: string | null;
  start_time: string;
  end_time: string;
  reason?: string | null;
};

type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      barbers: Table<Barber, BarberInsert>;
      services: Table<Service, ServiceInsert>;
      working_hours: Table<WorkingHour, WorkingHourInsert>;
      appointments: Table<Appointment, AppointmentInsert>;
      clients: Table<Client, ClientInsert>;
      schedule_blocks: Table<ScheduleBlock, ScheduleBlockInsert>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
