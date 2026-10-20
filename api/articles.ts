import { handleArticles } from "../server/handler.js";
export const GET = (request: Request) => handleArticles(request);
