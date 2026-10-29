import { handleYahooPhotoImage } from "../server/yahoo-photo-image.js";
export const GET = (request: Request) => handleYahooPhotoImage(request);
