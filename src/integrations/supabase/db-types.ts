// Tipos espelhando o schema real (tabelas e colunas em inglês).

export type Barber = {
  id: string;
  name: string;
  avatar_url: string | null;
  user_id: string | null;
  is_admin: boolean;
};
export type BarberInsert = {
  id?: string;
  name: string;
  avatar_url?: string | null;
  user_id?: string | null;
  is_admin?: boolean;
};

export type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string | null;
};
export type ServiceInsert = {
  id?: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id?: string | null;
};

export type WorkingHour = {
  id: string;
  barber_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};
export type WorkingHourInsert = {
  id?: string;
  barber_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

export type Appointment = {
  id: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  appointment_time: string;
  status: string;
};
export type AppointmentInsert = {
  id?: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string;
  appointment_time: string;
  status?: string;
};

type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      barbers: Table<Barber, BarberInsert>;
      services: Table<Service, ServiceInsert>;
      working_hours: Table<WorkingHour, WorkingHourInsert>;
      appointments: Table<Appointment, AppointmentInsert>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
