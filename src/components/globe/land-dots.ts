import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";

const MASK_W = 720;
const MASK_H = 360;
const MIN_LAT = -58; // Antarctica adds dots but no meaning
const MAX_LAT = 84;
const ALPHA_LAND = 128;
const MIN_COS_LAT = 0.2;

/** Unit-sphere position for a longitude/latitude in degrees. Camera looks down -z at lng 0. */
export function toVec3(lng: number, lat: number, radius = 1): [number, number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  return [radius * Math.cos(phi) * Math.sin(lam), radius * Math.sin(phi), radius * Math.cos(phi) * Math.cos(lam)];
}

/**
 * Evenly spaced dots on land, as a flat xyz array. Rasterises the bundled world-atlas land mask to an
 * offscreen canvas and samples it on a lat/lng grid whose longitude step widens toward the poles,
 * so no texture is downloaded and density looks uniform on the sphere.
 */
export function landDots(stepDeg: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = MASK_W;
  canvas.height = MASK_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Float32Array();

  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  const land = feature(topo, topo.objects.countries);
  const projection = geoEquirectangular().scale(MASK_W / (2 * Math.PI)).translate([MASK_W / 2, MASK_H / 2]);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  geoPath(projection, ctx)(land);
  ctx.fill();

  const pixels = ctx.getImageData(0, 0, MASK_W, MASK_H).data;
  const out: number[] = [];
  for (let lat = MIN_LAT; lat <= MAX_LAT; lat += stepDeg) {
    const lngStep = stepDeg / Math.max(Math.cos((lat * Math.PI) / 180), MIN_COS_LAT);
    const y = Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H));
    for (let lng = -180; lng < 180; lng += lngStep) {
      const x = Math.min(MASK_W - 1, Math.floor(((lng + 180) / 360) * MASK_W));
      if (pixels[(y * MASK_W + x) * 4 + 3] > ALPHA_LAND) out.push(...toVec3(lng, lat));
    }
  }
  return new Float32Array(out);
}
