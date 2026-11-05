import { DeviceAlerts } from "@/components/public/device-alerts";
import { pushPublicKey } from "@/server/services/alerts";
import {
  getDeviceSettings,
  removeDevice,
  saveDeviceSettings,
  subscribeDevice,
} from "./device-actions";

const actions = {
  subscribe: subscribeDevice,
  getSettings: getDeviceSettings,
  saveSettings: saveDeviceSettings,
  remove: removeDevice,
};

/** "Get price error alerts" for this device; nothing when push isn't set up. */
export function DeviceAlertsBox({
  signedIn = false,
  title = "Never miss a price error",
}: {
  signedIn?: boolean;
  title?: string | null;
}) {
  const publicKey = pushPublicKey();
  if (!publicKey) return null;
  return (
    <section
      aria-label="Notifications on this device"
      className="space-y-2 rounded-lg border-2 border-lime-400 p-4"
    >
      {title ? <h2 className="text-lg font-bold">{title}</h2> : null}
      {signedIn ? null : (
        <p className="text-sm text-ink-muted">
          We&apos;ll ping this phone or computer the moment a price error or big drop goes live. No
          account, no email — turn it off any time.
        </p>
      )}
      <DeviceAlerts publicKey={publicKey} actions={actions} signedIn={signedIn} />
    </section>
  );
}
