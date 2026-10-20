// Only maintainers can change these URLs. Never accept a URL from API parameters.
export const sources = [
  {
    id: "hamusoku",
    url: "https://hamusoku.com/index.rdf",
    hostname: "hamusoku.com",
  },
  {
    id: "alfalfa",
    url: "https://alfalfalfa.com/index.rdf",
    hostname: "alfalfalfa.com",
  },
] as const;
export type Source = (typeof sources)[number];
