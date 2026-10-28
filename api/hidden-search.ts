import { handleHiddenSearch } from "../server/hidden-search.js";
export const POST = (request: Request) => handleHiddenSearch(request);
