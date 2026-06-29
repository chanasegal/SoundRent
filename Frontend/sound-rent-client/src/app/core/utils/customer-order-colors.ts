import { OrderDto } from '../models/order.model';

export interface CustomerOrderColor {
  bg: string;
  border: string;
}

/** Stable display key — customer name, or phone when name is missing. */
export function customerColorKey(order: OrderDto): string {
  const name = (order.customerName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length > 0) {
    return name;
  }
  const phone = (order.phone ?? '').replace(/\D/g, '');
  return phone.length > 0 ? phone : String(order.id);
}

export function getCustomerColor(name: string): string {
  if (!name) return '#f3f4f6';

  const hue = customerNameHue(name);

  return `hsl(${hue}, 70%, 85%)`;
}

export function customerOrderColors(name: string): CustomerOrderColor {
  const bg = getCustomerColor(name);
  if (!name) {
    return { bg, border: '#d1d5db' };
  }

  const hue = customerNameHue(name);

  return {
    bg,
    border: `hsl(${hue}, 55%, 62%)`
  };
}

function customerNameHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const x = Math.sin(hash) * 10000;
  return Math.floor((x - Math.floor(x)) * 360);
}
