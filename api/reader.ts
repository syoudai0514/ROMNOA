import { handleReader } from "../server/reader.js";
export const GET = (request: Request) => handleReader(request);
