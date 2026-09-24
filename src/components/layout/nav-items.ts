import {
  BarChart3Icon,
  BoxIcon,
  CylinderIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LayersIcon,
  PrinterIcon,
  SettingsIcon,
  ShoppingBagIcon,
  TruckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/orders", label: "Orders", icon: ShoppingBagIcon },
  { href: "/production", label: "Production", icon: LayersIcon },
  { href: "/products", label: "Products", icon: BoxIcon },
  { href: "/customers", label: "Customers", icon: UsersIcon },
  { href: "/printers", label: "Printers", icon: PrinterIcon },
  { href: "/filament", label: "Filament", icon: CylinderIcon },
  { href: "/shipping", label: "Shipping", icon: TruckIcon },
  { href: "/reports", label: "Reports", icon: BarChart3Icon },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/activity", label: "Activity log", icon: HistoryIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** Bottom tab bar on phones: the screens used day-to-day. */
export const MOBILE_TABS = ["/dashboard", "/orders", "/production", "/shipping"];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
