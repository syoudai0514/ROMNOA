import { handleYahooBody } from "../server/yahoo-body.js";
export const GET = (request: Request) => handleYahooBody(request);
