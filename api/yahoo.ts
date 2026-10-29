import { handleYahoo } from "../server/yahoo.js";
export const GET = (request: Request) => handleYahoo(request);
