/** Subset of Etsy Open API v3 schemas used by PrintFlow (from Etsy's OpenAPI spec). */
export interface EtsyMoney {
  amount?: number;
  divisor?: number;
  currency_code?: string;
}

export interface EtsyTransaction {
  transaction_id?: number;
  title?: string | null;
  quantity?: number;
  receipt_id?: number;
  listing_id?: number | null;
  product_id?: number | null;
  sku?: string | null;
  price?: EtsyMoney;
  shipping_cost?: EtsyMoney;
  variations?: { property_id?: number; value_id?: number | null; formatted_name?: string; formatted_value?: string }[];
  shipped_timestamp?: number | null;
}

export interface EtsyReceipt {
  receipt_id?: number;
  seller_user_id?: number;
  buyer_user_id?: number;
  buyer_email?: string | null;
  name?: string;
  first_line?: string | null;
  second_line?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  status?: string;
  country_iso?: string | null;
  message_from_buyer?: string | null;
  is_paid?: boolean;
  is_shipped?: boolean;
  created_timestamp?: number;
  create_timestamp?: number;
  updated_timestamp?: number;
  update_timestamp?: number;
  is_gift?: boolean;
  gift_message?: string;
  grandtotal?: EtsyMoney;
  subtotal?: EtsyMoney;
  total_price?: EtsyMoney;
  total_shipping_cost?: EtsyMoney;
  total_tax_cost?: EtsyMoney;
  total_vat_cost?: EtsyMoney;
  discount_amt?: EtsyMoney;
  shipments?: { receipt_shipping_id?: number | null; shipment_notification_timestamp?: number; carrier_name?: string; tracking_code?: string }[];
  transactions?: EtsyTransaction[];
}

export interface EtsyPaged<T> {
  count?: number;
  results?: T[];
}
