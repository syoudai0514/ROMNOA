import { handleYahooComments } from "../server/yahoo-comments.js";
export const GET = (request: Request) => handleYahooComments(request);
