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
  product_commission_percent?: number | null;
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
  commission_percent?: number | null;
  product_commission_percent?: number | null;
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
  covered_by_subscription_id?: string | null;
  service_price_snapshot?: number | null;
  push_token?: string | null;
  reminder_sent_at?: string | null;
  barber_reminder_sent_at?: string | null;
  is_walk_in?: boolean | null;
  service_ids?: string[] | null;
  duration_minutes_snapshot?: number | null;
  parent_appointment_id?: string | null;
  covered_by_loyalty_program_id?: string | null;
  attendance_confirmed?: boolean | null;
  attendance_confirmed_at?: string | null;
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
  covered_by_subscription_id?: string | null;
  service_price_snapshot?: number | null;
  push_token?: string | null;
  reminder_sent_at?: string | null;
  barber_reminder_sent_at?: string | null;
  is_walk_in?: boolean | null;
  service_ids?: string[] | null;
  duration_minutes_snapshot?: number | null;
  parent_appointment_id?: string | null;
  covered_by_loyalty_program_id?: string | null;
  attendance_confirmed?: boolean | null;
  attendance_confirmed_at?: string | null;
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

export type PushSubscription = {
  id: string;
  barber_id: string;
  token: string;
  created_at?: string;
};
export type PushSubscriptionInsert = {
  id?: string;
  barber_id: string;
  token: string;
};

export type SubscriptionPlan = {
  id: string;
  barbershop_id: string;
  name: string;
  description: string | null;
  price: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};
export type SubscriptionPlanInsert = {
  id?: string;
  barbershop_id: string;
  name: string;
  description?: string | null;
  price: number;
  active?: boolean;
};

export type SubscriptionPlanService = {
  id: string;
  plan_id: string;
  service_id: string;
};
export type SubscriptionPlanServiceInsert = {
  id?: string;
  plan_id: string;
  service_id: string;
};

export type SubscriptionPlanBarber = {
  id: string;
  plan_id: string;
  barber_id: string;
  /** % que o barbeiro recebe pelos atendimentos desse plano (docs/add-plan-barber-commission.sql). */
  commission_percent?: number | null;
};
export type SubscriptionPlanBarberInsert = {
  id?: string;
  plan_id: string;
  barber_id: string;
  commission_percent?: number;
};

export type SubscriptionStatus =
  | "pending"
  | "authorized"
  | "active"
  | "paused"
  | "cancelled"
  | "payment_failed";

export type ClientSubscription = {
  id: string;
  plan_id: string;
  client_id: string;
  barbershop_id: string;
  status: SubscriptionStatus;
  mp_preapproval_id: string | null;
  mp_payer_email: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at?: string;
  updated_at?: string;
};
export type ClientSubscriptionInsert = {
  id?: string;
  plan_id: string;
  client_id: string;
  barbershop_id: string;
  status?: SubscriptionStatus;
  mp_preapproval_id?: string | null;
  mp_payer_email?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
};

export type SubscriptionCharge = {
  id: string;
  subscription_id: string;
  mp_payment_id: string | null;
  amount: number | null;
  status: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at?: string;
};
export type SubscriptionChargeInsert = {
  id?: string;
  subscription_id: string;
  mp_payment_id?: string | null;
  amount?: number | null;
  status?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  paid_at?: string | null;
};

export type LoyaltyProgramScope = "generic" | "services";

export type LoyaltyProgram = {
  id: string;
  barbershop_id: string;
  name: string;
  scope: LoyaltyProgramScope;
  goal: number;
  include_walk_in: boolean;
  allow_service_reward: boolean;
  active: boolean;
  created_at?: string;
};
export type LoyaltyProgramInsert = {
  id?: string;
  barbershop_id: string;
  name: string;
  scope?: LoyaltyProgramScope;
  goal: number;
  include_walk_in?: boolean;
  allow_service_reward?: boolean;
  active?: boolean;
};

export type LoyaltyProgramProduct = {
  id: string;
  program_id: string;
  product_id: string;
};
export type LoyaltyProgramProductInsert = {
  id?: string;
  program_id: string;
  product_id: string;
};

export type LoyaltyProgramService = {
  id: string;
  program_id: string;
  service_id: string;
};
export type LoyaltyProgramServiceInsert = {
  id?: string;
  program_id: string;
  service_id: string;
};

export type LoyaltyRedemption = {
  id: string;
  program_id: string;
  barbershop_id: string;
  customer_phone: string;
  appointment_id: string | null;
  product_order_id?: string | null;
  created_at?: string;
};
export type LoyaltyRedemptionInsert = {
  id?: string;
  program_id: string;
  barbershop_id: string;
  customer_phone: string;
  appointment_id?: string | null;
  product_order_id?: string | null;
};

export type Product = {
  id: string;
  barbershop_id: string;
  title: string;
  description: string | null;
  price: number;
  image_url: string | null;
  stock_quantity: number;
  active: boolean;
  created_at?: string;
};
export type ProductInsert = {
  id?: string;
  barbershop_id: string;
  title: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  stock_quantity?: number;
  active?: boolean;
};

export type ProductOrder = {
  id: string;
  barbershop_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  total_price: number;
  payment_status: string;
  payment_method: string | null;
  mp_payment_id: string | null;
  paid_at: string | null;
  is_walk_in: boolean;
  barber_id: string | null;
  fulfilled_at: string | null;
  push_token: string | null;
  covered_by_loyalty_program_id?: string | null;
  created_at?: string;
};
export type ProductOrderInsert = {
  id?: string;
  barbershop_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  total_price?: number;
  payment_status?: string;
  payment_method?: string | null;
  mp_payment_id?: string | null;
  paid_at?: string | null;
  is_walk_in?: boolean;
  barber_id?: string | null;
  fulfilled_at?: string | null;
  push_token?: string | null;
  covered_by_loyalty_program_id?: string | null;
};

export type ProductOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_title: string;
  product_price: number;
  quantity: number;
};
export type ProductOrderItemInsert = {
  id?: string;
  order_id: string;
  product_id: string;
  product_title: string;
  product_price: number;
  quantity?: number;
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
      push_subscriptions: Table<PushSubscription, PushSubscriptionInsert>;
      subscription_plans: Table<SubscriptionPlan, SubscriptionPlanInsert>;
      subscription_plan_services: Table<SubscriptionPlanService, SubscriptionPlanServiceInsert>;
      subscription_plan_barbers: Table<SubscriptionPlanBarber, SubscriptionPlanBarberInsert>;
      client_subscriptions: Table<ClientSubscription, ClientSubscriptionInsert>;
      subscription_charges: Table<SubscriptionCharge, SubscriptionChargeInsert>;
      loyalty_programs: Table<LoyaltyProgram, LoyaltyProgramInsert>;
      loyalty_program_services: Table<LoyaltyProgramService, LoyaltyProgramServiceInsert>;
      loyalty_redemptions: Table<LoyaltyRedemption, LoyaltyRedemptionInsert>;
      loyalty_program_products: Table<LoyaltyProgramProduct, LoyaltyProgramProductInsert>;
      products: Table<Product, ProductInsert>;
      product_orders: Table<ProductOrder, ProductOrderInsert>;
      product_order_items: Table<ProductOrderItem, ProductOrderItemInsert>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
