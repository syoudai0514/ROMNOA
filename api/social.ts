import { handleSocial } from "../server/social.js";
export const GET = (request: Request) => handleSocial(request);
