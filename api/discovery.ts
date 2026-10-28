import { handleDiscovery } from "../server/discovery.js";
export const GET = (request: Request) => handleDiscovery(request);
