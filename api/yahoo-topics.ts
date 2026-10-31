import { handleYahooTopics } from "../server/yahoo-topics.js";
export const GET = (request: Request) => handleYahooTopics(request);
