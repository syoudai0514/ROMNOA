import { handleYahooSearch } from "../server/yahoo-search.js";
export const GET = (request: Request) => handleYahooSearch(request);
