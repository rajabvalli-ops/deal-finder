// Generates the VAPID key pair for browser push notifications. Run once, then put the
// output in your environment (Vercel project settings). Keep VAPID_PRIVATE_KEY secret;
// changing the keys later means every user has to turn notifications on again.
//
//   npm run push:keys
import { generateVapidKeys } from "@/server/push/web-push";

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com  # a contact address for push services");
