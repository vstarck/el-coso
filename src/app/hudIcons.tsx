/* HUD icon registry — the React app's adapter for the host-agnostic icon
 * names a lens emits on `HudMetric.icon`. The lens contract (`@/lenses`)
 * carries only a string name; this is where the chrome resolves it to a
 * concrete lucide component. Add a row here to expose a new named icon.
 */

import { Activity, Droplets, Gauge, MapPin } from "lucide-react";

type IconComponent = React.ComponentType<{ size?: number | string }>;

const HUD_ICONS: Record<string, IconComponent> = {
  droplets: Droplets,
  mapPin: MapPin,
  activity: Activity,
  gauge: Gauge,
};

/** Resolve a host-agnostic HUD icon name to its component, or undefined. */
export function hudIcon(name: string | undefined): IconComponent | undefined {
  return name ? HUD_ICONS[name] : undefined;
}
