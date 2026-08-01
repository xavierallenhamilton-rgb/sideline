// Static facts about known leads that don't live in tasks.json (display name,
// category, contact info, deployed site/repo). Task *status* always comes live
// from tasks.json — this is just presentation metadata, kept separate so it's
// obvious which parts of the page are live vs hand-maintained.
const LEAD_INFO = {
  "julies-barbershop-campbell": {
    name: "Julie's Barbershop",
    meta: "Barbershop · Cash only · Est. 30+ yrs · (408) 370-0603",
    site: "https://xavierallenhamilton-rgb.github.io/julies-barbershop-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/julies-barbershop-campbell",
  },
  "new-view-landscaping-campbell": {
    name: "New View Landscaping",
    meta: "Landscaping · Juan Hernandez · CA licensed · (408) 568-3022",
    site: "https://xavierallenhamilton-rgb.github.io/new-view-landscaping-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/new-view-landscaping-campbell",
  },
  "amandas-mobile-pet-grooming-campbell": {
    name: "Amanda's Mobile Pet Grooming",
    meta: "Pet grooming · Mobile, no storefront · Cats & dogs ≤25 lbs · (408) 460-3038",
    site: "https://xavierallenhamilton-rgb.github.io/amandas-mobile-pet-grooming-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/amandas-mobile-pet-grooming-campbell",
  },
  "rochas-house-cleaning-campbell": {
    name: "Rocha's House Cleaning",
    meta: "House cleaning · Est. 2003 · (408) 838-0689",
    site: "https://xavierallenhamilton-rgb.github.io/rochas-house-cleaning-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/rochas-house-cleaning-campbell",
  },
  "jr-cleaning-service-campbell": {
    name: "JR Cleaning Service",
    meta: "House cleaning · Carpet · deep clean · move-in/out · (650) 773-2415",
    site: "https://xavierallenhamilton-rgb.github.io/jr-cleaning-service-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/jr-cleaning-service-campbell",
  },
  "blue-pool-services-campbell": {
    name: "Blue Pool Services",
    meta: "Pool & spa maintenance · Weekly service · (408) 483-2051",
    site: "https://xavierallenhamilton-rgb.github.io/blue-pool-services-campbell/",
    repo: "https://github.com/xavierallenhamilton-rgb/blue-pool-services-campbell",
  },
};

const PIPELINE_STAGES = ["SCOUT", "SCRIBE", "BUILDER", "CALLER", "LEDGER"];

const TYPE_TO_STAGE = {
  prospect: "SCOUT",
  write_site_copy: "SCRIBE",
  build_demo_site: "BUILDER",
  write_script: "SCRIBE",
  call_pitch: "CALLER",
  report: "LEDGER",
};
