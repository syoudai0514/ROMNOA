import { handleArticles } from "../server/handler";
export const GET = (request: Request) => handleArticles(request);
