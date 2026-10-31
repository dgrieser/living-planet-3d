/**
 * The data the Living Earth streams in M0, with the licence and attribution each one demands.
 *
 * Every source declares its attribution here (the "tileset manifest" of docs/earth-sim/10 §2.5 in its
 * simplest form); the attribution strip shows the sources whose tiles are on screen, the model card
 * lists all of them. The URLs are the providers' public endpoints for this work-in-progress stage – the
 * pipeline (docs/earth-sim/11) mirrors them onto the mittwald server before the sim leaves `hidden`.
 */

export const TERRAIN = Object.freeze({
  id: 'mapterhorn',
  url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  tileDimension: 512,
  // global coverage ends at z12 (≈ 19 m per pixel at 52° N); the national 1 m / 0.4 m models of NRW and
  // Denmark reach z16/z17 but only inside their regions – they arrive with the hero tilesets in M2
  maxZoom: 12,
  encoding: 'terrarium',
  name: 'Mapterhorn',
  provenance: 'measured',
  licence: 'per source (Mapterhorn attribution list)',
  attribution: '© Mapterhorn',
  href: 'https://mapterhorn.com/attribution',
  // conditions, not courtesy: the sources Mapterhorn fuses that matter for this sim
  notices: [
    'Copernicus DEM GLO-30: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    'DGM1 NRW: Ministerium des Innern des Landes Nordrhein-Westfalen, dl-de/zero-2.0',
    'Danmarks Højdemodel – Terræn: Klimadatastyrelsen, CC BY 4.0',
  ],
});

export const IMAGERY = Object.freeze({
  id: 'eox-s2cloudless-2025',
  url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
  tileDimension: 256,
  levels: 16, // z0–z15: Sentinel-2's 10 m pixels are native at z14 (≈ 6 m per pixel at 52° N)
  name: 'EOX Sentinel-2 cloudless 2025',
  provenance: 'measured',
  licence: 'CC BY-NC-SA 4.0',
  attribution: 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
  href: 'https://cloudless.eox.at',
});

export const EPHEMERIS = Object.freeze({
  id: 'astronomy-engine',
  name: 'Astronomy Engine',
  provenance: 'modelled',
  licence: 'MIT',
  attribution: 'Astronomy Engine (Don Cross), validated against JPL Horizons',
  href: 'https://github.com/cosinekitty/astronomy',
});

export const SOURCES = Object.freeze([TERRAIN, IMAGERY, EPHEMERIS]);
