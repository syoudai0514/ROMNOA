import { handleYahooPhotos } from "../server/yahoo-photos.js";
export const GET = (request: Request) => handleYahooPhotos(request);
