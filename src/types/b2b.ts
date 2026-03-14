export interface B2BClient {
  id: string;
  name: string;
  slug: string;
  customer_external_ids: string[];
  redevance_rate: number;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface B2BFilters {
  year: number;
  sites: string[];
  bornes: string[];
  tokens: string[];
  selectedClientId: string | null;
}

export interface B2BCdr {
  id: string;
  gfx_cdr_id: string | null;
  source: string;
  start_date_time: string;
  end_date_time: string;
  total_energy: number;
  total_time: number;
  total_parking_time: number | null;
  total_cost: number;
  total_retail_cost: number | null;
  total_retail_cost_incl_vat: number | null;
  customer_external_id: string | null;
  driver_external_id: string | null;
  retail_package_id: string | null;
  charger_type: string | null;
  auth_id: string | null;
  cdr_token: { uid: string; type: string; contract_id: string } | null;
  cdr_location: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    evses?: Array<{ uid: string; evse_id: string }>;
  } | null;
  emsp_country_code: string | null;
  emsp_party_id: string | null;
  station_id: string | null;
}

export interface B2BMonthlyRow {
  month: number;
  monthLabel: string;
  volume: number;
  duration: number; // hours
  volumeAvecTarif: number;
  volumeGratuit: number;
  redevance: number;
}

export interface B2BChargePointRow {
  chargePointId: string;
  volume: number;
  duration: number;
  saturation: number;
  co2Evite: number;
  sessionCount: number;
}

export interface B2BDriverRow {
  driverName: string;
  firstName: string;
  lastName: string;
  tokenVisualNumber: string;
  volumeGratuit: number;
}
