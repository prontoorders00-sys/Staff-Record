import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Staff Record",
    short_name: "Staff Record",
    description: "Simple staff records for growing businesses.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4f1e9",
    theme_color: "#143c35",
  };
}
