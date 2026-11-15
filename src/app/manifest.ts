import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal OS",
    short_name: "Personal OS",
    description: "A local-first operating surface for focused work, planning, and growth.",
    start_url: "/assistant",
    display: "standalone",
    background_color: "#f6f0e7",
    theme_color: "#a35434",
    icons: [
      {
        src: "/personal-os-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
