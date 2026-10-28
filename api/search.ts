import { handleSearch } from "../server/search.js";
export const GET = (request: Request) => handleSearch(request);
