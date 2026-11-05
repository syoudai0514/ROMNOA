import { handleYahooRecord } from "../server/yahoo.js";
export const GET = (request: Request) => handleYahooRecord(request);
