import { lookup } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, EnvHttpProxyAgent, fetch as request } from "undici";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
// Validate the address used by the socket, avoiding a second DNS lookup/rebinding.
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, [], 4);
        if (
          !addresses.length ||
          addresses.some((a) => !publicAddress(a.address))
        )
          return callback(new Error("private_photo_address"), [], 4);
        if (options.all) callback(null, addresses, 4);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
const proxyDispatcher =
  process.env.HTTPS_PROXY || process.env.https_proxy
    ? new EnvHttpProxyAgent()
    : null;
export const fetchPublicPhoto: typeof fetch = async (input, init) => {
  const url = String(input);
  if (!publicPhotoUrl(url)) throw Error("invalid_photo_url");
  // Managed execution environments require their configured egress proxy.
  // Production connections use the socket-pinned lookup above.
  if (proxyDispatcher) {
    await new Promise<void>((resolve, reject) =>
      lookup(new URL(url).hostname, { all: true }, (error, addresses) => {
        if (
          error ||
          !addresses.length ||
          addresses.some((a) => !publicAddress(a.address))
        )
          reject(error || new Error("private_photo_address"));
        else resolve();
      }),
    );
  }
  return (await request(url, {
    ...init,
    redirect: "error",
    dispatcher: proxyDispatcher || dispatcher,
  } as Parameters<typeof request>[1])) as unknown as Response;
};
