import { config } from "@/lib/config";

export type MenuItem = {
  title: string
  href?: string
  submenu?: MenuItem[]
}

export const menuItems: MenuItem[] = config.navigation.main;
